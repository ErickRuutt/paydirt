// Download King County GIS parcels of MIN_ACRES+ (boundary, address, zoning, use, values) to
// data/raw/gis-parcels.json. Free public service, 1,000 features per request.
// Usage: node scripts/fetch-gis-parcels.js
import { writeFileSync } from 'node:fs';

const MIN_ACRES = Number(process.env.MIN_ACRES ?? 5);
const LAYER = 'https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer/2/query';
const FIELDS = 'PIN,ADDR_FULL,CTYNAME,POSTALCTYNAME,ZIP5,KCA_ZONING,KCA_ACRES,PREUSE_CODE,PREUSE_DESC,APPRLNDVAL,APPR_IMPR,PROPTYPE,OBJECTID';

const out = [];
for (let offset = 0; ; offset += 1000) {
  const url = LAYER + '?' + new URLSearchParams({
    where: `KCA_ACRES >= ${MIN_ACRES}`, outFields: FIELDS, orderByFields: 'OBJECTID',
    resultOffset: String(offset), resultRecordCount: '1000',
    outSR: '4326', maxAllowableOffset: '0.00005', geometryPrecision: '6', f: 'geojson',
  });
  let j;
  for (let attempt = 1; ; attempt++) {
    try { j = await (await fetch(url, { signal: AbortSignal.timeout(120_000) })).json(); break; }
    catch (e) { if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 2000 * attempt)); }
  }
  if (j.error) throw new Error(JSON.stringify(j.error));
  out.push(...j.features);
  process.stdout.write(`\r${out.length.toLocaleString()} parcels`);
  if (j.features.length < 1000) break;
}
const file = new URL('../data/raw/gis-parcels.json', import.meta.url).pathname;
writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', fetched_at: new Date().toISOString(), features: out }));
console.log(`\nSaved ${out.length} parcels to ${file}`);
