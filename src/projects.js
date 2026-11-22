import { all, one, run, pool } from './db.js';
import { normalizeSpec, compileSpec, failedChecks } from './spec.js';
import { newId } from './ids.js';
import { logEvent } from './identity.js';

// Projects: one buyer's search, owned by an organization. Members of the org see its projects;
// project_members records who created/joined, ready for per-project access later.

const parse = (r) => r && { ...r, spec: JSON.parse(r.spec) };

export async function listProjects(orgUid) {
  return (await all(`SELECT p.id, p.project_uid, p.name, p.brief, p.spec, p.spec_version, p.created_by, p.created_at, p.updated_at,
      (SELECT count(*)::int FROM project_properties pp WHERE pp.project_id = p.id AND pp.saved) AS saved,
      (SELECT count(*)::int FROM project_properties pp WHERE pp.project_id = p.id AND pp.status = 'shortlist') AS shortlisted,
      (SELECT max(pp.updated_at) FROM project_properties pp WHERE pp.project_id = p.id) AS last_activity
    FROM projects p WHERE NOT p.archived AND p.org_uid = ? ORDER BY COALESCE((SELECT max(pp.updated_at) FROM project_properties pp WHERE pp.project_id = p.id), p.updated_at) DESC`, [orgUid])).map(parse);
}

// A project is only visible to its own organization.
export async function getProject(id, orgUid) {
  const p = id ? await one('SELECT * FROM projects WHERE id = ? AND org_uid = ? AND NOT archived', [Number(id), orgUid])
    : await one('SELECT * FROM projects WHERE org_uid = ? AND NOT archived ORDER BY updated_at DESC LIMIT 1', [orgUid]);
  return parse(p);
}

export async function createProject({ name, brief = '', spec }, user, source = 'form') {
  const userId = user?.uid ?? null;
  const { spec: s, errors } = normalizeSpec(spec);
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [p] } = await client.query('INSERT INTO projects (name, brief, spec, created_by, project_uid, org_uid) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [String(name || 'Untitled project').slice(0, 120), String(brief).slice(0, 20000), JSON.stringify(s), userId, newId('prj'), user?.orgUid ?? null]);
    await client.query('INSERT INTO project_spec_history (project_id, version, spec, change_note, source, changed_by) VALUES ($1, 1, $2, $3, $4, $5)',
      [p.id, JSON.stringify(s), 'Project created', source, userId ?? null]);
    if (userId) await client.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING", [p.id, userId]);
    await client.query('COMMIT');
    return getProject(p.id, user?.orgUid);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

// Saves a new spec version with a note on why it changed. Name and brief update without a new version.
export async function updateProject(id, { name, brief, spec, changeNote = '', baseVersion }, user, source = 'form') {
  const userId = user?.uid ?? null;
  const p = await getProject(id, user?.orgUid);
  if (!p) throw Object.assign(new Error('Project not found.'), { status: 404 });
  const normalized = spec != null ? normalizeSpec(spec) : null;
  if (normalized?.errors.length) throw Object.assign(new Error(normalized.errors.join(' ')), { status: 400 });
  // One transaction, row-locked: a save based on an older version than the one stored is refused (409),
  // so two people editing at once never silently overwrite each other.
  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    const cur = (await client.query('SELECT spec, spec_version FROM projects WHERE id = $1 FOR UPDATE', [p.id])).rows[0];
    if (baseVersion != null && Number(baseVersion) !== cur.spec_version) {
      await client.query('ROLLBACK');
      client.release(); released = true;
      const latest = await getProject(p.id, user?.orgUid);
      throw Object.assign(new Error('Someone changed this project since you opened it.'), { status: 409, project: { ...latest, history: await projectHistory(p.id) } });
    }
    if (name != null || brief != null) {
      await client.query('UPDATE projects SET name = COALESCE($1, name), brief = COALESCE($2, brief), updated_at = now() WHERE id = $3',
        [name != null ? String(name).slice(0, 120) : null, brief != null ? String(brief).slice(0, 20000) : null, p.id]);
    }
    if (normalized && JSON.stringify(normalized.spec) !== JSON.stringify(typeof cur.spec === 'string' ? JSON.parse(cur.spec) : cur.spec)) {
      const version = cur.spec_version + 1;
      await client.query('UPDATE projects SET spec = $1, spec_version = $2, updated_at = now() WHERE id = $3', [JSON.stringify(normalized.spec), version, p.id]);
      await client.query('INSERT INTO project_spec_history (project_id, version, spec, change_note, source, changed_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [p.id, version, JSON.stringify(normalized.spec), String(changeNote).slice(0, 1000), source, userId]);
    }
    await client.query('COMMIT');
  } catch (e) {
    if (!released) await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { if (!released) client.release(); }
  return getProject(p.id, user?.orgUid);
}

// How many sites a draft spec would show, without scoring or fetching rows (the chip editor's "Show N sites").
export async function previewCount(project, spec, { hidePassed } = {}) {
  const { spec: s, errors } = normalizeSpec(spec);
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 400 });
  const k = compileSpec(s);
  const where = ['c.excluded IS NULL', ...k.where];
  if (hidePassed) where.push("COALESCE(r.status, 'new') <> 'rejected'");
  const row = await one(`SELECT count(*)::int AS n FROM candidates c
    LEFT JOIN project_properties r ON r.property_uid = c.property_uid AND r.project_id = ${Number(project.id)}
    WHERE ${where.join(' AND ')}`, k.whereParams);
  return row.n;
}

export async function projectHistory(id) {
  return (await all('SELECT version, spec, change_note, source, changed_by, created_at FROM project_spec_history WHERE project_id = ? ORDER BY version DESC LIMIT 50', [Number(id)])).map(parse);
}

export const REVIEW_STATUSES = ['new', 'shortlist', 'contacted', 'rejected'];

// The property inside this project (pp_…): created on first save or review, keyed by the permanent property_uid.
async function projectProperty(project, pin, user) {
  const c = await one('SELECT property_uid FROM candidates WHERE pin = ?', [pin]);
  if (!c?.property_uid) throw Object.assign(new Error('Parcel not found.'), { status: 404 });
  let pp = await one('SELECT * FROM project_properties WHERE project_id = ? AND property_uid = ?', [project.id, c.property_uid]);
  if (!pp) {
    await run(`INSERT INTO project_properties (pp_uid, project_id, property_uid, org_uid, added_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (project_id, property_uid) DO NOTHING`, [newId('pp'), project.id, c.property_uid, project.org_uid, user?.uid ?? null, user?.uid ?? null]);
    pp = await one('SELECT * FROM project_properties WHERE project_id = ? AND property_uid = ?', [project.id, c.property_uid]);
  }
  return pp;
}

export async function setSaved(project, pin, saved, user) {
  const pp = await projectProperty(project, pin, user);
  if (pp.saved === Boolean(saved)) return pp;
  await run(`UPDATE project_properties SET saved = ?, saved_at = CASE WHEN ? THEN now() ELSE saved_at END, updated_by = ?, updated_at = now() WHERE pp_uid = ?`,
    [Boolean(saved), Boolean(saved), user?.uid ?? null, pp.pp_uid]);
  await logEvent(saved ? 'property.saved' : 'property.unsaved', { propertyUid: pp.property_uid, ppUid: pp.pp_uid, projectId: project.id, user });
  return one('SELECT * FROM project_properties WHERE pp_uid = ?', [pp.pp_uid]);
}

export async function reviewParcel(project, pin, { status, notes }, user) {
  const pp = await projectProperty(project, pin, user);
  // Shortlisting or contacting a parcel implies you're keeping it: save it too.
  const autoSave = status === 'shortlist' || status === 'contacted';
  await run(`UPDATE project_properties SET status = COALESCE(?, status), notes = COALESCE(?, notes),
    saved = saved OR ?, saved_at = CASE WHEN ? AND NOT saved THEN now() ELSE saved_at END, updated_by = ?, updated_at = now() WHERE pp_uid = ?`,
    [status ?? null, notes ?? null, autoSave, autoSave, user?.uid ?? null, pp.pp_uid]);
  if (status && status !== pp.status) await logEvent('property.status_changed', { propertyUid: pp.property_uid, ppUid: pp.pp_uid, projectId: project.id, user, data: { from: pp.status, to: status } });
  if (autoSave && !pp.saved) await logEvent('property.saved', { propertyUid: pp.property_uid, ppUid: pp.pp_uid, projectId: project.id, user, data: { via: 'status' } });
}

// Saved properties across an organization's projects (the home page), newest first.
export async function orgSaved(orgUid, limit = 200) {
  return all(`SELECT pp.pp_uid, pp.property_uid, pp.status, pp.notes, pp.saved_at, pp.updated_at, pp.project_id, p.name AS project_name,
      c.pin, c.address, c.city, c.postal_city, c.acres, c.zoning, c.sports_verdict, c.tags
    FROM project_properties pp JOIN projects p ON p.id = pp.project_id JOIN candidates c ON c.property_uid = pp.property_uid
    WHERE pp.org_uid = ? AND pp.saved AND NOT p.archived ORDER BY pp.saved_at DESC NULLS LAST LIMIT ${Number(limit)}`, [orgUid]);
}

// ---------- Candidates scored for a project ----------
const LIST_COLS = `c.pin, c.property_uid, c.address, c.city, c.postal_city, c.acres, c.zoning, c.sports_verdict, c.present_use,
  c.years_held, c.signals, c.hh200k_10mi, c.share200k_10mi, c.land_value, c.lat, c.lng, c.tags, c.businesses, c.owner_type,
  c.out_of_state, c.absentee`;

// filters: ad-hoc narrowing from the map/list (not saved to the project).
// With search text (filters.area) the project's requirements don't filter: the search finds any parcel,
// and each one the requirements would hide comes back with hiddenBecause (plain reasons) and hiddenFields.
export async function projectCandidates(project, filters = {}) {
  const k = compileSpec(project.spec);
  const searching = Boolean(String(filters.area ?? '').trim());
  const where = ['c.excluded IS NULL', ...(searching ? [] : k.where)];
  const params = searching ? [] : [...k.whereParams];
  const add = (sql, ...v) => { where.push(sql); params.push(...v); };
  if (filters.minAcres) add('c.acres >= ?', Number(filters.minAcres));
  if (filters.maxAcres) add('c.acres <= ?', Number(filters.maxAcres));
  if (filters.verdict) add('c.sports_verdict = ANY(?)', String(filters.verdict).split(','));
  // Search box: address, parcel number (dashes optional) or town.
  if (searching) {
    const q = `%${String(filters.area).trim()}%`, digits = String(filters.area).replace(/\D/g, '');
    add(`(COALESCE(c.address, '') ILIKE ? OR COALESCE(c.city, '') ILIKE ? OR COALESCE(c.postal_city, '') ILIKE ?${digits.length >= 4 ? ' OR c.pin LIKE ?' : ''})`,
      q, q, q, ...(digits.length >= 4 ? [`%${digits}%`] : []));
  }
  if (filters.signal) add('c.signals ILIKE ?', `%${filters.signal}%`);
  if (filters.status) add("COALESCE(r.status, 'new') = ?", filters.status);
  if (filters.hidePassed === 'true') add("COALESCE(r.status, 'new') <> 'rejected'");
  if (filters.saved === 'true') add('COALESCE(r.saved, false)');
  if (filters.pins) add('c.pin = ANY(?)', String(filters.pins).split(',').slice(0, 1000));
  if (filters.tag) add('c.tags LIKE ?', `%"${String(filters.tag).replace(/[^a-z-]/g, '')}"%`);
  if (filters.notTag) add("COALESCE(c.tags, '') NOT LIKE ?", `%"${String(filters.notTag).replace(/[^a-z-]/g, '')}"%`);

  const inner = `SELECT ${LIST_COLS}, COALESCE(r.status, 'new') AS status, COALESCE(r.saved, false) AS saved, ${k.scoreSelect}
    FROM candidates c LEFT JOIN project_properties r ON r.property_uid = c.property_uid AND r.project_id = ${Number(project.id)}
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
    features: rows.filter((r) => r.lat != null).map((row) => {
      const { lat, lng, signals, tags, businesses, ...p } = row;
      const fails = searching ? failedChecks(project.spec, row) : [];
      return {
        type: 'Feature', id: p.pin, geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { ...p, signals: JSON.parse(signals ?? '[]'), tags: JSON.parse(tags ?? '[]'), businessCount: JSON.parse(businesses ?? '[]').length,
          hiddenBecause: fails.map((f) => f.reason), hiddenFields: fails.map((f) => f.field) },
      };
    }),
  };
}

export async function projectCandidate(project, pin) {
  const k = compileSpec(project.spec);
  const sql = `SELECT *, ${k.scoreExpr} AS score FROM (
    SELECT c.*, COALESCE(r.status, 'new') AS status, COALESCE(r.notes, '') AS notes, COALESCE(r.saved, false) AS saved, r.pp_uid,
      r.saved_at, r.updated_by AS reviewed_by, r.updated_at AS reviewed_at, ${k.scoreSelect}
    FROM candidates c LEFT JOIN project_properties r ON r.property_uid = c.property_uid AND r.project_id = ${Number(project.id)} WHERE c.pin = ?) s`;
  const c = await one(sql, [...k.scoreParams, pin]);
  if (!c) return null;
  const fails = c.excluded ? [{ field: 'excluded', reason: c.excluded }] : failedChecks(project.spec, c);
  return {
    ...c, geometry: JSON.parse(c.geometry_json), geometry_json: undefined, signals: JSON.parse(c.signals ?? '[]'),
    tags: JSON.parse(c.tags ?? '[]'), businesses: JSON.parse(c.businesses ?? '[]'),
    subscores: k.subscores.map((s) => ({ ...s, value: c[s.key] })),
    // hiddenFields[i] is the spec field behind hiddenBecause[i] ('excluded' when the parcel is out of every search).
    hiddenBecause: fails.map((f) => f.reason), hiddenFields: fails.map((f) => f.field),
  };
}
