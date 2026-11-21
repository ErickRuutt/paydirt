// Load King County sales history into Neon, trimmed to parcels of MIN_ACRES+ (default 5),
// the land Paydirt searches. Full county history is ~2.45M rows; the trimmed set is ~50k.
// Sources (download and unzip into data/raw/):
//   https://aqua.kingcounty.gov/extranet/assessor/Real%20Property%20Sales.zip -> EXTR_RPSale.csv
//   https://aqua.kingcounty.gov/extranet/assessor/Parcel.zip                 -> parcel/EXTR_Parcel.csv
// Usage: npm run import:sales
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { connect, insertMany, setMeta, splitCsv } from './lib/pg-script.js';

const RAW = new URL('../data/raw/', import.meta.url).pathname;
const SALES_CSV = process.env.SALES_CSV ?? RAW + 'EXTR_RPSale.csv';
const PARCEL_CSV = process.env.PARCEL_CSV ?? RAW + 'parcel/EXTR_Parcel.csv';
const MIN_ACRES = Number(process.env.MIN_ACRES ?? 5);

async function* rowsOf(file) {
  let header = null;
  for await (const line of createInterface({ input: createReadStream(file, 'latin1'), crlfDelay: Infinity })) {
    if (!line) continue;
    const f = splitCsv(line);
    if (!header) { header = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
    yield (k) => f[header[k]]?.trim() ?? '';
  }
}
const pinOf = (get) => get('Major').padStart(6, '0') + get('Minor').padStart(4, '0');
const toIso = (mdy) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mdy); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };

// 1. Which parcels are big enough to keep.
const keep = new Set();
for await (const get of rowsOf(PARCEL_CSV)) if (Number(get('SqFtLot')) / 43560 >= MIN_ACRES) keep.add(pinOf(get));
console.log(`${keep.size.toLocaleString()} parcels of ${MIN_ACRES}+ acres.`);

// 2. Their sales.
const rows = []; let seen = 0;
for await (const get of rowsOf(SALES_CSV)) {
  seen++;
  const pin = pinOf(get), date = toIso(get('DocumentDate'));
  if (!keep.has(pin) || !date || /^0+$/.test(pin)) continue;
  rows.push([pin, date, Number(get('SalePrice')) || 0, Number(get('SaleInstrument')) || null, Number(get('SaleReason')) || null,
    get('SaleWarning') || null, get('SellerName') || null, get('BuyerName') || null, get('ExciseTaxNbr') || null, get('RecordingNbr') || null]);
}
console.log(`Kept ${rows.length.toLocaleString()} of ${seen.toLocaleString()} sales.`);

// 3. Replace the table contents in one transaction so the app never sees a half-loaded table.
const client = await connect();
await client.query('BEGIN');
await client.query('DELETE FROM sales');
await insertMany(client, 'sales', ['pin', 'doc_date', 'price', 'instrument', 'reason', 'warning', 'seller', 'buyer', 'excise_nbr', 'recording_nbr'], rows);
await setMeta(client, 'kc_sales', rows.length, `King County Assessor EXTR_RPSale, parcels ${MIN_ACRES}+ acres`);
await client.query('COMMIT');
await client.query('ANALYZE sales');
await client.end();
console.log('Sales loaded.');
