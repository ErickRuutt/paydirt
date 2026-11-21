import { randomBytes } from 'node:crypto';

// Prefixed, time-sortable IDs: prop_…, pp_…, org_…, usr_…, prj_…, evt_….
// 10 chars of millisecond time (base 36, sorts by creation) + 12 random base-32 chars.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export function newId(prefix) {
  const t = Date.now().toString(36).padStart(10, '0');
  const r = [...randomBytes(12)].map((b) => ALPHABET[b % 32]).join('');
  return `${prefix}_${t}${r}`;
}
