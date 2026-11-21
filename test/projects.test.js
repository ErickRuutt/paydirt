// Runs against the database in .env.local (the Neon dev branch), never production.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { one, run, pool } from '../src/db.js';
import { createProject, updateProject, getProject, previewCount, projectCandidates } from '../src/projects.js';

const org = await one('SELECT org_uid FROM projects WHERE id = 1');
const user = { uid: null, orgUid: org.org_uid };
const spec = { requirements: [{ field: 'acres', value: [5, 80] }], preferences: [{ field: 'acres', weight: 25, params: { min: 13, max: 40 } }] };
const made = [];
after(async () => {
  for (const id of made) { await run('DELETE FROM project_spec_history WHERE project_id = ?', [id]); await run('DELETE FROM projects WHERE id = ?', [id]); }
  await pool.end();
});

test('a save based on an older version is refused with the current project', async () => {
  const p = await createProject({ name: 'test: conflict', spec }, user); made.push(p.id);
  const v = p.spec_version;
  await updateProject(p.id, { spec: { ...spec, requirements: [{ field: 'acres', value: [10, 80] }] }, baseVersion: v }, user);
  await assert.rejects(
    updateProject(p.id, { spec: { ...spec, requirements: [{ field: 'acres', value: [20, 80] }] }, baseVersion: v }, user),
    (e) => e.status === 409 && e.project.spec_version === v + 1,
  );
  assert.deepEqual((await getProject(p.id, user.orgUid)).spec.requirements[0].value, [10, 80]);
});

test('two saves from the same version produce one new version, not two', async () => {
  const p = await createProject({ name: 'test: race', spec }, user); made.push(p.id);
  const v = p.spec_version;
  const results = await Promise.allSettled([
    updateProject(p.id, { spec: { ...spec, requirements: [{ field: 'acres', value: [6, 80] }] }, baseVersion: v }, user),
    updateProject(p.id, { spec: { ...spec, requirements: [{ field: 'acres', value: [7, 80] }] }, baseVersion: v }, user),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const n = await one('SELECT count(*)::int AS n FROM project_spec_history WHERE project_id = ? AND version = ?', [p.id, v + 1]);
  assert.equal(n.n, 1);
});

test("the preview count matches the list total for Field House's saved criteria", async () => {
  const fh = await getProject(1, user.orgUid);
  const list = await projectCandidates(fh, { hidePassed: 'true', limit: 1 });
  assert.equal(await previewCount(fh, fh.spec, { hidePassed: true }), list.total);
});
