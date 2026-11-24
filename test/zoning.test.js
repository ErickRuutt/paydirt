import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReading } from '../src/zoningReader.js';
import { jurisdictionKey } from '../src/zoneLayers.js';
import { inside } from '../src/towns.js';
import { pool } from '../src/db.js';

test.after(() => pool.end());

test('a zoning reading keeps only the zones asked for, with known verdicts', () => {
  const r = parseReading(`ZONE | B-2 | permitted | Commercial recreation, indoor and outdoor, is permitted (GHMC 17.14.020).
- ZONE | r-1 (Single-Family Residential) | Prohibited | Not listed (GHMC 17.14.020).
ZONE | ED | maybe | unclear
ZONE | XX | permitted | a zone nobody asked about
SOURCE | https://example.gov/code/17.14
CURRENT | March 2026`, ['B-2', 'R-1', 'ED']);
  assert.deepEqual(r.rules.map((x) => [x.zone, x.verdict]), [['B-2', 'permitted'], ['R-1', 'prohibited']]);
  assert.equal(r.source, 'https://example.gov/code/17.14');
  assert.equal(r.current, 'March 2026');
});

test('a reading with no source page has no source', () => {
  assert.equal(parseReading('ZONE | B-2 | permitted | ok\nSOURCE | see the city site\nCURRENT | not shown', ['B-2']).source, null);
});

test('jurisdictions are keyed by county and city, so same-named cities stay apart', () => {
  assert.equal(jurisdictionKey('53053', 'GIG HARBOR'), '53053:GIG HARBOR');
  assert.equal(jurisdictionKey('53053', null), '53053:');
});

test('a point is matched to the zone shape that contains it', () => {
  const sq = { rings: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]], box: [0, 0, 2, 2] };
  assert.equal(inside(1, 1, sq), true);
  assert.equal(inside(3, 1, sq), false);
});
