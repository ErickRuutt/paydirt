import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpec, compileSpec, failedRequirements, failedChecks } from '../src/spec.js';
import { specToChips, applyChipEdit } from '../src/chips.js';

// Field House's stored spec (production, Nov 21 2026).
const FIELD_HOUSE = {
  version: 1,
  uses: [{ use: 'sports_facility', role: 'primary' }],
  areas: ['WA:King'],
  requirements: [
    { field: 'zoning.sports_facility', value: ['permitted', 'conditional', 'unknown'], why: '' },
    { field: 'acres', value: [5, 80], why: '' },
  ],
  preferences: [
    { field: 'zoning.sports_facility', weight: 18, params: { points: { permitted: 100, conditional: 67, unknown: 33, prohibited: 0 } }, why: '' },
    { field: 'acres', weight: 12, params: { min: 13, max: 40, nearRange: 50, outOfRange: 17 }, why: '' },
    { field: 'vacancy', weight: 10, params: { vacant: 100, lightlyBuilt: 48 }, why: '' },
    { field: 'owner_signals', weight: 35, params: { points: { held_30y: 35, held_20y: 25 } }, why: '' },
    { field: 'hh200k_10mi', weight: 25, params: { target: 60000 }, why: '' },
    { field: 'business_on_site', weight: 10, params: { anchor: 0, operating: 15, closing: 65, emptyBuilding: 70, none: 100, cap: 40 }, why: '' },
  ],
};
const spec = () => normalizeSpec(structuredClone(FIELD_HOUSE)).spec;
const chip = (s, key) => specToChips(s).find((c) => c.key === key);

test('Field House reads as chips: Size has both a must range and a nice target', () => {
  const size = chip(spec(), 'size');
  assert.deepEqual(size.must.acres, [5, 80]);
  assert.equal(size.nice.params.acres.min, 13);
  assert.equal(size.nice.params.acres.max, 40);
});

test('importance labels come from the nearest of 10 / 25 / 50', () => {
  const s = spec();
  assert.equal(chip(s, 'zoning').nice.importance, 'some'); // 18
  assert.equal(chip(s, 'size').nice.importance, 'little'); // 12
  assert.equal(chip(s, 'sell').nice.importance, 'some'); // 35
  assert.equal(chip(s, 'families').nice.importance, 'some'); // 25
  assert.equal(chip(s, 'site').nice.importance, 'some'); // vacancy 10 + business 10 = 20
});

test('all five standard chips are present, unset ones included', () => {
  const keys = specToChips(spec()).filter((c) => c.standard).map((c) => c.key);
  assert.deepEqual(keys, ['size', 'where', 'zoning', 'site', 'sell']);
  assert.equal(chip(spec(), 'where').must, null);
});

test('editing only the Size range keeps its stored weight', () => {
  const next = applyChipEdit(spec(), 'size', { must: { acres: [10, 60] }, nice: { importance: 'little', params: { acres: { min: 15, max: 30 } } } });
  const pref = next.preferences.find((p) => p.field === 'acres');
  assert.equal(pref.weight, 12);
  assert.equal(pref.params.min, 15);
  assert.deepEqual(next.requirements.find((r) => r.field === 'acres').value, [10, 60]);
});

test('changing importance rewrites the weight; multi-field chips keep their ratio', () => {
  let next = applyChipEdit(spec(), 'size', { must: { acres: [5, 80] }, nice: { importance: 'lot', params: {} } });
  assert.equal(next.preferences.find((p) => p.field === 'acres').weight, 50);
  next = applyChipEdit(spec(), 'site', { must: null, nice: { importance: 'lot', params: {} } });
  const w = Object.fromEntries(next.preferences.filter((p) => ['vacancy', 'business_on_site'].includes(p.field)).map((p) => [p.field, p.weight]));
  assert.deepEqual(w, { vacancy: 25, business_on_site: 25 });
});

test('untouched chips round-trip unchanged', () => {
  const next = applyChipEdit(spec(), 'size', { must: { acres: [5, 80] }, nice: { importance: 'little', params: {} } });
  assert.deepEqual(next.preferences.filter((p) => p.field !== 'acres'), spec().preferences.filter((p) => p.field !== 'acres'));
});

test('"Doesn\'t matter" clears a chip', () => {
  const next = applyChipEdit(spec(), 'size', { must: null, nice: null });
  assert.equal(chip(next, 'size').must, null);
  assert.equal(chip(next, 'size').nice, null);
});

test('a spec with only Must criteria saves, and every match scores 100', () => {
  const { spec: s, errors } = normalizeSpec({ requirements: [{ field: 'acres', value: [5, 80] }], preferences: [] });
  assert.deepEqual(errors, []);
  assert.match(compileSpec(s).scoreExpr, /100/);
});

test('pending criteria keep known keys and reject unknown ones', () => {
  const ok = normalizeSpec({ ...FIELD_HOUSE, pending: [{ key: 'drive_time', value: 'Within 30 min of Redmond' }] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.spec.pending, [{ key: 'drive_time', value: 'Within 30 min of Redmond' }]);
  const bad = normalizeSpec({ ...FIELD_HOUSE, pending: [{ key: 'teleport', value: 'x' }] });
  assert.ok(bad.errors.length > 0);
});

// Search reaches sites the criteria hide; each comes back with the reason it is hidden.
const row = (over = {}) => ({ acres: 26.3, sports_verdict: 'permitted', city: null, postal_city: 'REDMOND', present_use: 'Vacant(Single-family)',
  years_held: 25, signals: '[]', out_of_state: false, absentee: false, tags: '[]', hh200k_10mi: 50000, land_value: 1000000, ...over });

test('a site outside 5–80 acres is hidden by size', () => {
  const fails = failedChecks(spec(), row({ acres: 3.2 }));
  assert.deepEqual(fails.map((f) => f.field), ['acres']);
  assert.match(fails[0].reason, /acres/i);
  assert.deepEqual(failedRequirements(spec(), row({ acres: 3.2 })), [fails[0].reason]);
  assert.deepEqual(failedChecks(spec(), row()), []);
});

test('a Must "likely to sell" chip hides sites without the chosen signs', () => {
  const s = { ...spec(), requirements: [...spec().requirements, { field: 'owner_signals', value: ['held_20y'], why: '' }] };
  const fails = failedChecks(s, row({ years_held: 3 }));
  assert.deepEqual(fails.map((f) => f.field), ['owner_signals']);
  assert.match(fails[0].reason, /likely to sell/i);
  assert.deepEqual(failedChecks(s, row({ years_held: 25 })), []);
});

test('owner signals in JS mirror the SQL conditions', () => {
  const must = (keys) => ({ ...spec(), requirements: [{ field: 'owner_signals', value: keys, why: '' }] });
  const passes = (keys, r) => failedChecks(must(keys), row(r)).length === 0;
  assert.equal(passes(['held_20y'], { years_held: 30 }), false); // 30+ is the other bucket
  assert.equal(passes(['held_30y'], { years_held: 30 }), true);
  assert.equal(passes(['held_30y'], { years_held: null }), false);
  assert.equal(passes(['recently_inherited'], { signals: '["Recently inherited (2024)"]' }), true);
  assert.equal(passes(['inherited'], { signals: '["Recently inherited (2024)"]' }), false);
  assert.equal(passes(['inherited'], { signals: ['Inherited in 1998'] }), true);
  assert.equal(passes(['absentee'], { absentee: true, out_of_state: true }), false);
  assert.equal(passes(['absentee'], { absentee: true, out_of_state: null }), true);
  assert.equal(passes(['out_of_state', 'no_market_sale'], { signals: '["No market sale on record"]' }), true);
});
