// Stamp zone codes on parcels from the public zoning maps in src/zoneLayers.js. Safe to re-run.
// Usage: npm run zones:fill -- [county_fips …]   (default: every county that has a zoning map)
import { pool } from '../src/db.js';
import { fillZones, ZONE_LAYERS } from '../src/zoneLayers.js';

const fipsList = process.argv.slice(2).length ? process.argv.slice(2) : [...new Set(ZONE_LAYERS.map((l) => l.fips))];
for (const fips of fipsList) for (const r of await fillZones(fips)) console.log(`${fips} ${r.place}: ${r.zoned} of ${r.parcels} parcels got a zone.`);
await pool.end();
