/* global map, api, $, fmt, esc, config, renderProfile, setDrive, setSpend, maplibregl */
// Candidates tab: every 5+ acre King County parcel, scored from free county data.
// Loaded after app.js and reuses its helpers (api, fmt, esc, renderProfile, setDrive).
(() => {
  let cand = { type: 'FeatureCollection', features: [], total: 0 };
  let candSel = null;
  let projects = [], project = null, catalog = null, me = null;
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
    const url = new URLSearchParams(location.search);
    loadProjects(url.get('project') ? Number(url.get('project')) : undefined).then(loadCandidates).then(() => {
      if (url.get('pin')) selectCandidate(url.get('pin'), true);
      const start = url.get('new');
      if (start === 'brief') $('bBrief').click();
      else if (start === 'interview') $('bInterview').click();
    }).catch(showErr);
  });

  // ---------- Data ----------
  let pending = null;
  // The project is the filter; the bar only adds the search text. Passed sites stay off the map.
  async function loadCandidates() {
    const q = new URLSearchParams({ hidePassed: 'true' });
    const area = $('cArea').value.trim(); if (area) q.set('area', area);
    const key = q.toString() + '|' + project.id + '|' + project.spec_version;
    pending = key;
    $('cCount').textContent = '(loading…)';
    const r = await api(`/api/projects/${project.id}/candidates?` + q);
    if (pending !== key) return; // a newer request won
    cand = r;
    map.getSource('cand')?.setData(cand);
    renderCandList();
  }
  let t = null;
  $('cArea').oninput = () => { clearTimeout(t); t = setTimeout(() => loadCandidates().catch(showErr), 300); };
  $('candForm').onsubmit = (e) => { e.preventDefault(); clearTimeout(t); loadCandidates().catch(showErr); };
  const showErr = (e) => { $('cCount').textContent = ''; $('cList').innerHTML = `<li class="msg err">${esc(e.message)}</li>`; };

  function renderCandList() {
    const shown = cand.features.slice(0, 150);
    $('cCount').textContent = `· ${cand.total.toLocaleString()} fit${cand.total > shown.length ? `, best ${shown.length} shown` : ''}`;
    $('cList').innerHTML = shown.map(({ properties: p }) => `
      <li data-pin="${esc(p.pin)}" class="row ${p.pin === candSel ? 'sel' : ''}">
        ${scoreChip(p.score)}
        <div class="rowMain">
          <span class="t">${esc(siteTitle(p))}</span>
          <span class="m">${fmt.ac(p.acres)} · ${esc(p.zoning || 'No zone')} · ${esc(where(p))}</span>
          <span class="facts">${rowFacts(p)}</span>
        </div>
        <button type="button" class="rowStar" data-star="${esc(p.pin)}" aria-pressed="${p.saved ? 'true' : 'false'}" title="${p.saved ? 'Saved to this project' : 'Save to this project'}" aria-label="${p.saved ? 'Unsave' : 'Save'} ${esc(siteTitle(p))}">${p.saved ? '★' : '☆'}</button>
      </li>`).join('') || '<li class="muted">No sites match this project.</li>';
    window.paydirtTaper.apply($('cList'));
  }
  $('cList').onclick = (e) => {
    const star = e.target.closest('[data-star]');
    if (star) { e.stopPropagation(); toggleSave(star.dataset.star); return; }
    const li = e.target.closest('li[data-pin]'); if (li) selectCandidate(li.dataset.pin, true);
  };

  // ---------- Saving (bookmarks) ----------
  async function toggleSave(pin) {
    const f = cand.features.find((x) => x.properties.pin === pin);
    const next = !(f?.properties.saved ?? (candSel === pin && $('saveDetail').getAttribute('aria-pressed') === 'true'));
    try {
      const r = await api(`/api/projects/${project.id}/saved/${encodeURIComponent(pin)}`, { method: 'PUT', body: { saved: next } });
      if (f) f.properties.saved = r.saved;
      renderCandList();
      if (candSel === pin) paintSaveButton(r.saved);
    } catch (e) { showErr(e); }
  }
  function paintSaveButton(saved) {
    const b = $('saveDetail'); b.hidden = false;
    b.setAttribute('aria-pressed', String(saved)); b.textContent = saved ? '★ Saved' : '☆ Save';
    b.title = saved ? 'Saved to this project. Click to remove.' : 'Save to this project';
  }
  $('saveDetail').onclick = () => { if (candSel) toggleSave(candSel); };

  // ---------- Projects ----------
  async function loadProjects(selectId) {
    const r = await api('/api/projects');
    projects = r.projects; catalog = r.catalog;
    if (!me) me = await api('/api/me').catch(() => null);
    const want = Number(selectId ?? store.get('paydirt.project'));
    project = projects.find((p) => p.id === want) ?? projects[0];
    if (!project) throw new Error('No projects yet.');
    $('cProject').innerHTML = projects.map((p) => `<option value="${p.id}" ${p.id === project.id ? 'selected' : ''}>${esc(p.name)}${p.shortlisted ? ` (${p.shortlisted} shortlisted)` : ''}</option>`).join('');
    applyProject();
  }

  function applyProject() {
    store.set('paydirt.project', String(project.id));
    $('projTitle').textContent = project.name;
    for (const [n, h] of [['navMap', `map.html?project=${project.id}`], ['navSaved', `project.html?id=${project.id}`]]) { const a = document.getElementById(n); if (a) a.href = h; }
    renderBar();
    loadHistory();
  }

  async function loadHistory() {
    const id = project.id;
    try {
      const r = await api(`/api/projects/${id}`);
      if (project.id === id) adopt(r);
    } catch { /* Undo and History stay unavailable until the next save */ }
  }

  // ---------- Criteria bar ----------
  const Criteria = window.paydirtCriteria;
  // Take a project as the server returned it (after a save, a refused save, or a reload).
  function adopt(p) {
    project = { ...project, ...p };
    projects = projects.map((x) => (x.id === project.id ? project : x));
    renderBar();
  }
  const chipButton = (key) => $('critChips').querySelector(`[data-chip="${key}"]`) ?? $('critChips').querySelector('[data-add]');

  function renderBar() {
    Criteria.render($('critChips'), project, catalog, { onChip: openEditor, onAdd: openEditor });
    $('critVer').textContent = `v${project.spec_version}`;
    const h = project.history ?? [];
    const mine = h[0] && me && h[0].changed_by === me.user_uid;
    $('critUndo').disabled = !(h.length > 1 && mine);
    $('critUndo').title = h.length < 2 ? 'Nothing to undo yet' : mine ? `Go back to version ${h[1].version}` : 'Last change was made by a teammate';
    $('critHist').disabled = !h.length;
  }

  function afterSave(p) {
    adopt(p);
    window.clearCandidate(); $('detail').hidden = true;
    loadCandidates().catch(showErr);
  }
  // Someone else saved first: show their version; the list follows it.
  const conflicted = (p) => afterSave(p);

  function openEditor(key, btn) {
    Criteria.edit({ project, catalog, key, nowCount: () => ($('cArea').value.trim() ? null : cand.total), returnFocus: () => chipButton(key) ?? btn, onSaved: afterSave, onConflict: conflicted });
  }

  $('critUndo').onclick = async () => {
    const h = project.history ?? [];
    if (h.length < 2) return;
    $('critUndo').disabled = true;
    try { afterSave(await Criteria.restore(project, typeof h[1].spec === 'string' ? JSON.parse(h[1].spec) : h[1].spec)); }
    catch (e) {
      if (e.status === 409 && e.body?.project) { conflicted(e.body.project); $('critUndo').title = "Changed by a teammate — here's the current version"; }
      else { showErr(e); renderBar(); }
    }
  };
  $('critHist').onclick = () => Criteria.history({ project, me, catalog, returnFocus: () => $('critHist'), onSaved: afterSave, onConflict: conflicted });

  // The bar wraps onto more rows when the chips don't fit; keep the map and list below it.
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--mapbar', `${$('critBar').offsetHeight}px`);
    map.resize();
  }).observe($('critBar'));

  $('cProject').onchange = () => {
    project = projects.find((p) => p.id === Number($('cProject').value)) ?? project;
    window.clearCandidate(); $('detail').hidden = true;
    applyProject();
    loadCandidates().catch(showErr);
  };

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
    $('saveDetail').hidden = true;
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
      <section><h2>Why it scores ${c.score}</h2><div class="bars">${c.subscores.map((s) => bar(esc(s.label), s.value)).join('')}</div>
        <p class="muted" style="font-size:12px;margin:0">Each line is how well it meets one thing ${esc(project.name)} wants (100 = fully).</p></section>
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
    paintSaveButton(Boolean(c.saved));
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
