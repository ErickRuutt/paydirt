/* Helpers for the home and project pages (the map page has its own in app.js). */
window.pd = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function api(path, opts = {}) {
    const token = await window.paydirtAuth.token(); // waits until someone is signed in
    const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
  }
  const titleCase = (s) => String(s ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const where = (p) => (p.city ? titleCase(p.city) : `Unincorporated${p.postal_city ? ' · ' + titleCase(p.postal_city) : ''}`);
  const fmtPin = (pin) => `${String(pin).slice(0, 6)}-${String(pin).slice(6)}`;
  const siteTitle = (p) => p.address || `Parcel ${fmtPin(p.pin)}`;
  const ac = (x) => (x == null ? '—' : `${Number(x).toFixed(1)} ac`);
  // Short dates: "Nov 21" this year, "Nov 21, 2025" otherwise.
  const date = (d) => { if (!d) return '—'; const x = new Date(d); return x.toLocaleDateString(undefined, x.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }); };
  const VERDICT = { permitted: ['pass', 'Permitted'], conditional: ['review', 'Conditional'], prohibited: ['fail', 'Not allowed'], unknown: ['unknown', 'Zoning unknown'] };
  const SITE = [['closing-tenant', 'review', 'Closing tenant'], ['anchor-tenant', 'fail', 'Anchor tenant'], ['operating-business', 'fail', 'Business on site'],
    ['possible-empty-building', 'review', 'Empty building?'], ['vacant-land', 'pass', 'Vacant']];
  function labels(p) {
    const v = VERDICT[p.sports_verdict] ?? VERDICT.unknown;
    const out = [`<span class="pill ${v[0]}">${v[1]}</span>`];
    const site = SITE.find(([t]) => (p.tags ?? []).includes(t));
    if (site) out.push(`<span class="pill ${site[1]}">${site[2]}</span>`);
    return out.join('');
  }
  const STATUSES = ['new', 'shortlist', 'contacted', 'rejected'];
  const STATUS_TEXT = { new: 'Saved', shortlist: 'Shortlist', contacted: 'Contacted', rejected: 'Passed' }; // stored as 'rejected'
  return { $, esc, api, where, siteTitle, ac, date, labels, STATUSES, STATUS_TEXT };
})();
