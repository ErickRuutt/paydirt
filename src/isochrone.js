import { db } from './db.js';

// Drive-time areas from the Mapbox Isochrone API. The token stays on the server; the browser
// only sees the polygons. Results are cached per point and contour set, since road networks
// change slowly and each parcel is opened many times. Free tier: 100k requests a month.
db.exec(`CREATE TABLE IF NOT EXISTS isochrones (
  key TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  geojson TEXT NOT NULL,
  fetched_at TEXT DEFAULT (datetime('now'))
)`);

const MAX_AGE_DAYS = 90;
const token = () => process.env.MAPBOX_TOKEN || process.env.MAPBOX_API || process.env.MAPBOX_ACCESS_TOKEN || '';
export const hasMapbox = () => token().length > 0;

const cacheKey = (lat, lng, minutes) => `${lat.toFixed(5)},${lng.toFixed(5)}|${[...minutes].sort((a, b) => a - b).join(',')}`;

export function cachedIsochrones(lat, lng, minutes) {
  if (lat == null || lng == null) return null;
  const row = db.prepare(`SELECT geojson FROM isochrones WHERE key = ? AND fetched_at > datetime('now', ?)`)
    .get(cacheKey(lat, lng, minutes), `-${MAX_AGE_DAYS} days`);
  return row ? JSON.parse(row.geojson) : null;
}

export async function getIsochrones(lat, lng, minutes) {
  if (lat == null || lng == null || !hasMapbox()) return null;
  const cached = cachedIsochrones(lat, lng, minutes);
  if (cached) return cached;

  // Mapbox allows up to 4 contours of at most 60 minutes each. Typical (not live) traffic.
  const contours = [...minutes].sort((a, b) => a - b).slice(0, 4);
  const url = new URL(`https://api.mapbox.com/isochrone/v1/mapbox/driving/${lng},${lat}`);
  url.searchParams.set('contours_minutes', contours.join(','));
  url.searchParams.set('polygons', 'true');
  url.searchParams.set('denoise', '1');
  url.searchParams.set('generalize', '100');
  const shown = url.toString();
  url.searchParams.set('access_token', token());

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  db.prepare('INSERT INTO api_calls (endpoint, request_json, status, charged_usd, result_count, error) VALUES (?, ?, ?, 0, ?, ?)')
    .run('mapbox/isochrone', JSON.stringify({ url: shown }), res.status, body.features?.length ?? null, res.ok ? null : body.message ?? null);
  if (!res.ok) {
    const err = new Error(`Mapbox isochrone failed (${res.status}): ${body.message ?? 'unknown error'}`);
    err.status = 502;
    throw err;
  }
  db.prepare(`INSERT INTO isochrones (key, profile, geojson) VALUES (?, 'driving', ?)
    ON CONFLICT(key) DO UPDATE SET geojson = excluded.geojson, fetched_at = datetime('now')`)
    .run(cacheKey(lat, lng, minutes), JSON.stringify(body));
  return body;
}

// Ray-casting point-in-polygon for GeoJSON Polygon / MultiPolygon (holes respected).
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (x, y, rings) => inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h));
export function pointInGeometry(lng, lat, g) {
  if (!g) return false;
  if (g.type === 'Polygon') return inPolygon(lng, lat, g.coordinates);
  if (g.type === 'MultiPolygon') return g.coordinates.some((p) => inPolygon(lng, lat, p));
  return false;
}

// { 20: geometry, 30: geometry } from a Mapbox response.
export function contoursByMinutes(fc) {
  return Object.fromEntries((fc?.features ?? []).map((f) => [f.properties.contour, f.geometry]));
}
