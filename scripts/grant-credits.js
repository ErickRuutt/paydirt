// Add (or remove, with a negative number) credits for an organization while card payments aren't live.
// Usage: npm run credits:grant -- <org_uid | "project:<id>"> <credits> ["note"]
import { one, pool } from '../src/db.js';
import { grantCredits } from '../src/unlock.js';

const [who, amount, note = 'Manual grant'] = process.argv.slice(2);
if (!who || !amount) { console.error('Usage: npm run credits:grant -- <org_uid | project:<id>> <credits> ["note"]'); process.exit(2); }
const orgUid = who.startsWith('project:') ? (await one('SELECT org_uid FROM projects WHERE id = ?', [Number(who.slice(8))]))?.org_uid : who;
if (!orgUid) { console.error(`No organization found for ${who}.`); process.exit(1); }
console.log(`${orgUid}: balance now ${await grantCredits(orgUid, amount, note)} credits.`);
await pool.end();
