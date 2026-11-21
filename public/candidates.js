/* global map, api, $, fmt, esc, config, renderProfile, setDrive, setSpend, maplibregl */
// Candidates tab: every 5+ acre King County parcel, scored from free county data.
// Loaded after app.js and reuses its helpers (api, fmt, esc, renderProfile, setDrive).
(() => {
  let cand = { type: 'FeatureCollection', features: [], total: 0 };
  let candSel = null;
  let projects = [], project = null, catalog = null, draft = null;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
  const VERDICT_LABEL = { permitted: 'Permitted', conditional: 'Conditional use', prohibited: 'Not allowed', unknown: 'Unknown' };
  const VERDICT_PILL = { permitted: 'pass', conditional: 'review', prohibited: 'fail', unknown: 'unknown' };
  const { chip: scoreChip, mapExpr: scoreMapExpr, scoreColor } = window.paydirtScore; // one ramp: chips, dots, legend, bars
  const fmtPin = (pin) => `${String(pin).slice(0, 6)}-${String(pin).slice(6)}`;
  const siteTitle = (p) => p.address || `Parcel ${fmtPin(p.pin)}`;
  // The facts a scanner needs, as at most three short labels: zoning, what's on the site, the owner.
  const SITE_PILL = [['closing-tenant', 'review', 'Closing tenant'], ['anchor-tenant', 'fail', 'Anchor tenant'], ['operating-business', 'fail', 'Business on site'],
    ['possible-empty-building', 'review', 'Empty building?'], ['vacant-land', 'pass', 'Vacant']];
  function rowFacts(p) {
    const out = [`<span class="pill ${VERDICT_PILL[p.sports_verdict]}">${esc(VERDICT_SHORT[p.sports_verdict] ?? p.sports_verdict)}</span>`];
    const site = SITE_PILL.find(([t]) => p.tags?.includes(t));
    if (site) out.push(`<span class="pill ${site[1]}">${site[2]}</span>`);
    const sig = p.signals.find((s) => /inherit/.test(s)) ? 'Inherited' : p.years_held >= 20 ? `Held ${Math.floor(p.years_held)}y` : p.signals.find((s) => /no market sale/.test(s)) ? 'No sale on record' : null;
    if (sig) out.push(`<span class="pill">${sig}</span>`);
    if (p.status !== 'new') out.push(`<span class="pill ${p.status}">${esc(p.status)}</span>`);
    return out.join('');
  }
  const TAG_TEXT = { 'vacant-land': 'Vacant land', 'operating-business': 'Business operating', 'anchor-tenant': 'Major anchor tenant', 'leased-to-business': 'Leased to a business',
    'company-owned': 'Company-owned', 'closing-tenant': 'Closing tenant', 'possible-empty-building': 'Possible empty building', 'tax-bill-to-business': 'Tax bill paid by a business' };
  const TAG_TONE = { 'vacant-land': 'pass', 'operating-business': 'fail', 'anchor-tenant': 'fail', 'leased-to-business': 'fail', 'closing-tenant': 'review', 'possible-empty-building': 'review' };
  const OWNER_TEXT = { individual: 'Individual', trust: 'Family trust or estate', llc: 'LLC', company: 'Company', government: 'Government' };
  const VERDICT_SHORT = { permitted: 'Permitted', conditional: 'Conditional', prohibited: 'Not allowed', unknown: 'Zoning unknown' };
  const where = (p) => p.city ? titleCase(p.city) : `Unincorporated${p.postal_city ? ' · ' + titleCase(p.postal_city) : ''}`;
  const titleCase = (s) => String(s ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  // ---------- Tabs ----------
  function showTab(which) {
    const c = which === 'cand';
    $('tabCand').hidden = !c; $('tabSearch').hidden = c;
    $('tabBtnCand').setAttribute('aria-selected', String(c)); $('tabBtnSearch').setAttribute('aria-selected', String(!c));
    for (const id of ['cand-pt']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', c ? 'visible' : 'none');
    $('candLegend').hidden = !c;
  }
  $('tabBtnCand').onclick = () => showTab('cand');
  $('tabBtnSearch').onclick = () => showTab('search');

  // ---------- Map layers ----------
  map.on('load', () => {
    const before = map.getLayer('parcel-fill') ? 'parcel-fill' : undefined;
    map.addSource('cand', { type: 'geojson', data: cand, promoteId: 'pin' });
    map.addSource('cand-sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'cand-sel-fill', type: 'fill', source: 'cand-sel', paint: { 'fill-color': '#1F4D36', 'fill-opacity': 0.25 } }, before);
    map.addLayer({ id: 'cand-sel-line', type: 'line', source: 'cand-sel', paint: { 'line-color': '#D4AF4E', 'line-width': 3 } }, before);
    map.addLayer({
      id: 'cand-pt', type: 'circle', source: 'cand',
      paint: {
        'circle-color': scoreMapExpr('score'),
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, ['case', ['boolean', ['feature-state', 'sel'], false], 7, 3], 13, ['case', ['boolean', ['feature-state', 'sel'], false], 11, 7]],
        'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 13, 1.5],
        'circle-opacity': 0.9,
      },
    });
    map.on('click', 'cand-pt', (e) => selectCandidate(e.features[0].properties.pin, false));
    map.on('mouseenter', 'cand-pt', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'cand-pt', () => { map.getCanvas().style.cursor = ''; });
    loadProjects().then(loadCandidates).catch(showErr);
  });

  // ---------- Data ----------
  let pending = null;
  async function loadCandidates() {
    const q = new URLSearchParams();
    const set = (k, v) => { if (v !== '' && v != null) q.set(k, v); };
    set('minAcres', $('cMinAc').value); set('maxAcres', $('cMaxAc').value);
    set('verdict', $('cVerdict').value); set('minScore', +$('cMinScore').value || '');
    set('area', $('cArea').value.trim()); set('signal', $('cSignal').value); set('status', $('cStatus').value);
    const site = $('cSite').value; if (site.startsWith('-')) set('notTag', site.slice(1)); else set('tag', site);
    const key = q.toString();
    pending = key;
    $('cCount').textContent = '(loading…)';
    const r = await api(`/api/projects/${project.id}/candidates?` + key);
    if (pending !== key) return; // a newer filter change won
    cand = r;
    map.getSource('cand')?.setData(cand);
    renderCandList();
  }
  let t = null;
  $('candForm').oninput = () => { clearTimeout(t); t = setTimeout(() => loadCandidates().catch(showErr), 300); };
  $('candForm').onsubmit = (e) => e.preventDefault();
  const showErr = (e) => { $('cCount').textContent = ''; $('cList').innerHTML = `<li class="msg err">${esc(e.message)}</li>`; };

  function renderCandList() {
    const shown = cand.features.slice(0, 150);
    $('cCount').textContent = `(${cand.total.toLocaleString()}${cand.total > shown.length ? `, top ${shown.length} listed` : ''})`;
    $('cList').innerHTML = shown.map(({ properties: p }) => `
      <li data-pin="${esc(p.pin)}" class="row ${p.pin === candSel ? 'sel' : ''}">
        ${scoreChip(p.score)}
        <div class="rowMain">
          <span class="t">${esc(siteTitle(p))}</span>
          <span class="m">${fmt.ac(p.acres)} · ${esc(p.zoning || 'No zone')} · ${esc(where(p))}</span>
          <span class="facts">${rowFacts(p)}</span>
        </div>
      </li>`).join('') || '<li class="muted">No candidates match these filters.</li>';
    window.paydirtTaper.apply($('cList'));
  }
  $('cList').onclick = (e) => { const li = e.target.closest('li[data-pin]'); if (li) selectCandidate(li.dataset.pin, true); };

  // ---------- Projects ----------
  async function loadProjects(selectId) {
    const r = await api('/api/projects');
    projects = r.projects; catalog = r.catalog;
    const want = Number(selectId ?? store.get('paydirt.project'));
    project = projects.find((p) => p.id === want) ?? projects[0];
    if (!project) throw new Error('No projects yet.');
    $('cProject').innerHTML = projects.map((p) => `<option value="${p.id}" ${p.id === project.id ? 'selected' : ''}>${esc(p.name)}${p.shortlisted ? ` (${p.shortlisted} shortlisted)` : ''}</option>`).join('');
    $('jAddReq').innerHTML = '<option value="">+ Add requirement…</option>' + Object.entries(catalog.requirements).map(([k, d]) => `<option value="${k}">${esc(d.label)}</option>`).join('');
    $('jAddPref').innerHTML = '<option value="">+ Add preference…</option>' + Object.entries(catalog.preferences).map(([k, d]) => `<option value="${k}">${esc(d.label)}</option>`).join('');
    applyProject();
  }

  function applyProject() {
    store.set('paydirt.project', String(project.id));
    draft = structuredClone(project.spec);
    const acres = draft.preferences.find((p) => p.field === 'acres')?.params;
    if (acres) { $('cMinAc').value = acres.min; $('cMaxAc').value = acres.max; } else { $('cMinAc').value = ''; $('cMaxAc').value = ''; }
    $('jName').value = project.name; $('jBrief').value = project.brief ?? ''; $('jNote').value = ''; $('jMsg').textContent = '';
    renderCriteria();
    loadHistory();
  }

  async function loadHistory() {
    try {
      const r = await api(`/api/projects/${project.id}`);
      $('jHist').innerHTML = r.history.map((h) => `<li>v${h.version} · ${esc(new Date(h.created_at).toLocaleDateString())} · ${esc(h.source)}${h.change_note ? ` — ${esc(h.change_note)}` : ''}</li>`).join('');
    } catch { /* history is optional */ }
  }

  $('cProject').onchange = () => {
    project = projects.find((p) => p.id === Number($('cProject').value)) ?? project;
    window.clearCandidate(); $('detail').hidden = true;
    applyProject();
    loadCandidates().catch(showErr);
  };

  const signalLabel = (k) => catalog.signals[k] ?? k;
  const optLabel = (field, o) => (field === 'owner_signals' ? signalLabel(o) : o === 'city' ? 'Inside a city' : o === 'unincorporated' ? 'Unincorporated county' : o[0].toUpperCase() + o.slice(1));

  function reqEditor(r, i) {
    const d = catalog.requirements[r.field];
    let body = '';
    if (d.type === 'range') body = `<div class="row"><label>Min <input type="number" data-k="min" value="${r.value?.[0] ?? ''}"></label><label>Max <input type="number" data-k="max" value="${r.value?.[1] ?? ''}"></label></div>`;
    else if (d.type === 'set') body = `<div class="opts">${d.options.map((o) => `<label><input type="checkbox" data-opt="${o}" ${(r.value ?? []).includes(o) ? 'checked' : ''}> ${esc(optLabel(r.field, o))}</label>`).join('')}</div>`;
    else if (d.type === 'list') body = `<input type="text" data-k="list" value="${esc((r.value ?? []).join(', '))}" placeholder="Redmond, Sammamish, Duvall">`;
    else if (d.type === 'min' || d.type === 'max') body = `<input type="number" data-k="num" value="${r.value ?? ''}" placeholder="${d.type === 'min' ? 'At least' : 'At most'}">`;
    return `<div class="crit" data-kind="req" data-i="${i}"><div class="head">${esc(d.label)}<button type="button" data-remove title="Remove">×</button></div>${body}
      <input type="text" class="why" data-k="why" value="${esc(r.why ?? '')}" placeholder="Why (optional)"></div>`;
  }

  function prefEditor(p, i) {
    const d = catalog.preferences[p.field];
    const params = p.params ?? d.params;
    let extra = '';
    if (p.field === 'acres') extra = `<div class="row"><label>Target min <input type="number" data-p="min" value="${params.min}"></label><label>Target max <input type="number" data-p="max" value="${params.max}"></label></div>`;
    if (p.field === 'hh200k_10mi' || p.field === 'land_value_per_acre') extra = `<label>${p.field === 'hh200k_10mi' ? 'Households for a full score' : 'Full score at or below ($/acre)'} <input type="number" data-p="target" value="${params.target}"></label>`;
    if (p.field === 'owner_signals') extra = `<details><summary class="muted" style="font-size:12px">Points per signal</summary><div class="opts">${Object.entries(params.points).map(([k, v]) => `<label>${esc(signalLabel(k))} <input type="number" style="width:60px" data-pt="${k}" value="${v}"></label>`).join('')}</div></details>`;
    return `<div class="crit" data-kind="pref" data-i="${i}"><div class="head">${esc(d.label)}<button type="button" data-remove title="Remove">×</button></div>
      <label>Weight <input type="number" min="0" max="100" step="1" data-k="weight" value="${p.weight}"></label>${extra}
      <input type="text" class="why" data-k="why" value="${esc(p.why ?? '')}" placeholder="Why (optional)"></div>`;
  }

  function renderCriteria() {
    $('jReqs').innerHTML = draft.requirements.map(reqEditor).join('') || '<p class="muted" style="margin:0;font-size:12px">None: every parcel is ranked.</p>';
    const total = draft.preferences.reduce((a, p) => a + (Number(p.weight) || 0), 0) || 1;
    $('jPrefs').innerHTML = draft.preferences.map((p, i) => prefEditor(p, i).replace('</div>\n      <label>Weight', `<span class="muted" style="font-weight:400">${Math.round((Number(p.weight) || 0) / total * 100)}%</span></div>\n      <label>Weight`)).join('');
  }

  // Read the editors back into the draft spec.
  function readCriteria() {
    for (const el of document.querySelectorAll('#jReqs .crit')) {
      const r = draft.requirements[+el.dataset.i]; const d = catalog.requirements[r.field];
      r.why = el.querySelector('[data-k=why]').value;
      if (d.type === 'range') r.value = [el.querySelector('[data-k=min]').value, el.querySelector('[data-k=max]').value].map((v) => (v === '' ? null : +v));
      else if (d.type === 'set') r.value = [...el.querySelectorAll('[data-opt]')].filter((c) => c.checked).map((c) => c.dataset.opt);
      else if (d.type === 'list') r.value = el.querySelector('[data-k=list]').value.split(',').map((x) => x.trim()).filter(Boolean);
      else if (d.type === 'min' || d.type === 'max') r.value = el.querySelector('[data-k=num]').value === '' ? null : +el.querySelector('[data-k=num]').value;
      else r.value = true;
    }
    for (const el of document.querySelectorAll('#jPrefs .crit')) {
      const p = draft.preferences[+el.dataset.i];
      p.weight = +el.querySelector('[data-k=weight]').value || 0;
      p.why = el.querySelector('[data-k=why]').value;
      p.params = structuredClone(p.params ?? catalog.preferences[p.field].params);
      for (const inp of el.querySelectorAll('[data-p]')) p.params[inp.dataset.p] = +inp.value;
      for (const inp of el.querySelectorAll('[data-pt]')) p.params.points[inp.dataset.pt] = +inp.value;
    }
  }

  $('projForm').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]'); if (!rm) return;
    readCriteria();
    const el = rm.closest('.crit');
    (el.dataset.kind === 'req' ? draft.requirements : draft.preferences).splice(+el.dataset.i, 1);
    renderCriteria();
  });
  $('jPrefs').addEventListener('change', () => { readCriteria(); renderCriteria(); });
  $('jAddReq').onchange = () => {
    const f = $('jAddReq').value; if (!f) return; readCriteria();
    const d = catalog.requirements[f];
    draft.requirements.push({ field: f, value: d.type === 'set' ? [...d.options] : d.type === 'range' ? [null, null] : d.type === 'bool' ? true : null, why: '' });
    $('jAddReq').value = ''; renderCriteria();
  };
  $('jAddPref').onchange = () => {
    const f = $('jAddPref').value; if (!f) return; readCriteria();
    draft.preferences.push({ field: f, weight: 10, params: structuredClone(catalog.preferences[f].params), why: '' });
    $('jAddPref').value = ''; renderCriteria();
  };

  async function saveProject(asNew) {
    readCriteria();
    const body = { name: $('jName').value.trim() || 'Untitled project', brief: $('jBrief').value, spec: draft, changeNote: $('jNote').value.trim() };
    try {
      const saved = asNew
        ? await api('/api/projects', { method: 'POST', body: { ...body, name: body.name === project.name ? `${body.name} (copy)` : body.name } })
        : await api(`/api/projects/${project.id}`, { method: 'PUT', body });
      await loadProjects(saved.id);
      $('jMsg').className = 'msg'; $('jMsg').textContent = asNew ? 'Created a new project.' : `Saved as version ${saved.spec_version}. List re-ranked.`;
      await loadCandidates();
    } catch (e) { $('jMsg').className = 'msg err'; $('jMsg').textContent = e.message; }
  }
  $('projForm').onsubmit = (e) => { e.preventDefault(); saveProject(false); };
  $('jSaveNew').onclick = () => saveProject(true);

  // Let the builder (builder.js) reload projects and read the current one.
  window.paydirtProjects = { reload: async (id) => { await loadProjects(id); await loadCandidates(); }, current: () => project };

  // ---------- Detail ----------
  window.clearCandidate = () => {
    if (candSel) map.setFeatureState({ source: 'cand', id: candSel }, { sel: false });
    candSel = null;
    map.getSource('cand-sel')?.setData({ type: 'FeatureCollection', features: [] });
    renderCandList();
  };

  async function selectCandidate(pin, fly) {
    window.clearCandidate();
    // Leave any searched-parcel selection (app.js state).
    if (selectedId) { map.setFeatureState({ source: 'parcels', id: selectedId }, { selected: false }); selectedId = null; }
    candSel = pin; detailFor = pin;
    map.setFeatureState({ source: 'cand', id: pin }, { sel: true });
    renderCandList();
    setDrive(null);
    $('detail').hidden = false;
    $('detailBody').innerHTML = '<p class="muted">Loading…</p>';
    const c = await api(`/api/projects/${project.id}/candidates/${encodeURIComponent(pin)}`);
    if (detailFor !== pin) return;
    map.getSource('cand-sel').setData({ type: 'Feature', geometry: c.geometry, properties: {} });
    if (fly) {
      const b = new maplibregl.LngLatBounds(); eachCoord(c.geometry, (x) => b.extend(x));
      // Leave room for the detail panel, but never more padding than the map is wide.
      const w = map.getContainer().clientWidth, h = map.getContainer().clientHeight;
      const right = Math.min(400, w * 0.55), side = Math.min(60, w * 0.1), vert = Math.min(60, h * 0.15);
      map.fitBounds(b, { padding: { top: vert, bottom: vert, left: side, right }, maxZoom: 15 });
    }
    renderCandidate(c);
    api(`/api/candidates/${encodeURIComponent(pin)}/profile`).then((r) => renderProfile(r, pin)).catch((e) => { const el = $('ownOut'); if (el) el.textContent = e.message; });
  }

  const bar = (label, v) => `<span>${label}</span><span class="bar"><i style="width:${v}%;background:${scoreColor(v)}"></i></span><span>${v}</span>`;

  function renderCandidate(c) {
    const landPerAc = c.land_value && c.acres ? c.land_value / c.acres : null;
    $('detailBody').innerHTML = `
      <h3>${esc(c.address || 'No site address')}</h3>
      <p class="muted">PIN ${esc(c.pin)} · ${fmt.ac(c.acres)} · ${esc(where(c))} ${scoreChip(c.score)}</p>
      ${c.hiddenBecause.length ? `<p class="warn" data-taper="2">Not in this project's results: ${c.hiddenBecause.map(esc).join('; ')}</p>` : ''}
      <section><h2>Score for ${esc(project.name)}</h2><div class="bars">${c.subscores.map((s) => bar(`${esc(s.label)} <span class="muted">${Math.round(s.share * 100)}%</span>`, s.value)).join('')}</div>
        <p class="muted" style="font-size:12px;margin:0">Each line is 0–100; the percentage is its weight in this project's score (version ${project.spec_version}).</p></section>
      <section><h2>On this site</h2>
        <div class="tagRow">${(c.tags ?? []).map((t) => `<span class="pill ${TAG_TONE[t] ?? ''}">${esc(TAG_TEXT[t] ?? t)}</span>`).join('') || '<span class="muted">No site tags.</span>'}</div>
        <dl><dt>Owner type</dt><dd>${esc(OWNER_TEXT[c.owner_type] ?? 'Unknown')}</dd><dt>Building value</dt><dd>${c.impr_value != null && c.acres ? `${fmt.usd(c.impr_value / c.acres)} per acre` : '—'}</dd></dl>
        ${c.businesses.length ? `<div class="biz" data-taper="7"><span class="lbl">Businesses here (${c.businesses.length}, from OpenStreetMap)</span>${c.businesses.map((b) => `<div class="bizRow"><span><b>${esc(b.label)}</b> <span class="muted">${esc(b.kind ?? '')}</span>${b.note ? `<br><span class="muted" style="font-size:12px">${esc(b.note)}</span>` : ''}</span><span class="pill ${b.status === 'closing' ? 'review' : b.status === 'anchor' ? 'fail' : ''}">${b.status === 'anchor' ? 'Anchor' : b.status === 'closing' ? 'Closing' : 'Open'}</span></div>`).join('')}</div>` : '<p class="muted" style="margin:0;font-size:13px">No businesses mapped on this parcel.</p>'}
      </section>
      <section><h2>Zoning for a sports club <span class="pill ${VERDICT_PILL[c.sports_verdict]}">${esc(VERDICT_LABEL[c.sports_verdict])}</span></h2>
        <dl><dt>Zone</dt><dd>${esc(c.zoning || '—')}</dd></dl>
        <p style="margin:0;font-size:13px" data-taper="3">${esc(c.sports_note)}</p>
        ${c.zoning_source ? `<p class="muted" style="font-size:12px;margin:0">Source: <a href="${esc(c.zoning_source)}" target="_blank" rel="noopener">${c.city ? esc(where(c)) + ' use table' : 'King County Code Title 21A (updated Sep 9, 2026)'}</a>, read Nov 2026. Confirm with the ${c.city ? 'city' : 'county'} before relying on it.</p>` : ''}</section>
      <section><h2>Owner signals</h2>
        <div data-taper="2">${c.signals.map((s) => `<span class="chip">${esc(s)}</span>`).join('') || '<span class="muted">None found.</span>'}</div>
        <dl><dt>Tax bill mailed to</dt><dd>${esc(c.mail_city_state || '—')}</dd>
        ${c.current_use ? `<dt>Tax program</dt><dd>${esc(c.current_use)} (leaving it can trigger back taxes)</dd>` : ''}</dl></section>
      <section><h2>Ownership history</h2><div id="ownOut" class="muted">Loading…</div></section>
      <section><h2>Who's nearby</h2><div id="reachOut" class="muted">Loading…</div></section>
      <section><h2>Land</h2><dl>
        <dt>Current use</dt><dd>${esc(c.present_use || '—')}</dd>
        <dt>Land value</dt><dd>${fmt.usd(c.land_value)}${landPerAc ? ` (${fmt.usd(landPerAc)}/ac)` : ''}</dd>
        <dt>Building value</dt><dd>${fmt.usd(c.impr_value)}</dd></dl>
        <p class="muted" style="font-size:12px;margin:0">County assessed values, not market prices.</p></section>
      <section><h2>Buildable check</h2>
        <p class="muted" style="font-size:12px;margin:0">Slope, wetlands, flood zone and owner name from Mireye. $0.02.</p>
        <div id="cEnrichOut"></div>
        <button id="cEnrichBtn" type="button">${c.enrichment ? 'Check again' : 'Check slope, wetlands & flood'} · $0.02</button><p id="cEnrichMsg" class="msg"></p></section>
      <section><h2>Review</h2>
        <select id="cRevStatus">${['new', 'shortlist', 'contacted', 'rejected'].map((s) => `<option ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <textarea id="cRevNotes" placeholder="Notes: site visit, owner contact, broker intel…">${esc(c.notes)}</textarea>
        <button id="cRevSave" class="secondary" type="button">Save review</button><p id="cRevMsg" class="msg"></p></section>`;

    window.paydirtTaper.apply($('detailBody'));
    $('detailBarTitle').textContent = `${siteTitle(c)} · ${c.score}`;
    if (c.enrichment) showKeyFields(c.enrichment.fields, c.keyFields, c.enrichment.created_at);
    $('cEnrichBtn').onclick = async () => {
      $('cEnrichBtn').disabled = true; $('cEnrichMsg').className = 'msg'; $('cEnrichMsg').textContent = 'Checking…';
      try {
        const r = await api(`/api/candidates/${encodeURIComponent(c.pin)}/enrich`, { method: 'POST', body: {} });
        setSpend(r.spentUsd);
        $('cEnrichMsg').textContent = `Match: ${r.status}. Charged $${Number(r.chargedUsd).toFixed(2)}.${r.samePin === false ? ` Warning: matched a different parcel (${esc(r.matchedParcel)}).` : ''}`;
        showKeyFields(r.fields, c.keyFields);
      } catch (e) { $('cEnrichMsg').className = 'msg err'; $('cEnrichMsg').textContent = e.message; }
      finally { $('cEnrichBtn').disabled = false; }
    };
    $('cRevSave').onclick = async () => {
      try {
        await api(`/api/projects/${project.id}/reviews/${encodeURIComponent(c.pin)}`, { method: 'PATCH', body: { status: $('cRevStatus').value, notes: $('cRevNotes').value } });
        $('cRevMsg').className = 'msg'; $('cRevMsg').textContent = 'Saved.';
        const f = cand.features.find((x) => x.properties.pin === c.pin); if (f) f.properties.status = $('cRevStatus').value;
        renderCandList();
      } catch (e) { $('cRevMsg').className = 'msg err'; $('cRevMsg').textContent = e.message; }
    };
  }

  function showKeyFields(fields, keys, when) {
    const val = (k, f) => {
      const v = f && typeof f === 'object' && 'value' in f ? f.value : f;
      if (v == null) return '—';
      if (typeof v !== 'number') return String(v);
      return /frac/.test(k) ? fmt.pct(v) : v.toFixed(1);
    };
    const rows = Object.entries(keys).filter(([k]) => k in (fields ?? {}));
    $('cEnrichOut').innerHTML = rows.length
      ? `${when ? `<p class="muted" style="font-size:12px;margin:0">Checked ${esc(new Date(when).toLocaleDateString())}</p>` : ''}<dl>${rows.map(([k, l]) => `<dt>${esc(l)}</dt><dd>${esc(val(k, fields[k]))}</dd>`).join('')}</dl>`
      : '<p class="muted" style="font-size:12px">No slope or constraint fields came back for this point.</p>';
  }
})();
