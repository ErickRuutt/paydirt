// Shared helpers for one-off scripts: direct (unpooled) Neon connection and batched inserts.
import pg from 'pg';

const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '').replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full');
if (!url) throw new Error('DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set.');

export async function connect() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

// Multi-row INSERT in chunks that stay under Postgres's 65,535 parameter limit.
export async function insertMany(client, table, cols, rows, { onConflict = '' } = {}) {
  const per = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const values = chunk.map((_, r) => `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(', ')})`).join(', ');
    await client.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values} ${onConflict}`, chunk.flat());
  }
}

export async function setMeta(client, name, rows, source) {
  await client.query(`INSERT INTO dataset_meta (name, imported_at, rows, source) VALUES ($1, now()::text, $2, $3)
    ON CONFLICT (name) DO UPDATE SET imported_at = excluded.imported_at, rows = excluded.rows, source = excluded.source`, [name, rows, source]);
}

// Minimal CSV splitter: quoted fields, "" escapes, no embedded newlines (true for the assessor extracts).
export function splitCsv(line) {
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
