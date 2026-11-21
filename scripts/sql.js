// Ad-hoc read-only query for people and agents, so nobody hand-writes env loading and pool setup:
//   npm run sql -- "SELECT count(*) FROM candidates WHERE property_uid IS NULL"
// Runs inside a READ ONLY transaction; writes belong in a reviewed script under scripts/.
import pg from 'pg';

const sql = process.argv.slice(2).join(' ').trim();
if (!sql) { console.error('Usage: npm run sql -- "SELECT …"'); process.exit(2); }
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set. Add it to .env.'); process.exit(2); }
const client = new pg.Client({ connectionString: url.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full') });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const r = await client.query(sql);
  if (r.rows?.length) console.table(r.rows.slice(0, 200)); else console.log(`${r.command} · ${r.rowCount ?? 0} rows`);
  if (r.rows?.length > 200) console.log(`… ${r.rows.length - 200} more rows`);
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
