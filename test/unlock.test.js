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
