import { all, one, run } from './db.js';

// Candidates come from free county data (scripts/import-candidates.js); reviews live apart so a rebuild keeps them.
const LIST_COLS = `c.pin, c.address, c.city, c.postal_city, c.acres, c.zoning, c.sports_verdict, c.present_use,
  c.years_held, c.signals, c.hh200k_10mi, c.share200k_10mi, c.fit_score, c.owner_score, c.market_score, c.score,
  c.lat, c.lng, c.excluded, COALESCE(r.status, 'new') AS status`;

export async function listCandidates(q = {}) {
  const where = [], params = [];
  const add = (sql, ...v) => { where.push(sql); params.push(...v); };
  if (q.includeExcluded !== 'true') add('c.excluded IS NULL');
  if (q.minScore) add('c.score >= ?', Number(q.minScore));
  if (q.minAcres) add('c.acres >= ?', Number(q.minAcres));
  if (q.maxAcres) add('c.acres <= ?', Number(q.maxAcres));
  if (q.verdict) add('c.sports_verdict = ANY(?)', String(q.verdict).split(','));
  if (q.area) add("(COALESCE(c.city, '') ILIKE ? OR COALESCE(c.postal_city, '') ILIKE ?)", `%${q.area}%`, `%${q.area}%`);
  if (q.signal) add('c.signals ILIKE ?', `%${q.signal}%`);
  if (q.status) add("COALESCE(r.status, 'new') = ?", q.status);
  const limit = Math.min(Number(q.limit) || 3000, 10000);
  const rows = await all(`SELECT ${LIST_COLS} FROM candidates c LEFT JOIN candidate_reviews r USING (pin)
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.score DESC, c.acres DESC LIMIT ${limit}`, params);
  const total = (await one(`SELECT count(*)::int AS n FROM candidates c LEFT JOIN candidate_reviews r USING (pin)
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, params)).n;
  return {
    type: 'FeatureCollection',
    total,
    features: rows.filter((r) => r.lat != null).map(({ lat, lng, signals, ...p }) => ({
      type: 'Feature', id: p.pin,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { ...p, signals: JSON.parse(signals ?? '[]') },
    })),
  };
}

export async function getCandidate(pin) {
  const c = await one(`SELECT c.*, COALESCE(r.status, 'new') AS status, COALESCE(r.notes, '') AS notes, r.updated_by, r.updated_at AS reviewed_at
    FROM candidates c LEFT JOIN candidate_reviews r USING (pin) WHERE c.pin = ?`, [pin]);
  if (!c) return null;
  return { ...c, geometry: JSON.parse(c.geometry_json), geometry_json: undefined, signals: JSON.parse(c.signals ?? '[]') };
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
