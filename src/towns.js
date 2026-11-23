// Which town a parcel belongs to, for counties whose parcel data doesn't say (statewide layer, Pierce):
//   city   – the incorporated city it sits inside (Census city limits), or null when unincorporated
//   postal – the town people would call it: its city, else the Census-designated place it's in,
//            else the nearest city within 10 miles (so "Gig Harbor" finds the land around Gig Harbor too)
// Boundaries come from the Census TIGERweb service once per process and are cached.

const TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer';
const cache = new Map();

async function layer(id, state) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const url = `${TIGER}/${id}/query?${new URLSearchParams({ where: `STATE='${state}'`, outFields: 'BASENAME', outSR: '4326', maxAllowableOffset: '0.0005',
      resultOffset: String(offset), resultRecordCount: '500', returnGeometry: 'true', f: 'json' })}`;
    const j = await (await fetch(url, { signal: AbortSignal.timeout(90_000) })).json();
    if (j.error) throw new Error(j.error.message ?? 'Census boundaries unavailable');
    out.push(...j.features);
    if (j.features.length < 500) break;
  }
  return out.map((f) => {
    const rings = f.geometry?.rings ?? [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sx = 0, sy = 0, n = 0;
    for (const r of rings) for (const [x, y] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); sx += x; sy += y; n++; }
    return { name: f.attributes.BASENAME, rings, box: [minX, minY, maxX, maxY], center: n ? [sx / n, sy / n] : null };
  });
}

export async function townsFor(state) {
  if (!cache.has(state)) cache.set(state, Promise.all([layer(4, state), layer(5, state)]).then(([cities, cdps]) => ({ cities, cdps })));
  return cache.get(state);
}

// Even-odd test over every ring, so holes are respected.
function inside(x, y, p) {
  if (x < p.box[0] || x > p.box[2] || y < p.box[1] || y > p.box[3]) return false;
  let hit = false;
  for (const r of p.rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) hit = !hit;
  }
  return hit;
}
const miles = (a, b) => { const k = Math.PI / 180, dx = (a[0] - b[0]) * Math.cos(((a[1] + b[1]) / 2) * k), dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy) * 69.05; };

export function townOf(towns, lng, lat) {
  if (lng == null || lat == null) return { city: null, postal: null };
  const city = towns.cities.find((p) => inside(lng, lat, p));
  if (city) return { city: city.name.toUpperCase(), postal: city.name.toUpperCase() };
  const cdp = towns.cdps.find((p) => inside(lng, lat, p));
  if (cdp) return { city: null, postal: cdp.name.toUpperCase() };
  let best = null, bestD = 10;
  for (const p of towns.cities) { if (!p.center) continue; const d = miles([lng, lat], p.center); if (d < bestD) { bestD = d; best = p; } }
  return { city: null, postal: best ? best.name.toUpperCase() : null };
}
