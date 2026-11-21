// Criteria spec v1 (docs/projects-spec.md). Every way of writing criteria — form, markdown, interview,
// MCP — produces this JSON. Requirements filter; preferences score. Compiled to SQL over `candidates c`.
//
// The catalog below is the only vocabulary. Unknown fields or ops are rejected, never guessed.

export const SPEC_VERSION = 1;

const VERDICTS = ['permitted', 'conditional', 'unknown', 'prohibited'];
const SIGNALS = {
  held_30y: { label: 'Held 30+ years', sql: 'c.years_held >= 30' },
  held_20y: { label: 'Held 20–30 years', sql: 'c.years_held >= 20 AND c.years_held < 30' },
  no_market_sale: { label: 'No market sale on record', sql: "c.signals ILIKE '%no market sale%'" },
  recently_inherited: { label: 'Recently inherited', sql: "c.signals ILIKE '%recently inherited%'" },
  inherited: { label: 'Inherited (earlier)', sql: "c.signals ILIKE '%inherited%' AND c.signals NOT ILIKE '%recently inherited%'" },
  family_trust: { label: 'Last transfer family or trust', sql: "c.signals ILIKE '%family or trust%'" },
  bought_recently: { label: 'Bought within 3 years', sql: "c.signals ILIKE '%bought within 3%'" },
  out_of_state: { label: 'Owner out of state', sql: 'c.out_of_state' },
  absentee: { label: 'Owner in another city', sql: '(c.absentee AND NOT COALESCE(c.out_of_state, false))' },
  mostly_land: { label: 'Little or no building', sql: "c.signals ILIKE '%mostly land%'" },
};

// Fields a requirement can test.
export const REQUIREMENT_FIELDS = {
  acres: { label: 'Acres', type: 'range' },
  'zoning.sports_facility': { label: 'Zoning allows a sports facility', type: 'set', options: VERDICTS },
  jurisdiction: { label: 'City or unincorporated', type: 'set', options: ['city', 'unincorporated'] },
  area: { label: 'In these places (city or mailing town)', type: 'list' },
  hh200k_10mi: { label: '$200k+ households within 10 mi', type: 'min' },
  land_value_per_acre: { label: 'Assessed land value per acre', type: 'max' },
  vacant: { label: 'Vacant land only', type: 'bool' },
  owner_signals: { label: 'Owner shows any of these signals', type: 'set', options: Object.keys(SIGNALS) },
};

// Preferences each produce a 0–100 sub-score; the project score is their weighted average.
export const PREFERENCE_FIELDS = {
  'zoning.sports_facility': { label: 'Zoning for a sports facility', params: { points: { permitted: 100, conditional: 67, unknown: 33, prohibited: 0 } } },
  acres: { label: 'Size in target range', params: { min: 13, max: 40, nearRange: 50, outOfRange: 17 } },
  vacancy: { label: 'Vacant or lightly built', params: { vacant: 100, lightlyBuilt: 48 } },
  owner_signals: { label: 'Owner likely to sell', params: { points: { held_30y: 35, held_20y: 25, no_market_sale: 25, recently_inherited: 30, inherited: 20, family_trust: 15, bought_recently: -25, out_of_state: 15, absentee: 10, mostly_land: 15 } } },
  hh200k_10mi: { label: '$200k+ households within 10 mi', params: { target: 60000 } },
  land_value_per_acre: { label: 'Lower land value per acre', params: { target: 300000 } },
};

export const SIGNAL_LABELS = Object.fromEntries(Object.entries(SIGNALS).map(([k, v]) => [k, v.label]));

// The Field House search as a spec. Weights reproduce the earlier profile (40% fit split 18/12/10, 35% owner, 25% market).
export const FIELD_HOUSE_SPEC = {
  version: SPEC_VERSION,
  uses: [{ use: 'sports_facility', role: 'primary' }, { use: 'restaurant', role: 'accessory' }, { use: 'office', role: 'accessory' }],
  areas: ['WA:King'],
  requirements: [
    { field: 'zoning.sports_facility', value: ['permitted', 'conditional', 'unknown'], why: 'Fields and an indoor club must be allowed (or not yet ruled out).' },
    { field: 'acres', value: [5, 80], why: 'Room for fields and parking; smaller lots only as part of an assemblage.' },
  ],
  preferences: [
    { field: 'zoning.sports_facility', weight: 18, why: 'Permitted outright beats a conditional use permit.' },
    { field: 'acres', weight: 12, params: { min: 13, max: 40 }, why: '13–40 acres fits two to four fields plus parking.' },
    { field: 'vacancy', weight: 10, why: 'Vacant land avoids demolition.' },
    { field: 'owner_signals', weight: 35, why: 'Off-market outreach works best with long-held or inherited land.' },
    { field: 'hh200k_10mi', weight: 25, params: { target: 60000 }, why: 'Families earning $200k+ nearby.' },
  ],
};

// ---------- Validation ----------
const num = (v) => (v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v, n = 500) => String(v ?? '').slice(0, n);

export function normalizeSpec(input) {
  const errors = [];
  const s = typeof input === 'string' ? JSON.parse(input) : (input ?? {});
  const out = { version: SPEC_VERSION, uses: [], areas: [], requirements: [], preferences: [] };
  out.uses = (Array.isArray(s.uses) ? s.uses : []).slice(0, 10).map((u) => ({ use: text(u.use, 40), role: u.role === 'accessory' ? 'accessory' : 'primary' }));
  if (!out.uses.length) out.uses = [{ use: 'sports_facility', role: 'primary' }];
  out.areas = (Array.isArray(s.areas) ? s.areas : ['WA:King']).map((a) => text(a, 40)).slice(0, 20);

  for (const [i, r] of (Array.isArray(s.requirements) ? s.requirements : []).entries()) {
    const def = REQUIREMENT_FIELDS[r?.field];
    if (!def) { errors.push(`Requirement ${i + 1}: unknown field "${r?.field}".`); continue; }
    let value = r.value;
    if (def.type === 'range') {
      const [lo, hi] = Array.isArray(value) ? value.map(num) : [null, null];
      if (lo == null && hi == null) { errors.push(`Requirement ${i + 1}: ${def.label} needs a min or max.`); continue; }
      value = [lo, hi];
    } else if (def.type === 'set') {
      value = (Array.isArray(value) ? value : [value]).filter((v) => def.options.includes(v));
      if (!value.length) { errors.push(`Requirement ${i + 1}: ${def.label} needs at least one of ${def.options.join(', ')}.`); continue; }
    } else if (def.type === 'list') {
      value = (Array.isArray(value) ? value : String(value ?? '').split(',')).map((v) => text(v, 60).trim()).filter(Boolean).slice(0, 30);
      if (!value.length) { errors.push(`Requirement ${i + 1}: ${def.label} needs at least one place.`); continue; }
    } else if (def.type === 'min' || def.type === 'max') {
      value = num(value);
      if (value == null) { errors.push(`Requirement ${i + 1}: ${def.label} needs a number.`); continue; }
    } else if (def.type === 'bool') value = true;
    out.requirements.push({ field: r.field, value, why: text(r.why) });
  }

  for (const [i, p] of (Array.isArray(s.preferences) ? s.preferences : []).entries()) {
    const def = PREFERENCE_FIELDS[p?.field];
    if (!def) { errors.push(`Preference ${i + 1}: unknown field "${p?.field}".`); continue; }
    const weight = Math.max(0, Math.min(100, num(p.weight) ?? 0));
    const params = mergeParams(def.params, p.params ?? {});
    out.preferences.push({ field: p.field, weight, params, why: text(p.why) });
  }
  if (!out.preferences.some((p) => p.weight > 0)) errors.push('Add at least one preference with a weight above 0, or nothing can be ranked.');
  return { spec: out, errors };
}

function mergeParams(defaults, given) {
  const o = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (v && typeof v === 'object') o[k] = Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, num(given?.[k]?.[kk]) ?? vv]));
    else o[k] = num(given?.[k]) ?? v;
  }
  return o;
}

// ---------- Compile to SQL ----------
// Returns { where: [sql], whereParams, scoreSelect, scoreParams, subscores: [{key,label,weight}] }.
// All user values go in as bound parameters; only catalog SQL fragments are inlined.
export function compileSpec(spec) {
  const where = [], whereParams = [];
  const wp = (v) => { whereParams.push(v); return '?'; };
  for (const r of spec.requirements) {
    switch (r.field) {
      case 'acres':
        if (r.value[0] != null) where.push(`c.acres >= ${wp(r.value[0])}`);
        if (r.value[1] != null) where.push(`c.acres <= ${wp(r.value[1])}`);
        break;
      case 'zoning.sports_facility': where.push(`c.sports_verdict = ANY(${wp(r.value)})`); break;
      case 'jurisdiction':
        if (r.value.length === 1) where.push(r.value[0] === 'city' ? 'c.city IS NOT NULL' : 'c.city IS NULL');
        break;
      case 'area': {
        const pats = r.value.map((a) => `%${a}%`);
        where.push(`(COALESCE(c.city, '') ILIKE ANY(${wp(pats)}) OR COALESCE(c.postal_city, '') ILIKE ANY(${wp(pats)}))`);
        break;
      }
      case 'hh200k_10mi': where.push(`COALESCE(c.hh200k_10mi, 0) >= ${wp(r.value)}`); break;
      case 'land_value_per_acre': where.push(`(c.land_value / NULLIF(c.acres, 0)) <= ${wp(r.value)}`); break;
      case 'vacant': where.push("c.present_use ILIKE 'vacant%'"); break;
      case 'owner_signals': where.push(`(${r.value.map((k) => SIGNALS[k].sql).join(' OR ')})`); break;
    }
  }

  const scoreParams = [];
  const sp = (v) => { scoreParams.push(v); return `${'?'}::float`; };
  const subs = [];
  const clamp = (e) => `GREATEST(0, LEAST(100, ${e}))`;
  for (const [i, p] of spec.preferences.entries()) {
    const key = `s${i}`;
    let e;
    switch (p.field) {
      case 'zoning.sports_facility': {
        const pt = p.params.points;
        e = `CASE c.sports_verdict WHEN 'permitted' THEN ${sp(pt.permitted)} WHEN 'conditional' THEN ${sp(pt.conditional)} WHEN 'prohibited' THEN ${sp(pt.prohibited)} ELSE ${sp(pt.unknown)} END`;
        break;
      }
      case 'acres':
        e = `CASE WHEN c.acres BETWEEN ${sp(p.params.min)} AND ${sp(p.params.max)} THEN 100 WHEN c.acres >= ${sp(p.params.min * 0.6)} AND c.acres < ${sp(p.params.min)} THEN ${sp(p.params.nearRange)} ELSE ${sp(p.params.outOfRange)} END`;
        break;
      case 'vacancy':
        e = `CASE WHEN c.present_use ILIKE 'vacant%' THEN ${sp(p.params.vacant)} WHEN c.present_use ~* 'single family|mobile home|agricultur' THEN ${sp(p.params.lightlyBuilt)} ELSE 0 END`;
        break;
      case 'owner_signals':
        e = Object.entries(p.params.points).map(([k, v]) => `CASE WHEN ${SIGNALS[k].sql} THEN ${sp(v)} ELSE 0 END`).join(' + ');
        break;
      case 'hh200k_10mi':
        e = `COALESCE(c.hh200k_10mi, 0)::float / ${sp(p.params.target || 1)} * 100`;
        break;
      case 'land_value_per_acre':
        // 100 at or below target, falling to 0 at twice the target.
        e = `CASE WHEN c.land_value IS NULL OR c.acres = 0 THEN 50 ELSE 200 - (c.land_value / c.acres) / ${sp(p.params.target || 1)} * 100 END`;
        break;
    }
    subs.push({ key, field: p.field, label: PREFERENCE_FIELDS[p.field].label, weight: p.weight, sql: `ROUND(${clamp(`COALESCE(${e}, 0)`)})::int AS ${key}` });
  }
  const totalW = subs.reduce((a, s) => a + s.weight, 0) || 1;
  const scoreExpr = subs.length ? subs.map((s) => `${s.key} * ${s.weight / totalW}`).join(' + ') : '0';
  return {
    where, whereParams,
    scoreSelect: subs.map((s) => s.sql).join(', ') || '0 AS s_none',
    scoreParams,
    scoreExpr: `GREATEST(0, LEAST(100, ROUND(${scoreExpr})))::int`,
    subscores: subs.map(({ key, field, label, weight }) => ({ key, field, label, weight, share: weight / totalW })),
  };
}

// Plain-language reasons a parcel fails a project's requirements (for the detail panel).
export function failedRequirements(spec, c) {
  const out = [];
  for (const r of spec.requirements) {
    let ok = true;
    switch (r.field) {
      case 'acres': ok = (r.value[0] == null || c.acres >= r.value[0]) && (r.value[1] == null || c.acres <= r.value[1]); break;
      case 'zoning.sports_facility': ok = r.value.includes(c.sports_verdict ?? 'unknown'); break;
      case 'jurisdiction': ok = r.value.length !== 1 || (r.value[0] === 'city') === Boolean(c.city); break;
      case 'area': ok = r.value.some((a) => `${c.city ?? ''} ${c.postal_city ?? ''}`.toLowerCase().includes(a.toLowerCase())); break;
      case 'hh200k_10mi': ok = (c.hh200k_10mi ?? 0) >= r.value; break;
      case 'land_value_per_acre': ok = c.acres ? c.land_value / c.acres <= r.value : false; break;
      case 'vacant': ok = /^vacant/i.test(c.present_use ?? ''); break;
      case 'owner_signals': ok = true; break; // checked in SQL; rarely the reason someone opens a parcel
    }
    if (!ok) out.push(`${REQUIREMENT_FIELDS[r.field].label}${r.why ? ` — ${r.why}` : ''}`);
  }
  return out;
}
