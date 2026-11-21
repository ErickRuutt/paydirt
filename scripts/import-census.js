// Import block-group shapes (TIGERweb, no key) and ACS 5-year demographics (Census API, needs CENSUS_API_KEY).
// Usage: node --env-file-if-exists=.env scripts/import-census.js
import { readFileSync } from 'node:fs';
import { db } from '../src/db.js';

const criteria = JSON.parse(readFileSync(new URL('../criteria.json', import.meta.url)));
const STATE = criteria.county.fips.slice(0, 2);
const COUNTY = criteria.county.fips.slice(2);
const ACS_YEAR = Number(process.env.ACS_YEAR ?? 2024);

// 1. Shapes: Census block groups, simplified (~30 m) to keep the map layer light.
const tigerUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS${ACS_YEAR}/MapServer/10/query?` + new URLSearchParams({
  where: `STATE='${STATE}' AND COUNTY='${COUNTY}'`,
  outFields: 'GEOID,INTPTLAT,INTPTLON,AREALAND',
  outSR: '4326', maxAllowableOffset: '0.0003', geometryPrecision: '5', f: 'geojson',
});
const geo = await (await fetch(tigerUrl)).json();
if (!geo.features?.length) throw new Error(`TIGERweb returned no block groups: ${JSON.stringify(geo).slice(0, 300)}`);

const upsertShape = db.prepare(`INSERT INTO block_groups (geoid, lat, lng, geometry_json) VALUES (?, ?, ?, ?)
  ON CONFLICT(geoid) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, geometry_json=excluded.geometry_json`);
db.exec('BEGIN');
for (const f of geo.features) {
  const p = f.properties;
  if (Number(p.AREALAND) === 0) continue; // water-only block groups
  upsertShape.run(p.GEOID, Number(p.INTPTLAT), Number(p.INTPTLON), JSON.stringify(f.geometry));
}
db.exec('COMMIT');
console.log(`Shapes: ${geo.features.length} block groups.`);

// 2. ACS 5-year estimates. Income brackets top out at $200k+, so that's our affluence proxy.
const key = process.env.CENSUS_API_KEY;
if (!key) {
  console.log('No CENSUS_API_KEY in .env, so demographics were skipped. Get a free key at https://api.census.gov/data/key_signup.html and rerun.');
  process.exit(0);
}
const VARS = {
  B01003_001E: 'population',
  B19001_001E: 'households',
  B19001_017E: 'hh_200k_plus',
  B19013_001E: 'median_income',
  B11005_002E: 'hh_with_kids',
};
const acsUrl = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5?` + new URLSearchParams({
  get: Object.keys(VARS).join(','), for: 'block group:*', in: `state:${STATE} county:${COUNTY} tract:*`, key,
});
const res = await fetch(acsUrl, { redirect: 'manual' });
if (!res.ok) throw new Error(`Census API ${res.status}: ${(await res.text()).slice(0, 300) || res.headers.get('location')}`);
const [head, ...rows] = await res.json();
const idx = Object.fromEntries(head.map((h, i) => [h, i]));
// Census uses large negative sentinels (e.g. -666666666) for "not available".
const val = (r, k) => { const n = Number(r[idx[k]]); return Number.isFinite(n) && n >= 0 ? n : null; };

const upsertAcs = db.prepare(`UPDATE block_groups SET acs_year = ?, population = ?, households = ?, hh_200k_plus = ?, median_income = ?, hh_with_kids = ? WHERE geoid = ?`);
let matched = 0;
db.exec('BEGIN');
for (const r of rows) {
  const geoid = r[idx.state] + r[idx.county] + r[idx.tract] + r[idx['block group']];
  matched += upsertAcs.run(ACS_YEAR, val(r, 'B01003_001E'), val(r, 'B19001_001E'), val(r, 'B19001_017E'), val(r, 'B19013_001E'), val(r, 'B11005_002E'), geoid).changes;
}
db.exec('COMMIT');
db.prepare(`INSERT INTO dataset_meta (name, imported_at, rows, source) VALUES ('acs', datetime('now'), ?, ?)
  ON CONFLICT(name) DO UPDATE SET imported_at=excluded.imported_at, rows=excluded.rows, source=excluded.source`)
  .run(matched, `ACS ${ACS_YEAR} 5-year, block groups`);
console.log(`Demographics: ${rows.length} rows from ACS ${ACS_YEAR}, ${matched} matched to shapes.`);
