// One-time: copy app state (parcels, notes, zoning rules, API log, enrichments, drive-time cache)
// from the old local SQLite file into Neon. Sales and Census data are reloaded by their import scripts.
// Usage: node --env-file-if-exists=.env scripts/copy-local-sqlite.js [data/paydirt.db]
import { DatabaseSync } from 'node:sqlite';
import { connect, insertMany } from './lib/pg-script.js';

const file = process.argv[2] ?? new URL('../data/paydirt.db', import.meta.url).pathname;
const lite = new DatabaseSync(file, { readOnly: true });
const client = await connect();

const TABLES = {
  parcels: 'ON CONFLICT (parcelnumb) DO NOTHING',
  zoning_rules: 'ON CONFLICT (jurisdiction, zone, use) DO NOTHING',
  api_calls: 'ON CONFLICT (id) DO NOTHING',
  enrichments: 'ON CONFLICT (id) DO NOTHING',
  isochrones: 'ON CONFLICT (key) DO NOTHING',
};
for (const [table, onConflict] of Object.entries(TABLES)) {
  const exists = lite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) { console.log(`${table}: not in local file`); continue; }
  const rows = lite.prepare(`SELECT * FROM ${table}`).all();
  if (!rows.length) { console.log(`${table}: 0 rows`); continue; }
  const cols = Object.keys(rows[0]);
  await insertMany(client, table, cols, rows.map((r) => cols.map((c) => r[c])), { onConflict });
  console.log(`${table}: ${rows.length} rows`);
}
// Keep SERIAL counters ahead of copied ids.
for (const t of ['api_calls', 'enrichments']) {
  await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${t}), 1))`);
}
await client.end();
