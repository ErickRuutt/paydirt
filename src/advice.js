import { one } from './db.js';
import { previewCount } from './projects.js';
import { CHIPS } from './chips.js';

// Guidance for a project before it is created: how many sites match today, which filter cuts the most when few
// match, and whether each town the person named is loaded. Counted from the data we hold; nothing is guessed.
const FEW = 15;
const chipOf = (field) => CHIPS.find((c) => c.must.includes(field));
const none = { id: 0, areas: [] };

export async function draftAdvice(spec) {
  const reqs = spec?.requirements ?? [];
  const count = await previewCount(none, spec);
  const names = reqs.find((r) => r.field === 'area')?.value ?? [];
  const places = [];
  for (const name of names.slice(0, 12)) {
    const n = (await one("SELECT count(*)::int AS n FROM candidates WHERE excluded IS NULL AND (COALESCE(city, '') ILIKE ? OR COALESCE(postal_city, '') ILIKE ?)", [`%${name}%`, `%${name}%`])).n;
    places.push({ name, sites: n, loaded: n > 0 });
  }
  // When few sites match, try the search without each filter in turn and report the one that frees the most.
  let loosen = null;
  if (count < FEW) {
    for (const r of reqs) {
      if (r.field === 'area') continue; // where to look is the person's call, not something to relax
      const without = await previewCount(none, { ...spec, requirements: reqs.filter((x) => x !== r) });
      if (without > count && (!loosen || without > loosen.count)) loosen = { key: chipOf(r.field)?.key ?? null, label: chipOf(r.field)?.label ?? r.field, count: without };
    }
  }
  return { count, few: count < FEW, places, loosen };
}
