// Runs against the database in .env.local (the Neon dev branch), never production.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { run, pool } from '../src/db.js';
import { priceFor, PRICING, grantCredits, creditBalance } from '../src/unlock.js';

const ORG = 'org_test_unlock_credits';
after(async () => { await run('DELETE FROM credit_ledger WHERE org_uid = ?', [ORG]); await pool.end(); });

test('price is parcels × cost × markup, never below the minimum', () => {
  assert.equal(priceFor(0), PRICING.minCredits);
  assert.equal(priceFor(1583), Math.ceil(1583 * PRICING.perParcelUsd * PRICING.markup));
  assert.ok(priceFor(5427) > priceFor(1583));
});

test('the balance is the sum of grants and spends', async () => {
  assert.equal(await creditBalance(ORG), 0);
  await grantCredits(ORG, 100, 'test');
  await grantCredits(ORG, -30, 'test spend');
  assert.equal(await creditBalance(ORG), 70);
});

test('any Washington county is loadable; other states are not yet', async () => {
  const { isLoadable, fipsForCounty, countyOf } = await import('../src/counties.js');
  assert.equal(fipsForCounty('Gig Harbor (Pierce County, WA)'), '53053');
  assert.equal(fipsForCounty('Gig Harbor (Pierce County, Wa)'), '53053');
  assert.equal(fipsForCounty('Hood River (Hood River County, OR)'), null);
  assert.ok(isLoadable('53053') && isLoadable('53035') && isLoadable('53009') && isLoadable('53033'));
  assert.equal(isLoadable('41027'), false);
  assert.equal(countyOf('53035').name, 'Kitsap County');
});

test('a parcel inside city limits gets that city; one outside gets the nearest town', async () => {
  const { townOf } = await import('../src/towns.js');
  const square = (x, y, d, name) => ({ name, rings: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]], box: [x, y, x + d, y + d], center: [x + d / 2, y + d / 2] });
  const towns = { cities: [square(-122.6, 47.3, 0.05, 'Gig Harbor')], cdps: [square(-122.7, 47.2, 0.03, 'Fox Island')] };
  assert.deepEqual(townOf(towns, -122.58, 47.32), { city: 'GIG HARBOR', postal: 'GIG HARBOR' });
  assert.deepEqual(townOf(towns, -122.69, 47.21), { city: null, postal: 'FOX ISLAND' });
  assert.deepEqual(townOf(towns, -122.65, 47.33), { city: null, postal: 'GIG HARBOR' }); // ~2.5 miles out
  assert.deepEqual(townOf(towns, -121.0, 47.3), { city: null, postal: null }); // far from everything
});
