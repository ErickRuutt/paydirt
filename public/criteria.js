/* Criteria bar: a project's criteria as chips (Must / Nice / not checked yet) and the one editor that changes them.
   Shared by every page that shows a project's criteria:
     paydirtCriteria.render(el, project, catalog, { onChip(key, button), onAdd(key, button) })
     paydirtCriteria.edit({ project, catalog, key, returnFocus, nowCount, onSaved, onConflict })
     paydirtCriteria.history({ project, me, catalog, returnFocus, onSaved, onConflict })
     paydirtCriteria.restore(project, spec)  → saved project (throws err.status 409 with err.body.project when stale)
   `project` carries id, spec_version, spec and chips as returned by /api/projects; `catalog` is that response's catalog. */
window.paydirtCriteria = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtN = (n) => Number(n).toLocaleString();
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const LEVELS = ['little', 'some', 'lot'];
  const OPEN = 1000; // an open-ended "best size" (25+ acres) is stored with this as its top
  const ZONING = [['permitted', 'Permitted'], ['conditional', 'Allowed with a permit'], ['unknown', 'Not read yet']];
  const ZONING_WORD = { permitted: 'permitted', conditional: 'with a permit', unknown: 'not read yet', prohibited: 'not allowed' };

  // Saves need the response body of a refused (409) request, so this keeps it on the error.
  async function request(path, { method = 'GET', body } = {}) {
    const token = await window.paydirtAuth.token();
    const res = await fetch(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error ?? `Request failed (${res.status})`), { status: res.status, body: json });
    return json;
  }

  const word = (catalog, level) => catalog.criteria.importance[level] ?? level;
  const tagLabel = (catalog, t) => catalog.criteria.tags[t] ?? t;
  const signalLabel = (catalog, k) => catalog.criteria.signals[k] ?? k;
  const defaults = (catalog, field) => catalog.preferences?.[field]?.params ?? {};
  const range = (lo, hi) => (lo != null && hi != null ? `${fmtN(lo)}–${fmtN(hi)}` : lo != null ? `${fmtN(lo)}+` : `up to ${fmtN(hi)}`);
  const niceRange = (a = {}) => range(a.min, a.max >= OPEN ? null : a.max);
  const towns = (list) => (list.length <= 2 ? list.join(', ') : `${list.slice(0, 2).join(', ')} +${list.length - 2}`);

  // ---------- Chip text ----------
  function mustText(ch, catalog) {
    const m = ch.must;
    switch (ch.key) {
      case 'size': return `${range(...m.acres)} acres`;
      case 'where': {
        const out = [];
        if (m.area?.length) out.push(`In ${towns(m.area)}`);
        if (m.jurisdiction?.length === 1) out.push(m.jurisdiction[0] === 'city' ? 'Inside a city' : 'Unincorporated');
        return out.join(' · ') || ch.label;
      }
      case 'zoning': return `Zoning: ${(m['zoning.sports_facility'] ?? []).map((v) => ZONING_WORD[v] ?? v).join(', ')}`;
      case 'site': {
        const out = m.vacant ? ['Vacant land only'] : [];
        for (const t of m.tags_exclude ?? []) {
          out.push(t === 'operating-business' ? 'No operating businesses' : t === 'anchor-tenant' ? 'No major anchors' : t === 'closing-tenant' ? 'No closing tenants' : `No ${tagLabel(catalog, t).toLowerCase()}`);
        }
        return out.join(', ') || ch.label;
      }
      case 'sell': {
        const s = m.owner_signals ?? [];
        return s.length <= 2 ? s.map((k) => signalLabel(catalog, k)).join(' or ') : `Likely to sell (any of ${s.length} signs)`;
      }
      case 'families': return `${fmtN(m.hh200k_10mi)}+ households earning $200k+`;
      case 'price': return `Land at most $${fmtN(m.land_value_per_acre)} an acre`;
      case 'tagged': return `Only: ${(m.tags_include ?? []).map((t) => tagLabel(catalog, t)).join(', ')}`;
    }
    return ch.label;
  }
  // `alongside`: the Nice part shown under a Must value on the same chip.
  function niceText(ch, alongside) {
    const p = ch.nice.params ?? {};
    switch (ch.key) {
      case 'size': return alongside ? `best ${niceRange(p.acres)}` : `${niceRange(p.acres)} acres`;
      case 'zoning': return alongside ? 'permitted ranks higher' : 'Zoning allows your use';
      case 'site': {
        if (alongside) return 'emptier sites rank higher';
        const out = [];
        if (p.vacancy) out.push('Vacant land');
        if (p.business_on_site) out.push('No business on site');
        return out.join(', ') || ch.label;
      }
      case 'sell': return alongside ? 'more signs rank higher' : 'Likely to sell';
      case 'families': return alongside ? 'more rank higher' : 'Families earning $200k+ nearby';
      case 'price': return alongside ? 'cheaper ranks higher' : 'Lower land price';
    }
    return ch.label;
  }
  // { group, text, sub, level } for one chip.
  function describe(ch, catalog) {
    if (ch.must) return { group: 'must', text: mustText(ch, catalog), sub: ch.nice ? `${niceText(ch, true)}, ${word(catalog, ch.nice.importance)}` : '' };
    if (ch.nice) return { group: 'nice', text: niceText(ch, false), level: word(catalog, ch.nice.importance) };
    return { group: 'unset', text: ch.label, sub: 'Not set' };
  }
  const oneLine = (ch, catalog) => { const t = describe(ch, catalog); return [t.text, t.sub, t.level].filter(Boolean).join(' · '); };

  // ---------- The bar ----------
  function render(el, project, catalog, handlers = {}) {
    const chips = project.chips ?? [];
    const pending = project.spec?.pending ?? [];
    const groups = { must: [], nice: [], unset: [] };
    for (const ch of chips) groups[describe(ch, catalog).group].push(ch);
    const chipBtn = (ch) => {
      const t = describe(ch, catalog);
      const groupWord = t.group === 'must' ? 'Must have' : t.group === 'nice' ? 'Nice to have' : 'Not set';
      return `<button type="button" class="cchip ${t.group}" data-chip="${esc(ch.key)}" aria-label="${esc(`${ch.label}. ${groupWord}: ${[t.text, t.sub, t.level].filter(Boolean).join(', ')}`)}">`
        + `<span>${esc(t.text)}${t.level ? ` <span class="lvl">${esc(t.level)}</span>` : ''}</span>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</button>`;
    };
    const present = new Set(chips.map((c) => c.key));
    const addable = catalog.criteria.chips.filter((c) => !c.standard && !present.has(c.key));
    let html = '';
    if (groups.must.length) html += `<span class="critGrp">Must</span>${groups.must.map(chipBtn).join('')}`;
    if (groups.nice.length) html += `<span class="critGrp">Nice</span>${groups.nice.map(chipBtn).join('')}`;
    if (groups.unset.length) html += groups.unset.map(chipBtn).join('');
    if (pending.length) {
      html += '<span class="critGrp">Not checked yet</span>' + pending.map((p, i) => {
        const label = catalog.criteria.pending[p.key]?.label ?? p.key;
        return `<button type="button" class="cchip pending" data-pending="${i}" aria-label="${esc(`${label}, not checked yet: ${p.value}`)}"><span>${esc(label)}</span>${p.value ? `<small>${esc(p.value)}</small>` : ''}</button>`;
      }).join('');
    }
    if (addable.length) {
      html += '<button type="button" class="cchip add" data-add aria-expanded="false" aria-controls="critAddMenu">+ Add</button>'
        + `<span id="critAddMenu" class="critAddMenu" hidden>${addable.map((c) => `<button type="button" class="cchip unset" data-add-key="${esc(c.key)}">${esc(c.label)}</button>`).join('')}</span>`;
    }
    el.innerHTML = html;
    el.onclick = (e) => {
      const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
      const addBtn = el.querySelector('[data-add]');
      if (b.dataset.chip) handlers.onChip?.(b.dataset.chip, b);
      else if (b.dataset.pending != null) showPending(pending[+b.dataset.pending], catalog, () => (b.isConnected ? b : null));
      else if (b.hasAttribute('data-add')) {
        const menu = el.querySelector('#critAddMenu');
        menu.hidden = !menu.hidden;
        b.setAttribute('aria-expanded', String(!menu.hidden));
        if (!menu.hidden) menu.querySelector('button')?.focus();
      } else if (b.dataset.addKey) {
        el.querySelector('#critAddMenu').hidden = true; addBtn?.setAttribute('aria-expanded', 'false');
        (handlers.onAdd ?? handlers.onChip)?.(b.dataset.addKey, addBtn ?? b);
      }
    };
    el.onkeydown = (e) => {
      const menu = el.querySelector('#critAddMenu');
      if (e.key === 'Escape' && menu && !menu.hidden) { menu.hidden = true; const a = el.querySelector('[data-add]'); a.setAttribute('aria-expanded', 'false'); a.focus(); }
    };
  }

  // ---------- One dialog, reused ----------
  let dlg = null, onClose = null, returnTo = null;
  function dialog(html, { returnFocus, closing } = {}) {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'critDlg';
      dlg.setAttribute('aria-labelledby', 'critDlgTitle');
      document.body.append(dlg);
      dlg.addEventListener('click', (e) => {
        const r = dlg.getBoundingClientRect();
        const outside = e.target === dlg && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
        if (outside || e.target.closest('[data-close]')) dlg.close();
      });
      dlg.addEventListener('close', () => {
        if (dlg.open) return; // reopened before this (queued) event fired
        const done = onClose, back = returnTo;
        onClose = null; returnTo = null;
        done?.();
        const f = back?.();
        if (f?.isConnected) f.focus();
      });
    }
    if (dlg.open) { const done = onClose; onClose = null; returnTo = null; done?.(); dlg.close(); }
    dlg.innerHTML = html;
    onClose = closing ?? null; returnTo = returnFocus ?? null;
    dlg.showModal();
    return dlg;
  }

  function showPending(item, catalog, returnFocus) {
    const info = catalog.criteria.pending[item.key] ?? { label: item.key, instead: '' };
    dialog(`<h2 id="critDlgTitle" class="critTitle">${esc(info.label)}</h2>
      <p class="critKicker">Not checked yet</p>
      ${item.value ? `<p class="critRead">You asked for: <b>${esc(item.value)}</b></p>` : ''}
      <p class="critRead">${esc(info.instead)}</p>
      <div class="critFoot"><button type="button" data-close>Close</button></div>`, { returnFocus });
  }

  // ---------- The editor ----------
  // Value inputs per chip. Each returns { html, also, read(matter, also) → { must, niceParams } | { error } }.
  const checks = (name, items, checked) => `<div class="critChecks">${items.map(([v, label]) => `<label><input type="checkbox" data-${name}="${esc(v)}" ${checked.includes(v) ? 'checked' : ''}> ${esc(label)}</label>`).join('')}</div>`;
  const ticked = (q, name) => [...q.querySelectorAll(`[data-${name}]`)].filter((x) => x.checked).map((x) => x.getAttribute(`data-${name}`));

  function parts(ch, catalog, q) {
    const must = ch.must ?? {}, nice = ch.nice?.params ?? {};
    switch (ch.key) {
      case 'size': {
        let [from, to] = ch.must ? must.acres : ch.nice ? [nice.acres?.min, nice.acres?.max] : [null, null];
        if (!ch.must && to >= OPEN) to = null;
        const best = ch.must && ch.nice ? nice.acres ?? {} : {};
        const presets = [[5, 10], [10, 15], [15, 25], [25, null]];
        return {
          html: `<div class="critNums"><input id="cvFrom" type="number" min="0" step="1" inputmode="decimal" aria-label="Smallest, in acres" value="${from ?? ''}"><span>to</span>`
            + `<input id="cvTo" type="number" min="0" step="1" inputmode="decimal" aria-label="Largest, in acres" value="${to ?? ''}"><span>acres</span></div>`
            + `<div class="critPresets" role="group" aria-label="Common sizes">${presets.map(([a, b]) => `<button type="button" data-preset="${a},${b ?? ''}">${b ? `${a}–${b}` : `${a}+`}</button>`).join('')}</div>`,
          alsoLabel: 'Also rank a best size higher',
          alsoHtml: `<div class="critNums critBest" id="critBest"><span>Best</span><input id="cvBestFrom" type="number" min="0" step="1" aria-label="Best size, smallest" value="${best.min ?? ''}"><span>to</span>`
            + `<input id="cvBestTo" type="number" min="0" step="1" aria-label="Best size, largest" value="${best.max != null && best.max < OPEN ? best.max : ''}"><span>acres</span></div>`,
          read(matter, also) {
            const f = num(q('#cvFrom').value), t = num(q('#cvTo').value);
            if (f == null && t == null) return { error: 'Enter a size.' };
            if (f != null && t != null && f > t) return { error: 'Put the smaller number first.' };
            if (matter === 'nice') return { niceParams: { acres: { min: f ?? 0, max: t ?? OPEN } } };
            if (!also) return { must: { acres: [f, t] } };
            const bf = num(q('#cvBestFrom').value) ?? f ?? 0, bt = num(q('#cvBestTo').value) ?? t ?? OPEN;
            if (bf > bt) return { error: 'Put the smaller best size first.' };
            return { must: { acres: [f, t] }, niceParams: { acres: { min: bf, max: bt } } };
          },
        };
      }
      case 'where': {
        const jur = must.jurisdiction?.length === 1 ? must.jurisdiction : ['city', 'unincorporated'];
        return {
          html: `<label class="critField">Towns to include <input id="cvTowns" type="text" placeholder="Redmond, Sammamish, Duvall" value="${esc((must.area ?? []).join(', '))}"></label>`
            + checks('jur', [['city', 'Inside a city'], ['unincorporated', 'Unincorporated county']], jur),
          read() {
            const area = q('#cvTowns').value.split(',').map((x) => x.trim()).filter(Boolean);
            const j = ticked(q(''), 'jur');
            if (!j.length) return { error: 'Pick inside a city, unincorporated, or both.' };
            const m = {};
            if (area.length) m.area = area;
            if (j.length === 1) m.jurisdiction = j;
            if (!Object.keys(m).length) return { error: 'Name a town, or pick only one of the two.' };
            return { must: m };
          },
        };
      }
      case 'zoning': {
        const stored = must['zoning.sports_facility'] ?? ZONING.map(([v]) => v);
        const extra = stored.filter((v) => !ZONING.some(([z]) => z === v)); // values this editor doesn't offer are kept as they are
        return {
          html: checks('zone', ZONING, stored),
          mustOnlyValue: true,
          alsoLabel: 'Also rank permitted above allowed with a permit',
          read(matter, also) {
            const np = { 'zoning.sports_facility': {} };
            if (matter === 'nice') return { niceParams: np };
            const set = ticked(q(''), 'zone');
            if (!set.length) return { error: 'Pick at least one.' };
            return { must: { 'zoning.sports_facility': [...set, ...extra] }, niceParams: also ? np : undefined };
          },
        };
      }
      case 'site': {
        const bos = nice.business_on_site;
        const on = ch.must
          ? [must.vacant && 'vacant', must.tags_exclude?.includes('operating-business') && 'op', !must.tags_exclude?.includes('closing-tenant') && 'closing', must.tags_exclude?.includes('anchor-tenant') && 'anchor']
          : ch.nice ? [nice.vacancy && 'vacant', bos && 'op', (!bos || bos.closing > 0) && 'closing', bos?.anchor === 0 && 'anchor'] : ['closing'];
        return {
          html: checks('site', [['vacant', 'Vacant land only'], ['op', 'Hide operating businesses'], ['closing', 'Allow closing tenants'], ['anchor', 'Avoid major anchors']], on.filter(Boolean)),
          alsoLabel: 'Also rank emptier sites higher',
          read(matter, also) {
            const s = ticked(q(''), 'site');
            const niceParams = () => {
              const p = {};
              if (s.includes('vacant')) p.vacancy = {};
              if (s.includes('op') || s.includes('anchor')) {
                const d = { ...defaults(catalog, 'business_on_site'), ...(bos ?? {}) };
                p.business_on_site = {
                  closing: s.includes('closing') ? (d.closing > 0 ? d.closing : 65) : 0,
                  anchor: s.includes('anchor') ? 0 : Math.max(d.anchor ?? 0, d.operating ?? 15),
                };
              }
              return Object.keys(p).length ? p : null;
            };
            if (matter === 'nice') {
              const p = niceParams();
              return p ? { niceParams: p } : { error: 'Pick vacant land, operating businesses or anchors.' };
            }
            const m = {}, ex = [];
            if (s.includes('vacant')) m.vacant = true;
            if (s.includes('op')) ex.push('operating-business');
            if (s.includes('anchor')) ex.push('anchor-tenant');
            if (!s.includes('closing')) ex.push('closing-tenant');
            if (ex.length) m.tags_exclude = ex;
            if (!Object.keys(m).length) return { error: "Pick at least one, or choose Doesn't matter." };
            if (!also) return { must: m };
            const p = niceParams();
            return p ? { must: m, niceParams: p } : { error: 'To rank emptier sites higher, pick vacant land, operating businesses or anchors.' };
          },
        };
      }
      case 'sell': {
        const stored = nice.owner_signals?.points ?? defaults(catalog, 'owner_signals').points ?? {};
        const keys = Object.keys(catalog.criteria.signals);
        const on = ch.must ? must.owner_signals : ch.nice ? keys.filter((k) => stored[k] > 0) : [];
        return {
          html: checks('sig', keys.map((k) => [k, signalLabel(catalog, k)]), on),
          alsoLabel: 'Also rank sites with more signs higher',
          read(matter, also) {
            const s = ticked(q(''), 'sig');
            if (!s.length) return { error: 'Pick at least one sign.' };
            const def = defaults(catalog, 'owner_signals').points ?? {};
            const points = Object.fromEntries(keys.map((k) => {
              const cur = stored[k] ?? def[k] ?? 0;
              if (s.includes(k)) return [k, cur > 0 ? cur : def[k] > 0 ? def[k] : 15];
              return [k, cur > 0 ? 0 : cur];
            }));
            const np = { owner_signals: { points } };
            if (matter === 'nice') return { niceParams: np };
            return { must: { owner_signals: s }, niceParams: also ? np : undefined };
          },
        };
      }
      case 'families':
      case 'price': {
        const field = ch.key === 'families' ? 'hh200k_10mi' : 'land_value_per_acre';
        const v = must[field] ?? nice[field]?.target ?? defaults(catalog, field).target ?? '';
        const input = `<input id="cvNum" type="number" min="0" step="${ch.key === 'families' ? 100 : 1000}" aria-label="${ch.key === 'families' ? 'Households' : 'Dollars per acre'}" value="${v}">`;
        return {
          html: ch.key === 'families'
            ? `<div class="critNums"><span>At least</span>${input}</div><p class="critRead">households earning $200k+ within 10 miles</p>`
            : `<div class="critNums"><span>At most $</span>${input}<span>an acre</span></div><p class="critRead">County assessed land value, not a market price.</p>`,
          alsoLabel: ch.key === 'families' ? 'Also rank more families higher' : 'Also rank cheaper land higher',
          read(matter, also) {
            const n = num(q('#cvNum').value);
            if (n == null) return { error: 'Enter a number.' };
            if (matter === 'nice') return { niceParams: { [field]: { target: n } } };
            return { must: { [field]: n }, niceParams: also ? { [field]: {} } : undefined };
          },
        };
      }
      case 'tagged': {
        return {
          html: checks('tag', Object.entries(catalog.criteria.tags), must.tags_include ?? []),
          read() {
            const s = ticked(q(''), 'tag');
            return s.length ? { must: { tags_include: s } } : { error: 'Pick at least one.' };
          },
        };
      }
    }
    return { html: '', read: () => ({ error: 'This one can’t be edited here.' }) };
  }

  function edit(opts) {
    const { catalog, key } = opts;
    let base = opts.project;
    const def = catalog.criteria.chips.find((c) => c.key === key);
    if (!def) return;
    const ch = base.chips.find((c) => c.key === key) ?? { key, label: def.label, standard: def.standard, canNice: def.canNice, must: null, nice: null };
    const canNice = def.canNice;
    const matter = ch.must ? 'must' : ch.nice ? 'nice' : 'must';
    const level = ch.nice?.importance ?? 'some';
    let q = () => null;
    const p = parts(ch, catalog, (s) => q(s));
    const opt = (value, title, desc) => `<label class="critOpt"><input type="radio" name="matter" value="${value}" ${matter === value ? 'checked' : ''}><span><b>${title}</b><span>${desc}</span></span></label>`;

    const d = dialog(`<form class="critForm" novalidate>
      <h2 id="critDlgTitle" class="critTitle">${esc(def.label)}</h2>
      <p id="critNotice" class="critNotice" role="status" hidden></p>
      <fieldset id="critValue" class="critValue"><legend class="vh">Value</legend>${p.html}</fieldset>
      <fieldset class="critMatter"><legend>How much does this matter?</legend>
        ${opt('must', 'Must have', "Hide sites that don't fit.")}
        ${canNice ? opt('nice', 'Nice to have', 'Show every site; rank the ones that fit higher.') : ''}
        ${opt('none', "Doesn't matter", ch.standard ? 'Leave it unset.' : 'Remove it from the project.')}
      </fieldset>
      ${canNice ? `<div id="critAlso" class="critAlso"><label class="critCheck"><input type="checkbox" id="cvAlso" ${ch.must && ch.nice ? 'checked' : ''}> ${esc(p.alsoLabel)}</label>${p.alsoHtml ?? ''}</div>
      <div id="critLevels" class="critLevels" role="radiogroup" aria-label="How much"><span>How much:</span>${LEVELS.map((l) => `<label><input type="radio" name="level" value="${l}" ${l === level ? 'checked' : ''}> ${esc(word(catalog, l))}</label>`).join('')}</div>` : ''}
      <div class="critFoot"><button type="submit" id="critApply">Show sites</button><button type="button" class="secondary" data-close>Cancel</button>
        <span class="critCount"><span id="critCount" aria-live="polite"></span>${opts.nowCount?.() != null ? `<span class="critNow">Now ${fmtN(opts.nowCount())}</span>` : ''}</span></div>
      <p id="critMsg" class="msg" role="alert"></p>
    </form>`, { returnFocus: opts.returnFocus, closing: () => { closed = true; clearTimeout(timer); } });
    q = (s) => (s ? d.querySelector(s) : d);
    const form = d.querySelector('form');
    let closed = false, saving = false, timer = null, seq = 0, invalid = false;

    const current = () => form.elements.matter.value;
    function sync() {
      const m = current(), also = d.querySelector('#cvAlso')?.checked;
      d.querySelector('#critValue').disabled = m === 'none' || (m === 'nice' && p.mustOnlyValue);
      if (canNice) {
        d.querySelector('#critAlso').hidden = m !== 'must';
        const best = d.querySelector('#critBest'); if (best) best.hidden = !also;
        d.querySelector('#critLevels').hidden = !(m === 'nice' || (m === 'must' && also));
      }
      for (const b of d.querySelectorAll('[data-preset]')) {
        const [a, z] = b.dataset.preset.split(',');
        b.setAttribute('aria-pressed', String(d.querySelector('#cvFrom').value === a && d.querySelector('#cvTo').value === z));
      }
    }
    function readEdit() {
      const m = current();
      if (m === 'none') return { edit: { must: null, nice: null } };
      const also = m === 'must' && Boolean(d.querySelector('#cvAlso')?.checked);
      const r = p.read(m, also);
      if (r.error) return r;
      const importance = form.elements.level?.value || 'some';
      return { edit: { must: m === 'must' ? r.must : null, nice: r.niceParams ? { importance, params: r.niceParams } : null } };
    }
    const countEl = d.querySelector('#critCount'), applyBtn = d.querySelector('#critApply'), msg = d.querySelector('#critMsg');
    function setCount(state, n) {
      invalid = state === 'invalid';
      countEl.textContent = state === 'loading' ? 'Counting…' : state === 'fail' ? 'Couldn’t count — apply anyway?' : state === 'invalid' ? n : n === 0 ? 'No sites match' : `${fmtN(n)} site${n === 1 ? '' : 's'}`;
      countEl.className = state === 'invalid' || (state === 'ok' && n === 0) ? 'warnText' : '';
      applyBtn.textContent = state === 'fail' || (state === 'ok' && n === 0) ? 'Apply anyway' : state === 'ok' ? `Show ${fmtN(n)} site${n === 1 ? '' : 's'}` : 'Show sites';
      applyBtn.disabled = invalid || saving;
    }
    function schedule() {
      sync();
      clearTimeout(timer);
      const r = readEdit();
      if (r.error) { seq++; setCount('invalid', r.error); return; }
      setCount('loading');
      const my = ++seq;
      timer = setTimeout(async () => {
        try {
          const { count } = await request(`/api/projects/${base.id}/preview`, { method: 'POST', body: { chip: { key, edit: r.edit }, hidePassed: opts.hidePassed ?? true } });
          if (my === seq && !closed) setCount('ok', count);
        } catch { if (my === seq && !closed) setCount('fail'); }
      }, 350);
    }

    d.querySelector('.critPresets')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-preset]'); if (!b) return;
      const [a, z] = b.dataset.preset.split(',');
      d.querySelector('#cvFrom').value = a; d.querySelector('#cvTo').value = z;
      schedule();
    });
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saving) return;
      const r = readEdit();
      if (r.error) { msg.className = 'msg err'; msg.textContent = r.error; return; }
      saving = true; applyBtn.disabled = true; msg.className = 'msg'; msg.textContent = 'Saving…';
      try {
        const saved = await request(`/api/projects/${base.id}`, { method: 'PUT', body: { chip: { key, edit: r.edit }, baseVersion: base.spec_version } });
        base = saved; closed = true;
        opts.onSaved?.(saved);
        d.close();
      } catch (err) {
        if (err.status === 409 && err.body?.project) {
          base = err.body.project;
          opts.onConflict?.(base);
          const now = base.chips?.find((c) => c.key === key);
          const notice = d.querySelector('#critNotice');
          notice.hidden = false;
          notice.textContent = `Changed by a teammate — here's the current version: ${now ? oneLine(now, catalog) : 'not set'}. Your change is still below; apply it again to keep it.`;
          msg.textContent = '';
        } else { msg.className = 'msg err'; msg.textContent = err.message; }
      } finally {
        saving = false;
        if (!closed) schedule();
      }
    });
    schedule();
  }

  // ---------- Undo and History ----------
  const specOf = (h) => (typeof h.spec === 'string' ? JSON.parse(h.spec) : h.spec);
  function restore(project, spec) {
    return request(`/api/projects/${project.id}`, { method: 'PUT', body: { spec, baseVersion: project.spec_version, source: 'undo' } });
  }
  // Which chips differ between two versions of a spec.
  function changedChips(before, after, catalog) {
    const pick = (s, def) => JSON.stringify([
      (s.requirements ?? []).filter((r) => def.must.includes(r.field)).map((r) => [r.field, r.value]),
      (s.preferences ?? []).filter((p) => def.nice.includes(p.field)).map((p) => [p.field, p.weight, p.params]),
    ]);
    const out = catalog.criteria.chips.filter((def) => pick(before, def) !== pick(after, def)).map((def) => def.label);
    if (JSON.stringify(before.pending ?? []) !== JSON.stringify(after.pending ?? [])) out.push('Not checked yet');
    return out;
  }
  const whenText = (d) => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  function history(opts) {
    const { catalog, me } = opts;
    let project = opts.project;
    const who = (h) => (me && h.changed_by && h.changed_by === me.user_uid ? 'You' : 'A teammate');
    const rows = () => (project.history ?? []).map((h, i, all) => {
      const prev = all[i + 1];
      const changed = prev ? changedChips(specOf(prev), specOf(h), catalog) : [];
      const what = !prev ? 'Created' : h.source === 'undo' ? 'Went back to an earlier version' : changed.length ? `Changed ${changed.join(', ')}` : (h.change_note || 'Saved');
      return `<li><span class="critVer">v${h.version}</span><span><b>${esc(what)}</b><small>${esc(who(h))} · ${esc(whenText(h.created_at))}${h.change_note && what !== h.change_note ? ` · ${esc(h.change_note)}` : ''}</small></span>`
        + `${i === 0 ? '<span class="critNow">Current</span>' : `<button type="button" class="secondary" data-restore="${i}">Restore</button>`}</li>`;
    }).join('');
    const d = dialog(`<h2 id="critDlgTitle" class="critTitle">History</h2>
      <p id="critNotice" class="critNotice" role="status" hidden></p>
      <ol class="critHist">${rows()}</ol>
      <p id="critMsg" class="msg" role="alert"></p>
      <div class="critFoot"><button type="button" class="secondary" data-close>Close</button></div>`, { returnFocus: opts.returnFocus });
    let saving = false;
    d.querySelector('.critHist').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-restore]'); if (!b || saving) return;
      const h = project.history[+b.dataset.restore];
      saving = true; b.disabled = true; d.querySelector('#critMsg').className = 'msg'; d.querySelector('#critMsg').textContent = 'Saving…';
      try {
        const saved = await restore(project, specOf(h));
        opts.onSaved?.(saved);
        d.close();
      } catch (err) {
        if (err.status === 409 && err.body?.project) {
          project = err.body.project;
          opts.onConflict?.(project);
          d.querySelector('.critHist').innerHTML = rows();
          const n = d.querySelector('#critNotice'); n.hidden = false;
          n.textContent = "Changed by a teammate — here's the current version. Pick Restore again if you still want an earlier one.";
          d.querySelector('#critMsg').textContent = '';
        } else { d.querySelector('#critMsg').className = 'msg err'; d.querySelector('#critMsg').textContent = err.message; b.disabled = false; }
      } finally { saving = false; }
    });
  }

  return { render, describe, edit, history, restore, request, showPending };
})();
