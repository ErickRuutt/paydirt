// Import block-group shapes (TIGERweb, no key) and ACS 5-year demographics (Census API, needs CENSUS_API_KEY).
// Usage: npm run import:census
import { readFileSync } from 'node:fs';
import { connect, insertMany, setMeta } from './lib/pg-script.js';

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

const client = await connect();
const shapes = geo.features.filter((f) => Number(f.properties.AREALAND) > 0) // skip water-only block groups
  .map((f) => [f.properties.GEOID, Number(f.properties.INTPTLAT), Number(f.properties.INTPTLON), JSON.stringify(f.geometry)]);
await insertMany(client, 'block_groups', ['geoid', 'lat', 'lng', 'geometry_json'], shapes,
  { onConflict: 'ON CONFLICT (geoid) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, geometry_json = excluded.geometry_json' });
console.log(`Shapes: ${shapes.length} block groups.`);

// 2. ACS 5-year estimates. Income brackets top out at $200k+, so that's our affluence proxy.
const key = process.env.CENSUS_API_KEY;
if (!key) {
  console.log('No CENSUS_API_KEY in .env, so demographics were skipped. Get a free key at https://api.census.gov/data/key_signup.html and rerun.');
  await client.end();
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

let matched = 0;
await client.query('BEGIN');
for (const r of rows) {
  const geoid = r[idx.state] + r[idx.county] + r[idx.tract] + r[idx['block group']];
  const u = await client.query(
    'UPDATE block_groups SET acs_year = $1, population = $2, households = $3, hh_200k_plus = $4, median_income = $5, hh_with_kids = $6 WHERE geoid = $7',
    [ACS_YEAR, val(r, 'B01003_001E'), val(r, 'B19001_001E'), val(r, 'B19001_017E'), val(r, 'B19013_001E'), val(r, 'B11005_002E'), geoid]);
  matched += u.rowCount;
}
await setMeta(client, 'acs', matched, `ACS ${ACS_YEAR} 5-year, block groups`);
await client.query('COMMIT');
await client.end();
console.log(`Demographics: ${rows.length} rows from ACS ${ACS_YEAR}, ${matched} matched to shapes.`);
