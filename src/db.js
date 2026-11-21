import pg from 'pg';

// Neon Postgres over node-postgres. DATABASE_URL is the pooled (-pooler) string for app traffic;
// schema changes and bulk loads use DATABASE_URL_UNPOOLED (see scripts/).
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Run `neon env pull` or add it to .env.');

// Neon's strings say sslmode=require; pg treats that as verify-full today, so say so explicitly.
const strict = (u) => u.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full');
export const pool = new pg.Pool({ connectionString: strict(process.env.DATABASE_URL), max: 5, idleTimeoutMillis: 30_000 });

// Write queries with ? placeholders; they are numbered for Postgres here.
const numbered = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

export const all = async (sql, params = []) => (await pool.query(numbered(sql), params)).rows;
export const one = async (sql, params = []) => (await pool.query(numbered(sql), params)).rows[0] ?? null;
export const run = async (sql, params = []) => pool.query(numbered(sql), params);

export async function totalSpend() {
  return Number((await one('SELECT COALESCE(SUM(charged_usd), 0) AS s FROM api_calls')).s);
}
