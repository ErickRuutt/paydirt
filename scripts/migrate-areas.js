// One-off, safe to re-run: move town names out of each project's criteria into its areas (project_areas).
// Usage: npm run areas:migrate
import { all, pool } from '../src/db.js';
import { updateProject } from '../src/projects.js';

const rows = await all("SELECT id, name, org_uid, spec FROM projects WHERE NOT archived AND spec LIKE '%\"field\":\"area\"%'");
for (const r of rows) {
  const spec = JSON.parse(r.spec);
  const names = spec.requirements.filter((x) => x.field === 'area').flatMap((x) => x.value);
  const p = await updateProject(r.id, { spec, changeNote: 'Towns moved from the criteria to the project’s areas.' }, { orgUid: r.org_uid, uid: null }, 'migration');
  console.log(`${r.name}: ${names.join(', ')} → ${p.areas.map((a) => `${a.place ?? 'all of'} ${a.county_name ?? '(not placed)'}`).join('; ')}`);
}
console.log(`${rows.length} project(s) moved.`);
await pool.end();
