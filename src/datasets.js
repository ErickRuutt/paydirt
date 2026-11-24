import { all, one, run } from './db.js';
import { countyOf, LAYERS } from './counties.js';

// What Paydirt holds for a county, layer by layer (the `datasets` table), and the "ladder" the unlock screen shows:
// for each layer of facts, whether an unlock brings it, brings part of it, or doesn't have it yet.

// Record what a county load brought in. Free public sources cost us nothing; a bought source records its cost.
export async function recordDatasets(fips, { rows, minAcres = null, asOf = null, costUsd = 0 } = {}, q = { run }) {
  const c = countyOf(fips);
  if (!c) return;
  for (const l of LAYERS) {
    const has = c.layers?.[l.key];
    if (!has || has.state === 'no' || has.state === 'site') continue;
    await q.run(`INSERT INTO datasets (county_fips, layer, status, rows, min_acres, source_label, source_url, licence, cost_usd, note, as_of)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'public record', ?, ?, COALESCE(?::timestamptz, now()))
      ON CONFLICT (county_fips, layer) DO UPDATE SET status = excluded.status, rows = excluded.rows, min_acres = LEAST(datasets.min_acres, excluded.min_acres),
        source_label = excluded.source_label, source_url = excluded.source_url, cost_usd = datasets.cost_usd + excluded.cost_usd, note = excluded.note,
        as_of = excluded.as_of, updated_at = now()`,
    [fips, l.key, has.state === 'yes' ? 'loaded' : 'partial', rows ?? null, minAcres, c.sources?.parcels?.label ?? null, c.sources?.parcels?.url ?? null,
      l.key === 'parcels' ? costUsd : 0, has.note ?? null, asOf]);
  }
}

// Counties loaded before this table existed get their rows the first time someone looks.
async function ensure(fips) {
  if (await one('SELECT 1 FROM datasets WHERE county_fips = ? LIMIT 1', [fips])) return;
  const have = await one('SELECT count(*)::int AS n, min(acres) AS min_acres, max(updated_at) AS as_of FROM candidates WHERE county_fips = ?', [fips]);
  if (have?.n) await recordDatasets(fips, { rows: have.n, minAcres: Math.floor(have.min_acres ?? 0), asOf: have.as_of });
}

// The ladder for one county. `mine` = this organization already has the county.
export async function ladder(fips, mine) {
  const c = countyOf(fips);
  await ensure(fips);
  const held = new Map((await all('SELECT layer, rows, as_of FROM datasets WHERE county_fips = ?', [fips])).map((d) => [d.layer, d]));
  const layers = LAYERS.map((l) => {
    const has = c?.layers?.[l.key] ?? { state: 'no' };
    return { key: l.key, label: l.label, answers: l.answers, state: has.state, note: has.note ?? null,
      have: Boolean(mine && held.has(l.key)), asOf: held.get(l.key)?.as_of ?? null };
  });
  return { layers, covered: layers.filter((l) => l.state === 'yes' || l.state === 'partial').length, of: layers.length };
}
