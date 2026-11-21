// One-time (Nov 21, 2026): turn the Field House search profile into a project and move existing
// parcel reviews into it. Safe to re-run: skips if a project named "Field House" exists.
import { connect } from './lib/pg-script.js';
import { FIELD_HOUSE_SPEC, normalizeSpec } from '../src/spec.js';

const client = await connect();
const existing = await client.query("SELECT id FROM projects WHERE name = 'Field House'");
if (existing.rows.length) { console.log('Field House project already exists:', existing.rows[0].id); await client.end(); process.exit(0); }
const { spec, errors } = normalizeSpec(FIELD_HOUSE_SPEC);
if (errors.length) throw new Error(errors.join(' '));
const brief = 'Rec fields focused on local sports and incubator athletic programs, plus restaurant, coworking and community space, '
  + 'built around renting space to teams. Looking for 13–15+ acres near affluent, growing family areas (~$200k+ household income, '
  + 'good schools) within 20–30 minutes, e.g. Duvall, Carnation, Sammamish, east Bellevue. On or off market.';
await client.query('BEGIN');
const { rows: [p] } = await client.query("INSERT INTO projects (name, brief, spec, created_by) VALUES ('Field House', $1, $2, 'migration') RETURNING id", [brief, JSON.stringify(spec)]);
await client.query("INSERT INTO project_spec_history (project_id, version, spec, change_note, source, changed_by) VALUES ($1, 1, $2, 'Moved from the Field House search profile', 'migration', 'migration')", [p.id, JSON.stringify(spec)]);
const moved = await client.query('INSERT INTO project_reviews (project_id, pin, status, notes, updated_by, updated_at) SELECT $1, pin, status, notes, updated_by, updated_at FROM candidate_reviews ON CONFLICT DO NOTHING', [p.id]);
await client.query('COMMIT');
console.log(`Created project ${p.id}; moved ${moved.rowCount} reviews.`);
await client.end();
