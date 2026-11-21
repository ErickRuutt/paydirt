// Apply db/schema.sql (idempotent). Usage: npm run db:migrate
import { readFileSync } from 'node:fs';
import { connect } from './lib/pg-script.js';

const client = await connect();
await client.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
const { rows } = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`);
console.log(`Schema applied. Tables: ${rows.map((r) => r.table_name).join(', ')}`);
await client.end();
