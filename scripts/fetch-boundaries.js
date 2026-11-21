// Download King County city limits and the Urban Growth Area boundary (free county GIS),
// simplified for the map, into public/data/. These are public boundaries, so they're served as
// static files. Usage: npm run fetch:boundaries
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'https://gismaps.kingcounty.gov/arcgis/rest/services/Districts/DistrictsReport/MapServer';
const OUT = new URL('../public/data/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

async function layer(id, outFields) {
  const url = `${BASE}/${id}/query?` + new URLSearchParams({
    where: '1=1', outFields, outSR: '4326', maxAllowableOffset: '0.0002', geometryPrecision: '5', f: 'geojson',
  });
  const j = await (await fetch(url, { signal: AbortSignal.timeout(120_000) })).json();
  if (!j.features) throw new Error(`Layer ${id}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// City limits: one feature per piece; JURIS is the short code, CITYNAME the name (unincorporated "King County" pieces are dropped).
const cities = await layer(2, 'JURIS,CITYNAME');
cities.features = cities.features
  .filter((f) => f.geometry && f.properties.CITYNAME && !/uninc|^king county$/i.test(f.properties.CITYNAME.trim()))
  .map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { name: titleCase(f.properties.CITYNAME), juris: f.properties.JURIS } }));
writeFileSync(OUT + 'city-limits.geojson', JSON.stringify(cities));

// Urban Growth Area: UGASIDE says which side of the line (urban vs rural).
const uga = await layer(24, 'UGASIDE');
uga.features = uga.features.filter((f) => f.geometry).map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { side: f.properties.UGASIDE } }));
writeFileSync(OUT + 'urban-growth-area.geojson', JSON.stringify(uga));

console.log(`City limits: ${cities.features.length} pieces. Urban growth area: ${uga.features.length} pieces (${[...new Set(uga.features.map((f) => f.properties.side))].join(', ')}).`);

function titleCase(s) { return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
