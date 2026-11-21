// Import the King County Assessor "Real Property Sales" extract into SQLite.
// Source: https://aqua.kingcounty.gov/extranet/assessor/Real%20Property%20Sales.zip (+ Lookup.zip)
// Usage: node scripts/import-sales.js [path/to/EXTR_RPSale.csv]
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { db } from '../src/db.js';

const file = process.argv[2] ?? new URL('../data/raw/EXTR_RPSale.csv', import.meta.url).pathname;

// Minimal CSV splitter: quoted fields, "" escapes, no embedded newlines (true for this extract).
function splitCsv(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const toIso = (mdy) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mdy.trim()); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };

db.exec('DROP TABLE IF EXISTS sales');
db.exec(`CREATE TABLE sales (
  pin TEXT NOT NULL, doc_date TEXT, price INTEGER, instrument INTEGER, reason INTEGER,
  warning TEXT, seller TEXT, buyer TEXT, excise_nbr TEXT, recording_nbr TEXT)`);

const insert = db.prepare('INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const rl = createInterface({ input: createReadStream(file, 'latin1'), crlfDelay: Infinity });

let header = null, n = 0, skipped = 0;
db.exec('BEGIN');
for await (const line of rl) {
  if (!line) continue;
  const f = splitCsv(line);
  if (!header) { header = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
  const major = f[header.Major]?.trim(), minor = f[header.Minor]?.trim();
  const date = toIso(f[header.DocumentDate] ?? '');
  if (!major || !minor || !date) { skipped++; continue; }
  insert.run(
    major.padStart(6, '0') + minor.padStart(4, '0'), date,
    Number(f[header.SalePrice]) || 0,
    Number(f[header.SaleInstrument]) || null, Number(f[header.SaleReason]) || null,
    f[header.SaleWarning]?.trim() || null,
    f[header.SellerName]?.trim() || null, f[header.BuyerName]?.trim() || null,
    f[header.ExciseTaxNbr]?.trim() || null, f[header.RecordingNbr]?.trim() || null,
  );
  if (++n % 200000 === 0) { db.exec('COMMIT; BEGIN'); console.log(`${n.toLocaleString()} rows…`); }
}
db.exec('COMMIT');
db.exec('CREATE INDEX IF NOT EXISTS sales_pin_date ON sales (pin, doc_date)');
db.prepare(`INSERT INTO dataset_meta (name, imported_at, rows, source) VALUES ('kc_sales', datetime('now'), ?, ?)
  ON CONFLICT(name) DO UPDATE SET imported_at=excluded.imported_at, rows=excluded.rows, source=excluded.source`)
  .run(n, 'King County Assessor EXTR_RPSale');
console.log(`Imported ${n.toLocaleString()} sales (${skipped} skipped).`);
