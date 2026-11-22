// Runs against the database in .env.local (the Neon dev branch), never production.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { one, run, pool } from '../src/db.js';
import { createProject, updateProject, getProject, previewCount, projectCandidates, projectCandidate } from '../src/projects.js';

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

test('re-saving the same spec over one stored before `pending` existed adds no version', async () => {
  const p = await createProject({ name: 'test: legacy no-op', spec }, user); made.push(p.id);
  const legacy = { ...p.spec };
  delete legacy.pending;
  await run('UPDATE projects SET spec = ? WHERE id = ?', [JSON.stringify(legacy), p.id]);
  const saved = await updateProject(p.id, { spec, baseVersion: p.spec_version }, user);
  assert.equal(saved.spec_version, p.spec_version);
  const n = await one('SELECT count(*)::int AS n FROM project_spec_history WHERE project_id = ?', [p.id]);
  assert.equal(n.n, 1);
});

test('search finds a parcel the Must criteria hide, and says why', async () => {
  const p = await createProject({ name: 'test: search', spec }, user); made.push(p.id);
  const big = await one('SELECT pin, acres FROM candidates WHERE acres > 80 AND excluded IS NULL AND lat IS NOT NULL ORDER BY pin LIMIT 1');
  assert.ok(big, 'the dev database has a parcel over 80 acres');
  const res = await projectCandidates(p, { area: big.pin });
  const f = res.features.find((x) => x.id === big.pin);
  assert.ok(f, `searching ${big.pin} returns it even though it is outside 5–80 acres`);
  assert.match(f.properties.hiddenBecause[0], /Size/i);
  assert.ok(f.properties.hiddenFields.includes('acres'));
});

test('a blank search behaves like no search', async () => {
  const p = await createProject({ name: 'test: blank search', spec }, user); made.push(p.id);
  const res = await projectCandidates(p, { area: '   ', limit: 300 });
  assert.ok(res.features.length > 0);
  for (const f of res.features) {
    assert.ok(f.properties.acres >= 5 && f.properties.acres <= 80, `${f.id} is ${f.properties.acres} acres`);
    assert.deepEqual(f.properties.hiddenBecause, []);
    assert.deepEqual(f.properties.hiddenFields, []);
  }
  assert.equal(res.total, (await projectCandidates(p, { limit: 1 })).total);
});

test('an excluded parcel opened directly is hidden as excluded', async (t) => {
  const ex = await one('SELECT pin, excluded FROM candidates WHERE excluded IS NOT NULL ORDER BY pin LIMIT 1');
  // Only meaningful when the dev database has an excluded parcel.
  if (!ex) return t.skip('no excluded parcel in the dev database');
  const p = await createProject({ name: 'test: excluded', spec }, user); made.push(p.id);
  const c = await projectCandidate(p, ex.pin);
  assert.deepEqual(c.hiddenFields, ['excluded']);
  assert.deepEqual(c.hiddenBecause, [ex.excluded]);
});
