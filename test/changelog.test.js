import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The change log is the gate on a push: each entry says what changed and why, in words a buyer would follow.
test('every change log entry says what changed and why', () => {
  const list = JSON.parse(readFileSync(new URL('../public/changelog.json', import.meta.url), 'utf8'));
  assert.ok(list.length > 0);
  for (const e of list) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.title && ['live', 'pending'].includes(e.status), `${e.date}: needs a title and a status`);
    assert.ok(e.changes.length > 0, `${e.title}: lists no changes`);
    for (const c of e.changes) assert.ok(c.what?.length > 20 && c.why?.length > 20, `${e.title}: a change is missing its what or why`);
  }
  assert.deepEqual(list.map((e) => e.date), list.map((e) => e.date).sort().reverse(), 'newest first');
});
