import { all, one, run } from './db.js';

// A profile is a buyer's "lens" over the shared candidate data: it decides how parcels are scored
// and which are hidden. Changing a profile re-scores at read time; nothing is re-fetched.
//
// Only one use has zoning rules so far (a sports facility: indoor athletic space + fields), so every
// profile scores zoning with sports_verdict. A new use (school, warehouse…) needs its own zoning rules.

export const DEFAULT_PROFILE = {
  use: 'sports_facility',
  acres: { min: 13, max: 40 },
  hideProhibitedZoning: true,
  maxAcres: 80,
  weights: { fit: 40, owner: 35, market: 25 },
  fit: { zoning: { permitted: 45, conditional: 30, unknown: 15, prohibited: 0 }, inRange: 30, nearRange: 15, outOfRange: 5, vacant: 25, lightlyBuilt: 12 },
  owner: { held30: 35, held20: 25, noMarketSale: 25, recentlyInherited: 30, inherited: 20, familyTrust: 15, boughtRecently: -25, outOfState: 15, absentee: 10, mostlyLand: 15 },
  market: { metric: 'hh200k_10mi', target: 60000 },
};

const MARKET_METRICS = { hh200k_10mi: '$200k+ households within 10 miles' };

// Merge a partial config onto the defaults, keeping only known keys and finite numbers.
export function normalizeConfig(input = {}) {
  const num = (v, d, lo = -1000, hi = 1e7) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const d = DEFAULT_PROFILE;
  const pick = (obj = {}, defs) => Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, num(obj[k], v)]));
  const c = {
    use: 'sports_facility',
    acres: { min: num(input.acres?.min, d.acres.min, 0, 10000), max: num(input.acres?.max, d.acres.max, 0, 10000) },
    hideProhibitedZoning: input.hideProhibitedZoning === undefined ? d.hideProhibitedZoning : Boolean(input.hideProhibitedZoning),
    maxAcres: num(input.maxAcres, d.maxAcres, 0, 100000),
    weights: pick(input.weights, d.weights),
    fit: { ...pick(input.fit, { inRange: d.fit.inRange, nearRange: d.fit.nearRange, outOfRange: d.fit.outOfRange, vacant: d.fit.vacant, lightlyBuilt: d.fit.lightlyBuilt }),
      zoning: pick(input.fit?.zoning, d.fit.zoning) },
    owner: pick(input.owner, d.owner),
    market: { metric: MARKET_METRICS[input.market?.metric] ? input.market.metric : d.market.metric, target: num(input.market?.target, d.market.target, 1, 1e7) },
  };
  if (c.acres.max < c.acres.min) [c.acres.min, c.acres.max] = [c.acres.max, c.acres.min];
  for (const k of Object.keys(c.weights)) c.weights[k] = Math.max(0, c.weights[k]);
  return c;
}

// SQL for fit / owner / market / score columns. Every number goes in as a bound parameter.
// Returns { select, params } where select is "<expr> AS fit_score, … AS score".
export function scoreSql(config) {
  const c = normalizeConfig(config);
  const params = [];
  const p = (v) => { params.push(v); return '?'; };
  const clamp = (e) => `GREATEST(0, LEAST(100, ROUND(${e})))`;
  const z = c.fit.zoning;
  const fit = `(CASE c.sports_verdict WHEN 'permitted' THEN ${p(z.permitted)}::float WHEN 'conditional' THEN ${p(z.conditional)}::float
      WHEN 'prohibited' THEN ${p(z.prohibited)}::float ELSE ${p(z.unknown)}::float END
    + CASE WHEN c.acres BETWEEN ${p(c.acres.min)} AND ${p(c.acres.max)} THEN ${p(c.fit.inRange)}::float
      WHEN c.acres >= ${p(c.acres.min * 0.6)} AND c.acres < ${p(c.acres.min)} THEN ${p(c.fit.nearRange)}::float ELSE ${p(c.fit.outOfRange)}::float END
    + CASE WHEN c.present_use ILIKE 'vacant%' THEN ${p(c.fit.vacant)}::float
      WHEN c.present_use ~* 'single family|mobile home|agricultur' THEN ${p(c.fit.lightlyBuilt)}::float ELSE 0 END)`;
  const o = c.owner;
  const has = (s) => `c.signals ILIKE '%${s}%'`; // fixed literals only
  const owner = `(CASE WHEN c.years_held >= 30 THEN ${p(o.held30)}::float WHEN c.years_held >= 20 THEN ${p(o.held20)}::float ELSE 0 END
    + CASE WHEN ${has('no market sale')} THEN ${p(o.noMarketSale)}::float ELSE 0 END
    + CASE WHEN ${has('recently inherited')} THEN ${p(o.recentlyInherited)}::float WHEN ${has('inherited')} THEN ${p(o.inherited)}::float ELSE 0 END
    + CASE WHEN ${has('family or trust')} THEN ${p(o.familyTrust)}::float ELSE 0 END
    + CASE WHEN ${has('bought within 3')} THEN ${p(o.boughtRecently)}::float ELSE 0 END
    + CASE WHEN c.out_of_state THEN ${p(o.outOfState)}::float WHEN c.absentee THEN ${p(o.absentee)}::float ELSE 0 END
    + CASE WHEN ${has('mostly land')} THEN ${p(o.mostlyLand)}::float ELSE 0 END)`;
  const market = `(COALESCE(c.${c.market.metric}, 0)::float / ${p(c.market.target)}::float * 100)`;
  const w = c.weights, wsum = w.fit + w.owner + w.market || 1;
  const select = `${clamp(fit)} AS fit_score, ${clamp(owner)} AS owner_score, ${clamp(market)} AS market_score`;
  return { select, params, weights: { fit: w.fit / wsum, owner: w.owner / wsum, market: w.market / wsum }, config: c };
}

// Hidden-by-this-profile conditions (on top of the data's own exclusions: tax exempt, public use).
export function profileHides(config, params) {
  const c = normalizeConfig(config);
  const conds = [];
  if (c.hideProhibitedZoning) conds.push("c.sports_verdict = 'prohibited'");
  if (c.maxAcres) { params.push(c.maxAcres); conds.push('c.acres > ?'); }
  return conds;
}

export async function listProfiles() {
  return (await all('SELECT id, name, config, created_by, updated_at FROM profiles ORDER BY id')).map((r) => ({ ...r, config: normalizeConfig(JSON.parse(r.config)) }));
}
export async function getProfile(id) {
  const r = id ? await one('SELECT id, name, config FROM profiles WHERE id = ?', [Number(id)]) : await one('SELECT id, name, config FROM profiles ORDER BY id LIMIT 1');
  return r ? { ...r, config: normalizeConfig(JSON.parse(r.config)) } : { id: null, name: 'Default', config: normalizeConfig() };
}
export async function saveProfile({ id, name, config }, userId) {
  const cfg = JSON.stringify(normalizeConfig(config));
  const nm = String(name ?? '').trim().slice(0, 80) || 'Untitled profile';
  if (id) {
    const r = await run('UPDATE profiles SET name = ?, config = ?, updated_at = now() WHERE id = ?', [nm, cfg, Number(id)]);
    if (r.rowCount) return Number(id);
  }
  return (await one('INSERT INTO profiles (name, config, created_by) VALUES (?, ?, ?) RETURNING id', [nm, cfg, userId ?? null])).id;
}
