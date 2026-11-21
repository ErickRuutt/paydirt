/* global map, api, $, fmt, esc, config, renderProfile, setDrive, setSpend, maplibregl */
// Candidates tab: every 5+ acre King County parcel, scored from free county data.
// Loaded after app.js and reuses its helpers (api, fmt, esc, renderProfile, setDrive).
(() => {
  let cand = { type: 'FeatureCollection', features: [], total: 0 };
  let candSel = null;
  let profiles = [], profile = null;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
  const VERDICT_LABEL = { permitted: 'Permitted', conditional: 'Conditional use', prohibited: 'Not allowed', unknown: 'Unknown' };
  const VERDICT_PILL = { permitted: 'pass', conditional: 'review', prohibited: 'fail', unknown: 'unknown' };
  const scoreColor = (s) => (s >= 75 ? '#1f5c45' : s >= 60 ? '#2e8b57' : s >= 45 ? '#c99a1b' : '#a59f8f');
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
    map.addLayer({ id: 'cand-sel-fill', type: 'fill', source: 'cand-sel', paint: { 'fill-color': '#1f5c45', 'fill-opacity': 0.25 } }, before);
    map.addLayer({ id: 'cand-sel-line', type: 'line', source: 'cand-sel', paint: { 'line-color': '#1f5c45', 'line-width': 3 } }, before);
    map.addLayer({
      id: 'cand-pt', type: 'circle', source: 'cand',
      paint: {
        'circle-color': ['step', ['get', 'score'], '#a59f8f', 45, '#c99a1b', 60, '#2e8b57', 75, '#1f5c45'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, ['case', ['boolean', ['feature-state', 'sel'], false], 7, 3], 13, ['case', ['boolean', ['feature-state', 'sel'], false], 11, 7]],
        'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 13, 1.5],
        'circle-opacity': 0.9,
      },
    });
    map.on('click', 'cand-pt', (e) => selectCandidate(e.features[0].properties.pin, false));
    map.on('mouseenter', 'cand-pt', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'cand-pt', () => { map.getCanvas().style.cursor = ''; });
    loadProfiles().then(loadCandidates).catch(showErr);
  });

  // ---------- Data ----------
  let pending = null;
  async function loadCandidates() {
    const q = new URLSearchParams();
    const set = (k, v) => { if (v !== '' && v != null) q.set(k, v); };
    set('minAcres', $('cMinAc').value); set('maxAcres', $('cMaxAc').value);
    set('verdict', $('cVerdict').value); set('minScore', +$('cMinScore').value || '');
    set('area', $('cArea').value.trim()); set('signal', $('cSignal').value); set('status', $('cStatus').value);
    if (profile?.id) set('profile', profile.id);
    const key = q.toString();
    pending = key;
    $('cCount').textContent = '(loading…)';
    const r = await api('/api/candidates?' + key);
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
      <li data-pin="${esc(p.pin)}" class="${p.pin === candSel ? 'sel' : ''}">
        <span class="t">${esc(p.address || 'No site address')} <span class="muted" style="font-weight:400">· ${esc(where(p))}</span></span>
        <span class="score" style="background:${scoreColor(p.score)}">${p.score}</span>
        <span class="m">${fmt.ac(p.acres)} · ${esc(p.zoning || 'no zone')} (${esc(VERDICT_LABEL[p.sports_verdict] ?? p.sports_verdict)})${p.years_held != null ? ` · held ${Math.floor(p.years_held)}y` : ''}${p.hh200k_10mi != null ? ` · ${Math.round(p.hh200k_10mi / 1000)}k $200k+ hh in 10 mi` : ''}${p.status !== 'new' ? ` · <b>${esc(p.status)}</b>` : ''}</span>
        ${p.signals.slice(0, 3).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}
      </li>`).join('') || '<li class="muted">No candidates match these filters.</li>';
  }
  $('cList').onclick = (e) => { const li = e.target.closest('li[data-pin]'); if (li) selectCandidate(li.dataset.pin, true); };

  // ---------- Profiles ----------
  const weightText = (w) => { const t = (w.fit + w.owner + w.market) || 1; return `${Math.round(w.fit / t * 100)}% fit, ${Math.round(w.owner / t * 100)}% owner, ${Math.round(w.market / t * 100)}% market`; };

  async function loadProfiles(selectId) {
    const r = await api('/api/profiles');
    profiles = r.profiles;
    const want = Number(selectId ?? store.get('paydirt.profile'));
    profile = profiles.find((p) => p.id === want) ?? profiles[0] ?? { id: null, name: 'Default', config: r.defaults };
    $('cProfile').innerHTML = profiles.map((p) => `<option value="${p.id}" ${p.id === profile.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    applyProfile();
  }

  function applyProfile() {
    const c = profile.config;
    store.set('paydirt.profile', String(profile.id ?? ''));
    $('cMinAc').value = c.acres.min; $('cMaxAc').value = c.acres.max;
    $('pName').value = profile.name; $('pMinAc').value = c.acres.min; $('pMaxAc').value = c.acres.max;
    $('pWFit').value = c.weights.fit; $('pWOwner').value = c.weights.owner; $('pWMarket').value = c.weights.market;
    $('pTarget').value = c.market.target; $('pMaxHide').value = c.maxAcres; $('pHideZoning').checked = c.hideProhibitedZoning;
    $('pMsg').textContent = '';
  }

  $('cProfile').onchange = () => {
    profile = profiles.find((p) => p.id === Number($('cProfile').value)) ?? profile;
    applyProfile();
    loadCandidates().catch(showErr);
  };

  function editedConfig() {
    const c = structuredClone(profile.config);
    c.acres = { min: +$('pMinAc').value, max: +$('pMaxAc').value };
    c.weights = { fit: +$('pWFit').value, owner: +$('pWOwner').value, market: +$('pWMarket').value };
    c.market = { ...c.market, target: +$('pTarget').value };
    c.maxAcres = +$('pMaxHide').value;
    c.hideProhibitedZoning = $('pHideZoning').checked;
    return c;
  }

  async function saveProfile(asNew) {
    const name = $('pName').value.trim() || 'Untitled profile';
    const body = { id: asNew ? null : profile.id, name: asNew && name === profile.name ? `${name} (copy)` : name, config: editedConfig() };
    try {
      const saved = await api('/api/profiles', { method: 'POST', body });
      await loadProfiles(saved.id);
      $('pMsg').className = 'msg'; $('pMsg').textContent = asNew ? 'Saved as a new profile.' : 'Saved. List re-ranked.';
      await loadCandidates();
    } catch (e) { $('pMsg').className = 'msg err'; $('pMsg').textContent = e.message; }
  }
  $('profForm').onsubmit = (e) => { e.preventDefault(); saveProfile(false); };
  $('pSaveNew').onclick = () => saveProfile(true);

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
    const c = await api(`/api/candidates/${encodeURIComponent(pin)}${profile?.id ? `?profile=${profile.id}` : ''}`);
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

  const bar = (label, v) => `<span>${label}</span><span class="bar"><i style="width:${v}%"></i></span><span>${v}</span>`;

  function renderCandidate(c) {
    const landPerAc = c.land_value && c.acres ? c.land_value / c.acres : null;
    $('detailBody').innerHTML = `
      <h3>${esc(c.address || 'No site address')}</h3>
      <p class="muted">PIN ${esc(c.pin)} · ${fmt.ac(c.acres)} · ${esc(where(c))} <span class="score" style="background:${scoreColor(c.score)}">${c.score}</span></p>
      ${c.excluded ? `<p class="warn">Hidden by default: ${esc(c.excluded)}</p>` : ''}
      <section><h2>Score</h2><div class="bars">${bar('Fit', c.fit_score)}${bar('Owner', c.owner_score)}${bar('Market', c.market_score)}</div>
        <p class="muted" style="font-size:12px;margin:0">Fit = zoning, size, how built-up. Owner = signs they might sell. Market = $200k+ households within 10 miles (${Math.round(c.marketTarget / 1000)}k or more = 100). Weights from <b>${esc(profile?.name ?? 'profile')}</b>: ${weightText(c.weights)}.</p></section>
      <section><h2>Zoning for a sports club <span class="pill ${VERDICT_PILL[c.sports_verdict]}">${esc(VERDICT_LABEL[c.sports_verdict])}</span></h2>
        <dl><dt>Zone</dt><dd>${esc(c.zoning || '—')}</dd></dl>
        <p style="margin:0;font-size:13px">${esc(c.sports_note)}</p>
        ${c.zoning_source ? `<p class="muted" style="font-size:12px;margin:0">Source: <a href="${esc(c.zoning_source)}" target="_blank" rel="noopener">${c.city ? esc(where(c)) + ' use table' : 'King County Code Title 21A (updated Sep 9, 2026)'}</a>, read Nov 2026. Confirm with the ${c.city ? 'city' : 'county'} before relying on it.</p>` : ''}</section>
      <section><h2>Owner signals</h2>
        <div>${c.signals.map((s) => `<span class="chip">${esc(s)}</span>`).join('') || '<span class="muted">None found.</span>'}</div>
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
        await api(`/api/candidates/${encodeURIComponent(c.pin)}`, { method: 'PATCH', body: { status: $('cRevStatus').value, notes: $('cRevNotes').value } });
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
