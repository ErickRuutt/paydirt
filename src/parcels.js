import { all, run } from './db.js';
import { ownershipForMany } from './ownership.js';
import { reachFor } from './demographics.js';

const COLS = ['parcelnumb', 'county', 'jurisdiction', 'address', 'acres', 'lat', 'lng', 'owner', 'mail_address',
  'zoning', 'zoning_type', 'zoning_description', 'zoning_code_link', 'use_desc', 'land_value', 'parcel_value',
  'sale_price', 'sale_date', 'last_transfer_date', 'slope_p50', 'slope_p90', 'slope_frac_over_5', 'slope_valid_frac',
  'elev_high', 'elev_low', 'flood_fraction', 'wetland_fraction', 'developable_acres', 'boundary_geojson', 'raw_json'];

// Mireye may return a field as a bare value or as { value, source, confidence }.
const v = (x) => (x && typeof x === 'object' && !Array.isArray(x) && 'value' in x ? x.value : x ?? null);
const num = (x) => { const n = Number(v(x)); return v(x) == null || Number.isNaN(n) ? null : n; };

function parseBoundary(raw) {
  const g = v(raw);
  if (!g) return null;
  try {
    const obj = typeof g === 'string' ? JSON.parse(g) : g;
    const geom = obj.type === 'Feature' ? obj.geometry : obj;
    return ['Polygon', 'MultiPolygon'].includes(geom?.type) ? JSON.stringify(geom) : null;
  } catch { return null; }
}

const UPSERT = `INSERT INTO parcels (${COLS.join(', ')}) VALUES (${COLS.map(() => '?').join(', ')})
ON CONFLICT (parcelnumb) DO UPDATE SET
  ${COLS.filter((c) => c !== 'parcelnumb' && c !== 'boundary_geojson').map((c) => `${c} = excluded.${c}`).join(', ')},
  boundary_geojson = COALESCE(excluded.boundary_geojson, parcels.boundary_geojson),
  updated_at = now()`;

export async function storeMatches(matches) {
  let stored = 0;
  for (const m of matches) {
    const f = m.fields ?? {};
    if (!m.parcelnumb) continue;
    const mail = [v(f.mailadd), v(f.mail_city), v(f.mail_state2)].filter(Boolean).join(', ');
    const row = {
      parcelnumb: String(m.parcelnumb),
      county: m.county ?? null,
      jurisdiction: m.scity ? String(m.scity).toUpperCase() : 'UNINCORPORATED / UNKNOWN',
      address: m.address ?? null,
      acres: num(m.pvd_gisacre ?? f.pvd_gisacre),
      lat: num(m.analysis_point?.lat ?? f.lat),
      lng: num(m.analysis_point?.lng ?? f.lon),
      owner: v(f.owner),
      mail_address: mail || null,
      zoning: v(f.zoning),
      zoning_type: v(f.zoning_type),
      zoning_description: v(f.zoning_description),
      zoning_code_link: v(f.zoning_code_link),
      use_desc: v(f.usedesc),
      land_value: num(f.landval),
      parcel_value: num(f.parval),
      sale_price: num(f.saleprice),
      sale_date: v(f.saledate),
      last_transfer_date: v(f.last_ownership_transfer_date),
      slope_p50: num(f.parcel_slope_pct_p50),
      slope_p90: num(f.parcel_slope_pct_p90),
      slope_frac_over_5: num(f.parcel_slope_frac_over_5pct),
      slope_valid_frac: num(f.parcel_slope_valid_frac),
      elev_high: num(f.highest_parcel_elevation),
      elev_low: num(f.lowest_parcel_elevation),
      flood_fraction: num(f.parcel_flood_sfha_fraction),
      wetland_fraction: num(f.wetland_fraction_of_parcel),
      developable_acres: num(f.developable_acres_proxy),
      boundary_geojson: parseBoundary(f.parcel_boundary_geojson),
      raw_json: JSON.stringify(m),
    };
    await run(UPSERT, COLS.map((c) => row[c] ?? null));
    stored++;
  }
  return stored;
}

// Pass / fail / unknown for each screen rule. Missing data is "unknown", never a silent pass.
export function screen(p, rules) {
  const check = (val, ok) => (val == null ? 'unknown' : ok(val) ? 'pass' : 'fail');
  const checks = {
    slope: check(p.slope_p50, (x) => x <= rules.maxMedianSlopePct),
    steepShare: check(p.slope_frac_over_5, (x) => x <= rules.maxFracOver5Pct),
    flood: check(p.flood_fraction, (x) => x <= rules.maxFloodFraction),
    wetland: check(p.wetland_fraction, (x) => x <= rules.maxWetlandFraction),
    developable: check(p.developable_acres, (x) => x >= rules.minDevelopableAcres),
  };
  const vals = Object.values(checks);
  const result = vals.includes('fail') ? 'fail' : vals.includes('unknown') ? 'review' : 'pass';
  return { checks, result, passCount: vals.filter((x) => x === 'pass').length };
}


export function zoningVerdict(p, uses, rules) {
  if (!p.zoning) return { overall: 'unknown', byUse: {} };
  const rows = rules.filter((r) => r.jurisdiction === p.jurisdiction && r.zone === p.zoning);
  const byUse = Object.fromEntries(uses.map((u) => [u, rows.find((r) => r.use === u)?.verdict ?? 'unknown']));
  const vs = Object.values(byUse);
  const overall = vs.includes('prohibited') ? 'prohibited' : vs.includes('unknown') ? 'unknown' : vs.includes('conditional') ? 'conditional' : 'permitted';
  return { overall, byUse };
}

export async function parcelsGeoJSON(criteria) {
  const [rows, rules] = await Promise.all([
    all('SELECT * FROM parcels ORDER BY updated_at DESC'),
    all('SELECT jurisdiction, zone, use, verdict FROM zoning_rules'),
  ]);
  const owners = await ownershipForMany(rows.map((p) => p.parcelnumb));
  const features = await Promise.all(rows.map(async (p) => {
    const { raw_json, boundary_geojson, ...props } = p;
    const s = screen(p, criteria.screen);
    const z = zoningVerdict(p, criteria.uses, rules);
    const geometry = boundary_geojson ? JSON.parse(boundary_geojson) : p.lng != null ? { type: 'Point', coordinates: [p.lng, p.lat] } : null;
    const own = owners.get(p.parcelnumb) ?? {};
    const reach = (await reachFor(p.lat, p.lng, [criteria.reachHeadlineMiles]))?.[criteria.reachHeadlineMiles] ?? null;
    return {
      type: 'Feature',
      geometry,
      properties: {
        ...props, screen: s.result, checks: s.checks, zoningOverall: z.overall, zoningByUse: z.byUse, hasBoundary: Boolean(boundary_geojson),
        yearsSinceMarketSale: own.yearsSinceMarketSale ?? null, yearsSinceTransfer: own.yearsSinceTransfer ?? null,
        ownerSignals: own.signals ?? [], hh200kNearby: reach?.hh200k ?? null, share200kNearby: reach?.share200k ?? null,
      },
    };
  }));
  return { type: 'FeatureCollection', features: features.filter((f) => f.geometry) };
}
