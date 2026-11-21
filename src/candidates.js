import { all, one, run } from './db.js';
import { scoreSql, profileHides } from './profiles.js';

// Candidates come from free county data (scripts/import-candidates.js) and hold facts only.
// Scores come from a profile at read time, so changing what a buyer wants never re-fetches data.
// Reviews live apart so a rebuild keeps them.
const LIST_COLS = `c.pin, c.address, c.city, c.postal_city, c.acres, c.zoning, c.sports_verdict, c.present_use,
  c.years_held, c.signals, c.hh200k_10mi, c.share200k_10mi, c.lat, c.lng, c.excluded, COALESCE(r.status, 'new') AS status`;

// Wraps a candidate query so each row gets fit/owner/market from the profile, then a weighted score.
function scored(innerSelect, innerFrom, profile) {
  const s = scoreSql(profile.config);
  const w = s.weights;
  return {
    sql: `SELECT *, GREATEST(0, LEAST(100, ROUND(fit_score * ${w.fit} + owner_score * ${w.owner} + market_score * ${w.market})))::int AS score
      FROM (SELECT ${innerSelect}, ${s.select} ${innerFrom}) s`,
    params: s.params,
  };
}

export async function listCandidates(q = {}, profile) {
  const where = [], whereParams = [];
  const add = (sql, ...v) => { where.push(sql); whereParams.push(...v); };
  if (q.includeExcluded !== 'true') {
    where.push('c.excluded IS NULL');
    const hideParams = [];
    const hides = profileHides(profile.config, hideParams);
    if (hides.length) { where.push(`NOT (${hides.join(' OR ')})`); whereParams.push(...hideParams); }
  }
  if (q.minAcres) add('c.acres >= ?', Number(q.minAcres));
  if (q.maxAcres) add('c.acres <= ?', Number(q.maxAcres));
  if (q.verdict) add('c.sports_verdict = ANY(?)', String(q.verdict).split(','));
  if (q.area) add("(COALESCE(c.city, '') ILIKE ? OR COALESCE(c.postal_city, '') ILIKE ?)", `%${q.area}%`, `%${q.area}%`);
  if (q.signal) add('c.signals ILIKE ?', `%${q.signal}%`);
  if (q.status) add("COALESCE(r.status, 'new') = ?", q.status);
  const from = `FROM candidates c LEFT JOIN candidate_reviews r USING (pin) ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const { sql, params } = scored(LIST_COLS, from, profile);
  const minScore = Number(q.minScore) || 0;
  const limit = Math.min(Number(q.limit) || 3000, 10000);
  // Score params come first in the SELECT, then the WHERE params.
  const rows = await all(`SELECT * FROM (${sql}) t WHERE score >= ${minScore} ORDER BY score DESC, acres DESC LIMIT ${limit}`, [...params, ...whereParams]);
  const total = (await one(`SELECT count(*)::int AS n FROM (${sql}) t WHERE score >= ${minScore}`, [...params, ...whereParams])).n;
  return {
    type: 'FeatureCollection',
    total,
    profile: { id: profile.id, name: profile.name },
    features: rows.filter((r) => r.lat != null).map(({ lat, lng, signals, ...p }) => ({
      type: 'Feature', id: p.pin,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { ...p, signals: JSON.parse(signals ?? '[]') },
    })),
  };
}

export async function getCandidate(pin, profile) {
  const { sql, params } = scored(`c.*, COALESCE(r.status, 'new') AS status, COALESCE(r.notes, '') AS notes, r.updated_by, r.updated_at AS reviewed_at`,
    'FROM candidates c LEFT JOIN candidate_reviews r USING (pin) WHERE c.pin = ?', profile);
  const c = await one(sql, [...params, pin]);
  if (!c) return null;
  let hiddenBy = null;
  if (profile.config.hideProhibitedZoning && c.sports_verdict === 'prohibited') hiddenBy = `zoning: ${c.sports_note}`;
  else if (profile.config.maxAcres && c.acres > profile.config.maxAcres) hiddenBy = `over ${profile.config.maxAcres} acres`;
  return { ...c, excluded: c.excluded ?? hiddenBy, geometry: JSON.parse(c.geometry_json), geometry_json: undefined, signals: JSON.parse(c.signals ?? '[]'),
    weights: profile.config.weights, marketTarget: profile.config.market.target };
}

export const REVIEW_STATUSES = ['new', 'shortlist', 'rejected', 'contacted'];
export async function reviewCandidate(pin, { status, notes }, userId) {
  await run(`INSERT INTO candidate_reviews (pin, status, notes, updated_by) VALUES (?, COALESCE(?, 'new'), COALESCE(?, ''), ?)
    ON CONFLICT (pin) DO UPDATE SET status = COALESCE(?, candidate_reviews.status), notes = COALESCE(?, candidate_reviews.notes),
    updated_by = excluded.updated_by, updated_at = now()`, [pin, status ?? null, notes ?? null, userId, status ?? null, notes ?? null]);
}

// The handful of enrich fields that answer "is it buildable" — shown first in the panel.
export const KEY_FIELDS = {
  owner: 'Owner',
  parcel_slope_pct_p50: 'Median slope %',
  parcel_slope_frac_over_5pct: 'Share over 5% grade',
  wetland_fraction_of_parcel: 'Wetland share',
  parcel_flood_sfha_fraction: 'Flood zone share',
  developable_acres_proxy: 'Developable acres (Mireye)',
  zoning: 'Zoning (Mireye)',
  zoning_description: 'Zoning description',
};
