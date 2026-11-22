import { PREFERENCE_FIELDS, SIGNAL_LABELS, TAG_LABELS, PENDING, normalizeSpec } from './spec.js';

// The criteria bar: each chip is a plain-language view over the stored spec. A chip owns a fixed set of
// requirement fields (its Must part: hides sites) and preference fields (its Nice part: ranks sites).
// Every spec field belongs to exactly one chip, so reading and writing never collide.
export const CHIPS = [
  { key: 'size', label: 'Size', standard: true, must: ['acres'], nice: ['acres'] },
  { key: 'where', label: 'Where', standard: true, must: ['area', 'jurisdiction'], nice: [] },
  { key: 'zoning', label: 'Zoning allows your use', standard: true, must: ['zoning.sports_facility'], nice: ['zoning.sports_facility'] },
  { key: 'site', label: "What's on the site", standard: true, must: ['vacant', 'tags_exclude'], nice: ['vacancy', 'business_on_site'] },
  { key: 'sell', label: 'Likely to sell', standard: true, must: ['owner_signals'], nice: ['owner_signals'] },
  { key: 'families', label: 'Families nearby', standard: false, must: ['hh200k_10mi'], nice: ['hh200k_10mi'] },
  { key: 'price', label: 'Land price', standard: false, must: ['land_value_per_acre'], nice: ['land_value_per_acre'] },
  { key: 'tagged', label: 'Only sites tagged', standard: false, must: ['tags_include'], nice: [] },
];
const BY_KEY = Object.fromEntries(CHIPS.map((c) => [c.key, c]));

// Nice importance in plain words. Stored weights are only rewritten when the user changes the importance,
// so a project's ranking never moves because someone adjusted a value.
export const IMPORTANCE = { little: 10, some: 25, lot: 50 };
export const IMPORTANCE_TEXT = { little: 'A little', some: 'Some', lot: 'A lot' };
export function importanceOf(weight) {
  let best = 'little';
  for (const [k, w] of Object.entries(IMPORTANCE)) if (Math.abs(weight - w) < Math.abs(weight - IMPORTANCE[best])) best = k;
  return best;
}


// spec → chips, in bar order (standard chips always present, unset when the spec has nothing for them).
export function specToChips(spec) {
  const chips = [];
  for (const def of CHIPS) {
    const reqs = spec.requirements.filter((r) => def.must.includes(r.field));
    const prefs = spec.preferences.filter((p) => def.nice.includes(p.field));
    if (!def.standard && !reqs.length && !prefs.length) continue;
    const weight = prefs.reduce((a, p) => a + p.weight, 0);
    chips.push({
      key: def.key, label: def.label, standard: def.standard,
      canNice: def.nice.length > 0,
      must: reqs.length ? Object.fromEntries(reqs.map((r) => [r.field, r.value])) : null,
      nice: prefs.length ? { importance: importanceOf(weight), weight, params: Object.fromEntries(prefs.map((p) => [p.field, p.params])) } : null,
      why: [...reqs, ...prefs].map((x) => x.why).filter(Boolean)[0] ?? '',
    });
  }
  return chips;
}

// Apply one chip's edit to a spec and return the new (normalized) spec.
// edit = { must: { field: value } | null, nice: { importance, params: { field: params } } | null }
export function applyChipEdit(spec, key, edit = {}) {
  const def = BY_KEY[key];
  if (!def) throw Object.assign(new Error(`Unknown criterion "${key}".`), { status: 400 });
  const next = structuredClone(spec);

  const keptReqs = next.requirements.filter((r) => !def.must.includes(r.field));
  const newReqs = Object.entries(edit.must ?? {})
    .filter(([f]) => def.must.includes(f))
    .map(([field, value]) => ({ field, value, why: whyFor(spec.requirements, field) }));
  next.requirements = [...keptReqs, ...newReqs];

  const oldPrefs = next.preferences.filter((p) => def.nice.includes(p.field));
  const keptPrefs = next.preferences.filter((p) => !def.nice.includes(p.field));
  let newPrefs = [];
  if (edit.nice && def.nice.length) {
    const fields = Object.keys(edit.nice.params ?? {}).filter((f) => def.nice.includes(f));
    const useFields = fields.length ? fields : (oldPrefs.length ? oldPrefs.map((p) => p.field) : def.nice);
    const oldTotal = oldPrefs.reduce((a, p) => a + p.weight, 0);
    const reweigh = !oldPrefs.length || (edit.nice.importance && edit.nice.importance !== importanceOf(oldTotal));
    const total = IMPORTANCE[edit.nice.importance] ?? IMPORTANCE.some;
    newPrefs = useFields.map((field) => {
      const old = oldPrefs.find((p) => p.field === field);
      let weight;
      if (!reweigh && old) weight = old.weight;
      else if (old && oldTotal > 0) weight = Math.round((old.weight / oldTotal) * total);
      else weight = Math.round(total / useFields.length);
      const params = { ...(PREFERENCE_FIELDS[field].params), ...(old?.params ?? {}), ...(edit.nice.params?.[field] ?? {}) };
      return { field, weight, params, why: old?.why ?? '' };
    });
  }
  next.preferences = [...keptPrefs, ...newPrefs];

  const { spec: out, errors } = normalizeSpec(next);
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { status: 400 });
  return out;
}
const whyFor = (list, field) => list.find((x) => x.field === field)?.why ?? '';

// Catalog the client needs to render editors.
export const CHIP_CATALOG = {
  chips: CHIPS.map(({ key, label, standard, must, nice }) => ({ key, label, standard, canNice: nice.length > 0, must, nice })),
  importance: IMPORTANCE_TEXT,
  pending: PENDING,
  signals: SIGNAL_LABELS,
  tags: TAG_LABELS,
};
