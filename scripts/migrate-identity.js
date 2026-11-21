// One-time (Nov 21, 2026), safe to re-run: create the Paydirt organization, give projects UIDs and an org,
// register every candidate parcel as a property, and move project_reviews into project_properties.
import { connect } from './lib/pg-script.js';
import { syncProperties } from './lib/properties.js';
import { newId } from '../src/ids.js';

const client = await connect();
await client.query('BEGIN');

let org = (await client.query("SELECT org_uid FROM orgs WHERE name = 'Paydirt'")).rows[0];
if (!org) { org = { org_uid: newId('org') }; await client.query("INSERT INTO orgs (org_uid, name) VALUES ($1, 'Paydirt')", [org.org_uid]); }

for (const p of (await client.query('SELECT id FROM projects WHERE project_uid IS NULL')).rows) {
  await client.query('UPDATE projects SET project_uid = $1 WHERE id = $2', [newId('prj'), p.id]);
}
await client.query('UPDATE projects SET org_uid = $1 WHERE org_uid IS NULL', [org.org_uid]);

const pins = (await client.query('SELECT pin FROM candidates')).rows.map((r) => r.pin);
const { added } = await syncProperties(client, { source: 'kc_assessor', countyFips: '53033', sourceIds: pins });
await client.query("UPDATE candidates c SET property_uid = p.property_uid FROM properties p WHERE p.source = 'kc_assessor' AND p.source_id = c.pin");

let moved = 0;
for (const r of (await client.query(`SELECT r.*, p.org_uid, pr.property_uid FROM project_reviews r JOIN projects p ON p.id = r.project_id
    JOIN properties pr ON pr.source = 'kc_assessor' AND pr.source_id = r.pin`)).rows) {
  const res = await client.query(`INSERT INTO project_properties (pp_uid, project_id, property_uid, org_uid, saved, status, notes, saved_at, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) ON CONFLICT (project_id, property_uid) DO NOTHING`,
    [newId('pp'), r.project_id, r.property_uid, r.org_uid, r.status !== 'new', r.status, r.notes ?? '', r.status !== 'new' ? r.updated_at : null, r.updated_at]);
  moved += res.rowCount;
}
await client.query('COMMIT');
const counts = (await client.query(`SELECT (SELECT count(*) FROM properties)::int AS properties, (SELECT count(*) FROM candidates WHERE property_uid IS NULL)::int AS unlinked,
  (SELECT string_agg(name || ' ' || project_uid, ', ') FROM projects) AS projects`)).rows[0];
console.log(`Org ${org.org_uid}. Properties added: ${added}. Reviews moved: ${moved}.`, counts);
await client.end();
