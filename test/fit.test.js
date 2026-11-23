// Runs against the database in .env.local (the Neon dev branch), never production.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { one, pool } from '../src/db.js';
import { getProject, projectCandidate } from '../src/projects.js';
import { fitStatement } from '../src/fit.js';

const org = await one('SELECT org_uid FROM projects WHERE id = 1');
const fh = await getProject(1, org.org_uid);
after(() => pool.end());

const statementFor = async (where) => {
  const row = await one(`SELECT pin FROM candidates WHERE excluded IS NULL AND ${where} ORDER BY pin LIMIT 1`);
  assert.ok(row, `the dev database has a parcel where ${where}`);
  return fitStatement(fh, await projectCandidate(fh, row.pin));
};

test('every finding has a verdict, a basis and a one-line finding; known ones cite a source', async () => {
  const s = await statementFor("sports_verdict = 'permitted' AND acres BETWEEN 5 AND 80");
  for (const f of s.sections.flatMap((x) => x.findings)) {
    assert.ok(['favorable', 'neutral', 'unfavorable', 'unknown'].includes(f.verdict), f.key);
    assert.ok(['known', 'likely', 'unknown'].includes(f.basis), f.key);
    assert.ok(f.finding.length > 0, f.key);
    if (f.basis === 'known') assert.ok(f.sources.length > 0, `${f.key} is known but cites no source`);
  }
});

test('zoning that prohibits the use is a deal-breaker', async () => {
  const s = await statementFor("sports_verdict = 'prohibited' AND acres BETWEEN 5 AND 80");
  assert.equal(s.overall.key, 'no');
  assert.ok(s.dealBreakers.some((b) => b.label === 'Zoning'));
});

test('unread zoning means not enough evidence, and asks for the zoning to be read', async () => {
  const s = await statementFor("sports_verdict = 'unknown' AND city = 'SEATTLE' AND acres BETWEEN 5 AND 80");
  assert.equal(s.overall.key, 'evidence');
  assert.ok(s.diligence.some((d) => d.label === 'Zoning' && /Areas page/.test(d.text)));
});

test('a site that fails a Must criterion does not fit, whatever else is true', async () => {
  const s = await statementFor("sports_verdict = 'permitted' AND acres > 80");
  assert.equal(s.overall.key, 'no');
  assert.ok(s.dealBreakers.some((b) => b.label === 'Your criteria'));
});

test('the argument only states things the findings support', async () => {
  const s = await statementFor("sports_verdict = 'conditional' AND acres BETWEEN 5 AND 80");
  assert.equal(s.overall.key, 'conditions');
  assert.match(s.argument, /conditional use permit/);
  assert.doesNotMatch(s.argument, /allowed outright/);
});

test('a project that does not check sports zoning never gets sports zoning verdicts', async () => {
  const row = await one("SELECT pin FROM candidates WHERE excluded IS NULL AND sports_verdict = 'permitted' AND acres BETWEEN 5 AND 80 AND tags LIKE '%vacant-land%' ORDER BY pin LIMIT 1");
  const agri = { ...fh, spec: { ...fh.spec,
    requirements: fh.spec.requirements.filter((r) => r.field !== 'zoning.sports_facility'),
    preferences: fh.spec.preferences.filter((p) => p.field !== 'zoning.sports_facility'),
    pending: [{ key: 'other_use_zoning', value: 'Zoning that allows an agritourism business with guest stays' }] } };
  const s = await fitStatement(agri, await projectCandidate(agri, row.pin));
  const zoning = s.sections[1].findings.find((f) => f.key === 'zoning');
  assert.equal(zoning.verdict, 'unknown');
  assert.match(zoning.finding, /agritourism/);
  assert.equal(s.overall.key, 'evidence');
});
