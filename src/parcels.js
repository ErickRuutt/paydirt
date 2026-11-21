import { db } from './db.js';
import { ownershipFor } from './ownership.js';
import { reachFor } from './demographics.js';

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

const upsert = db.prepare(`
INSERT INTO parcels (parcelnumb, county, jurisdiction, address, acres, lat, lng, owner, mail_address,
  zoning, zoning_type, zoning_description, zoning_code_link, use_desc, land_value, parcel_value,
  sale_price, sale_date, last_transfer_date, slope_p50, slope_p90, slope_frac_over_5, slope_valid_frac,
  elev_high, elev_low, flood_fraction, wetland_fraction, developable_acres, boundary_geojson, raw_json)
VALUES (:parcelnumb, :county, :jurisdiction, :address, :acres, :lat, :lng, :owner, :mail_address,
  :zoning, :zoning_type, :zoning_description, :zoning_code_link, :use_desc, :land_value, :parcel_value,
  :sale_price, :sale_date, :last_transfer_date, :slope_p50, :slope_p90, :slope_frac_over_5, :slope_valid_frac,
  :elev_high, :elev_low, :flood_fraction, :wetland_fraction, :developable_acres, :boundary_geojson, :raw_json)
ON CONFLICT(parcelnumb) DO UPDATE SET
  county=excluded.county, jurisdiction=excluded.jurisdiction, address=excluded.address, acres=excluded.acres,
  lat=excluded.lat, lng=excluded.lng, owner=excluded.owner, mail_address=excluded.mail_address,
  zoning=excluded.zoning, zoning_type=excluded.zoning_type, zoning_description=excluded.zoning_description,
  zoning_code_link=excluded.zoning_code_link, use_desc=excluded.use_desc, land_value=excluded.land_value,
  parcel_value=excluded.parcel_value, sale_price=excluded.sale_price, sale_date=excluded.sale_date,
  last_transfer_date=excluded.last_transfer_date, slope_p50=excluded.slope_p50, slope_p90=excluded.slope_p90,
  slope_frac_over_5=excluded.slope_frac_over_5, slope_valid_frac=excluded.slope_valid_frac,
  elev_high=excluded.elev_high, elev_low=excluded.elev_low, flood_fraction=excluded.flood_fraction,
  wetland_fraction=excluded.wetland_fraction, developable_acres=excluded.developable_acres,
  boundary_geojson=COALESCE(excluded.boundary_geojson, parcels.boundary_geojson),
  raw_json=excluded.raw_json, updated_at=datetime('now')
`);

export function storeMatches(matches) {
  let stored = 0;
  for (const m of matches) {
    const f = m.fields ?? {};
    if (!m.parcelnumb) continue;
    const mail = [v(f.mailadd), v(f.mail_city), v(f.mail_state2)].filter(Boolean).join(', ');
    upsert.run({
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
    });
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

const rulesFor = db.prepare('SELECT use, verdict, notes, source_url FROM zoning_rules WHERE jurisdiction = ? AND zone = ?');

export function zoningVerdict(p, uses) {
  if (!p.zoning) return { overall: 'unknown', byUse: {} };
  const rows = rulesFor.all(p.jurisdiction, p.zoning);
  const byUse = Object.fromEntries(uses.map((u) => [u, rows.find((r) => r.use === u)?.verdict ?? 'unknown']));
  const vs = Object.values(byUse);
  const overall = vs.includes('prohibited') ? 'prohibited' : vs.includes('unknown') ? 'unknown' : vs.includes('conditional') ? 'conditional' : 'permitted';
  return { overall, byUse };
}

export function parcelsGeoJSON(criteria) {
  const rows = db.prepare('SELECT * FROM parcels ORDER BY updated_at DESC').all();
  const features = rows.map((p) => {
    const { raw_json, boundary_geojson, ...props } = p;
    const s = screen(p, criteria.screen);
    const z = zoningVerdict(p, criteria.uses);
    const geometry = boundary_geojson ? JSON.parse(boundary_geojson) : p.lng != null ? { type: 'Point', coordinates: [p.lng, p.lat] } : null;
    const own = ownershipFor(p.parcelnumb);
    const reach = reachFor(p.lat, p.lng, [criteria.reachHeadlineMiles])?.[criteria.reachHeadlineMiles] ?? null;
    return {
      type: 'Feature',
      geometry,
      properties: {
        ...props, screen: s.result, checks: s.checks, zoningOverall: z.overall, zoningByUse: z.byUse, hasBoundary: Boolean(boundary_geojson),
        yearsSinceMarketSale: own.yearsSinceMarketSale ?? null, yearsSinceTransfer: own.yearsSinceTransfer ?? null,
        ownerSignals: own.signals ?? [], hh200kNearby: reach?.hh200k ?? null, share200kNearby: reach?.share200k ?? null,
      },
    };
  }).filter((f) => f.geometry);
  return { type: 'FeatureCollection', features };
}
