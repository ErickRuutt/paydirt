// Fill missing parcel addresses from each county's address points. Safe to re-run; only empty addresses change.
// Usage: npm run addresses:fill -- [county_fips …]   (default: every loaded county)
import { all, pool } from '../src/db.js';
import { fillAddresses } from '../src/addresses.js';

const fipsList = process.argv.slice(2).length ? process.argv.slice(2) : (await all('SELECT DISTINCT county_fips FROM candidates')).map((r) => r.county_fips);
for (const fips of fipsList) console.log(`${fips}: ${await fillAddresses(fips)} parcels got an address.`);
await pool.end();
