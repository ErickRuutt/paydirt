import { all, one, run, pool } from './db.js';
import { normalizeSpec, compileSpec, failedRequirements } from './spec.js';

// Projects: one buyer's search. For now every signed-in member of the team can see every project;
// project_members records who created/joined, ready for per-project access later.

const parse = (r) => r && { ...r, spec: JSON.parse(r.spec) };

export async function listProjects() {
  return (await all(`SELECT p.id, p.name, p.brief, p.spec, p.spec_version, p.created_by, p.updated_at,
      (SELECT count(*)::int FROM project_reviews r WHERE r.project_id = p.id AND r.status = 'shortlist') AS shortlisted
    FROM projects p WHERE NOT p.archived ORDER BY p.updated_at DESC`)).map(parse);
}

export async function getProject(id) {
  const p = id ? await one('SELECT * FROM projects WHERE id = ? AND NOT archived', [Number(id)]) : await one('SELECT * FROM projects WHERE NOT archived ORDER BY updated_at DESC LIMIT 1');
  return parse(p);
}

export async function createProject({ name, brief = '', spec }, userId, source = 'form') {
  const { spec: s, errors } = normalizeSpec(spec);
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [p] } = await client.query('INSERT INTO projects (name, brief, spec, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [String(name || 'Untitled project').slice(0, 120), String(brief).slice(0, 20000), JSON.stringify(s), userId ?? null]);
    await client.query('INSERT INTO project_spec_history (project_id, version, spec, change_note, source, changed_by) VALUES ($1, 1, $2, $3, $4, $5)',
      [p.id, JSON.stringify(s), 'Project created', source, userId ?? null]);
    if (userId) await client.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING", [p.id, userId]);
    await client.query('COMMIT');
    return getProject(p.id);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

// Saves a new spec version with a note on why it changed. Name and brief update without a new version.
export async function updateProject(id, { name, brief, spec, changeNote = '' }, userId, source = 'form') {
  const p = await getProject(id);
  if (!p) throw Object.assign(new Error('Project not found.'), { status: 404 });
  if (name != null || brief != null) {
    await run('UPDATE projects SET name = COALESCE(?, name), brief = COALESCE(?, brief), updated_at = now() WHERE id = ?',
      [name != null ? String(name).slice(0, 120) : null, brief != null ? String(brief).slice(0, 20000) : null, p.id]);
  }
  if (spec != null) {
    const { spec: s, errors } = normalizeSpec(spec);
    if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 400 });
    if (JSON.stringify(s) !== JSON.stringify(p.spec)) {
      const version = p.spec_version + 1;
      await run('UPDATE projects SET spec = ?, spec_version = ?, updated_at = now() WHERE id = ?', [JSON.stringify(s), version, p.id]);
      await run('INSERT INTO project_spec_history (project_id, version, spec, change_note, source, changed_by) VALUES (?, ?, ?, ?, ?, ?)',
        [p.id, version, JSON.stringify(s), String(changeNote).slice(0, 1000), source, userId ?? null]);
    }
  }
  return getProject(p.id);
}

export async function projectHistory(id) {
  return (await all('SELECT version, spec, change_note, source, changed_by, created_at FROM project_spec_history WHERE project_id = ? ORDER BY version DESC', [Number(id)])).map(parse);
}

export const REVIEW_STATUSES = ['new', 'shortlist', 'contacted', 'rejected'];
export async function reviewParcel(projectId, pin, { status, notes }, userId) {
  await run(`INSERT INTO project_reviews (project_id, pin, status, notes, updated_by) VALUES (?, ?, COALESCE(?, 'new'), COALESCE(?, ''), ?)
    ON CONFLICT (project_id, pin) DO UPDATE SET status = COALESCE(?, project_reviews.status), notes = COALESCE(?, project_reviews.notes),
    updated_by = excluded.updated_by, updated_at = now()`, [projectId, pin, status ?? null, notes ?? null, userId, status ?? null, notes ?? null]);
}

// ---------- Candidates scored for a project ----------
const LIST_COLS = `c.pin, c.address, c.city, c.postal_city, c.acres, c.zoning, c.sports_verdict, c.present_use,
  c.years_held, c.signals, c.hh200k_10mi, c.share200k_10mi, c.land_value, c.lat, c.lng, c.tags, c.businesses, c.owner_type`;

// filters: ad-hoc narrowing from the map/list (not saved to the project).
export async function projectCandidates(project, filters = {}) {
  const k = compileSpec(project.spec);
  const where = ['c.excluded IS NULL', ...k.where];
  const params = [...k.whereParams];
  const add = (sql, ...v) => { where.push(sql); params.push(...v); };
  if (filters.minAcres) add('c.acres >= ?', Number(filters.minAcres));
  if (filters.maxAcres) add('c.acres <= ?', Number(filters.maxAcres));
  if (filters.verdict) add('c.sports_verdict = ANY(?)', String(filters.verdict).split(','));
  if (filters.area) add("(COALESCE(c.city, '') ILIKE ? OR COALESCE(c.postal_city, '') ILIKE ?)", `%${filters.area}%`, `%${filters.area}%`);
  if (filters.signal) add('c.signals ILIKE ?', `%${filters.signal}%`);
  if (filters.status) add("COALESCE(r.status, 'new') = ?", filters.status);
  if (filters.tag) add('c.tags LIKE ?', `%"${String(filters.tag).replace(/[^a-z-]/g, '')}"%`);
  if (filters.notTag) add("COALESCE(c.tags, '') NOT LIKE ?", `%"${String(filters.notTag).replace(/[^a-z-]/g, '')}"%`);

  const inner = `SELECT ${LIST_COLS}, COALESCE(r.status, 'new') AS status, ${k.scoreSelect}
    FROM candidates c LEFT JOIN project_reviews r ON r.pin = c.pin AND r.project_id = ${Number(project.id)}
    WHERE ${where.join(' AND ')}`;
  const sql = `SELECT *, ${k.scoreExpr} AS score FROM (${inner}) s`;
  const minScore = Number(filters.minScore) || 0;
  const limit = Math.min(Number(filters.limit) || 3000, 10000);
  const allParams = [...k.scoreParams, ...params];
  const rows = await all(`SELECT * FROM (${sql}) t WHERE score >= ${minScore} ORDER BY score DESC, acres DESC LIMIT ${limit}`, allParams);
  const total = (await one(`SELECT count(*)::int AS n FROM (${sql}) t WHERE score >= ${minScore}`, allParams)).n;
  return {
    type: 'FeatureCollection', total,
    project: { id: project.id, name: project.name, version: project.spec_version },
    subscores: k.subscores,
    features: rows.filter((r) => r.lat != null).map(({ lat, lng, signals, tags, businesses, ...p }) => ({
      type: 'Feature', id: p.pin, geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { ...p, signals: JSON.parse(signals ?? '[]'), tags: JSON.parse(tags ?? '[]'), businessCount: JSON.parse(businesses ?? '[]').length },
    })),
  };
}

export async function projectCandidate(project, pin) {
  const k = compileSpec(project.spec);
  const sql = `SELECT *, ${k.scoreExpr} AS score FROM (
    SELECT c.*, COALESCE(r.status, 'new') AS status, COALESCE(r.notes, '') AS notes, r.updated_by AS reviewed_by, r.updated_at AS reviewed_at, ${k.scoreSelect}
    FROM candidates c LEFT JOIN project_reviews r ON r.pin = c.pin AND r.project_id = ${Number(project.id)} WHERE c.pin = ?) s`;
  const c = await one(sql, [...k.scoreParams, pin]);
  if (!c) return null;
  const fails = failedRequirements(project.spec, c);
  return {
    ...c, geometry: JSON.parse(c.geometry_json), geometry_json: undefined, signals: JSON.parse(c.signals ?? '[]'),
    tags: JSON.parse(c.tags ?? '[]'), businesses: JSON.parse(c.businesses ?? '[]'),
    subscores: k.subscores.map((s) => ({ ...s, value: c[s.key] })),
    hiddenBecause: c.excluded ? [c.excluded] : fails,
  };
}
