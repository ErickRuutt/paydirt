/* Property modal: a parcel's map and details, opened from any list outside the map page.
   paydirtProperty.open(projectId, pin). Fires `paydirt:changed` on document when saved/status/notes change. */
window.paydirtProperty = (() => {
  const { esc, api, where, siteTitle, ac, STATUSES, STATUS_TEXT } = pd;
  const usd = (x) => (x == null ? '—' : `$${Math.round(x).toLocaleString()}`);
  const TAG_TEXT = { 'vacant-land': 'Vacant land', 'operating-business': 'Business operating', 'anchor-tenant': 'Major anchor tenant', 'leased-to-business': 'Leased to a business',
    'company-owned': 'Company-owned', 'closing-tenant': 'Closing tenant', 'possible-empty-building': 'Possible empty building', 'tax-bill-to-business': 'Tax bill paid by a business' };
  const TAG_TONE = { 'vacant-land': 'pass', 'operating-business': 'fail', 'anchor-tenant': 'fail', 'leased-to-business': 'fail', 'closing-tenant': 'review', 'possible-empty-building': 'review' };
  const OWNER_TEXT = { individual: 'Individual', trust: 'Family trust or estate', llc: 'LLC', company: 'Company', government: 'Government' };
  const VERDICT = { permitted: ['pass', 'Permitted'], conditional: ['review', 'Conditional use'], prohibited: ['fail', 'Not allowed'], unknown: ['unknown', 'Unknown'] };

  let dlg, map, current = null;

  function build() {
    dlg = document.createElement('dialog');
    dlg.id = 'propModal';
    dlg.innerHTML = `
      <div class="pmBar">
        <div class="pmTitle"><span id="pmScore"></span><div><h2 id="pmName" class="pmH">&nbsp;</h2><p id="pmMeta" class="lblish"></p></div></div>
        <div class="pmBtns">
          <button type="button" id="pmSave" class="ghost" aria-pressed="true">★ Saved</button>
          <a id="pmFull" class="btn paper" href="map.html">Open in map</a>
          <button type="button" id="pmClose" class="ghost" title="Close (Esc)">Close ✕</button>
        </div>
      </div>
      <div class="pmBody">
        <div class="pmMapWrap"><div id="pmMap"></div>
          <label class="mapctl pmSat"><input type="checkbox" id="pmSat" checked> Satellite</label></div>
        <div id="pmDetail" class="pmDetail"><p class="muted">Loading…</p></div>
      </div>`;
    document.body.append(dlg);
    dlg.querySelector('#pmClose').onclick = () => dlg.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // click the backdrop
    dlg.querySelector('#pmSave').onclick = toggleSave;
    dlg.querySelector('#pmSat').onchange = (e) => map?.getLayer('sat') && map.setLayoutProperty('sat', 'visibility', e.target.checked ? 'visible' : 'none');
  }

  function ensureMap() {
    if (map) return Promise.resolve();
    map = new maplibregl.Map({ container: 'pmMap', style: paydirtBasemapStyle(), center: [-122.05, 47.6], zoom: 9, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');
    return new Promise((resolve) => map.on('load', () => {
      map.addSource('sat', { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
      const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      map.addLayer({ id: 'sat', type: 'raster', source: 'sat' }, firstSymbol);
      map.addSource('parcel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'parcel-fill', type: 'fill', source: 'parcel', paint: { 'fill-color': '#D4AF4E', 'fill-opacity': 0.18 } });
      map.addLayer({ id: 'parcel-line', type: 'line', source: 'parcel', paint: { 'line-color': '#D4AF4E', 'line-width': 3 } });
      resolve();
    }));
  }

  function eachCoord(g, fn) {
    const walk = (c) => (typeof c[0] === 'number' ? fn(c) : c.forEach(walk));
    walk(g.coordinates);
  }

  async function open(projectId, pin) {
    if (!dlg) build();
    current = { projectId, pin, saved: true };
    dlg.querySelector('#pmName').textContent = 'Loading…';
    dlg.querySelector('#pmMeta').textContent = '';
    dlg.querySelector('#pmScore').innerHTML = '';
    dlg.querySelector('#pmDetail').innerHTML = '<p class="muted">Loading…</p>';
    dlg.querySelector('#pmFull').href = `map.html?project=${projectId}&pin=${encodeURIComponent(pin)}`;
    dlg.showModal();
    await ensureMap();
    map.resize();
    let c, criteria;
    try {
      // The project's chips and the catalog, for the "Why it scores" checklist.
      [c, criteria] = await Promise.all([api(`/api/projects/${projectId}/candidates/${encodeURIComponent(pin)}`), api('/api/projects')]);
    } catch (e) { dlg.querySelector('#pmDetail').innerHTML = `<p class="msg err">${esc(e.message)}</p>`; return; }
    if (current?.pin !== pin) return;
    current.saved = Boolean(c.saved);
    paintSave();
    dlg.querySelector('#pmName').textContent = siteTitle(c);
    dlg.querySelector('#pmMeta').textContent = `PIN ${c.pin} · ${ac(c.acres)} · ${where(c)}`;
    dlg.querySelector('#pmScore').innerHTML = c.score != null ? paydirtScore.chip(c.score) : '';
    map.getSource('parcel').setData({ type: 'Feature', geometry: c.geometry, properties: {} });
    const b = new maplibregl.LngLatBounds(); eachCoord(c.geometry, (x) => b.extend(x));
    map.fitBounds(b, { padding: 70, maxZoom: 17, duration: 0 });
    render(c, criteria.projects.find((p) => p.id === Number(projectId)) ?? { chips: [] }, criteria.catalog);
    api(`/api/candidates/${encodeURIComponent(pin)}/profile`).then((r) => { if (current?.pin === pin) renderOwnership(r.ownership); })
      .catch((e) => { const el = document.getElementById('pmOwn'); if (el) el.textContent = e.message; });
  }

  function render(c, project, catalog) {
    const v = VERDICT[c.sports_verdict] ?? VERDICT.unknown;
    const landPerAc = c.land_value && c.acres ? c.land_value / c.acres : null;
    const el = dlg.querySelector('#pmDetail');
    el.innerHTML = `
      <section class="pmReview">
        <label>Status <select id="pmStatus">${STATUSES.map((s) => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${STATUS_TEXT[s]}</option>`).join('')}</select></label>
        <label>Notes <textarea id="pmNotes" rows="3" placeholder="Site visit, owner contact, broker intel…">${esc(c.notes ?? '')}</textarea></label>
        <p id="pmMsg" class="msg"></p>
      </section>
      ${c.hiddenBecause?.length ? `<p class="warn">No longer fits this project: ${c.hiddenBecause.map(esc).join('; ')}. It stays saved until you remove it.</p>` : ''}
      <section><h2>Why it scores ${c.score}</h2>${paydirtCriteria.checklistHtml(project, c, catalog)}</section>
      <section><h2>On this site</h2>
        <div class="tagRow">${(c.tags ?? []).map((t) => `<span class="pill ${TAG_TONE[t] ?? ''}">${esc(TAG_TEXT[t] ?? t)}</span>`).join('') || '<span class="muted">No site tags.</span>'}</div>
        <dl><dt>Owner type</dt><dd>${esc(OWNER_TEXT[c.owner_type] ?? 'Unknown')}</dd><dt>Building value</dt><dd>${c.impr_value != null && c.acres ? `${usd(c.impr_value / c.acres)} per acre` : '—'}</dd></dl>
        ${c.businesses?.length ? `<div class="biz" data-taper="5">${c.businesses.map((b) => `<div class="bizRow"><span><b>${esc(b.label)}</b> <span class="muted">${esc(b.kind ?? '')}</span></span><span class="pill ${b.status === 'closing' ? 'review' : b.status === 'anchor' ? 'fail' : ''}">${b.status === 'anchor' ? 'Anchor' : b.status === 'closing' ? 'Closing' : 'Open'}</span></div>`).join('')}</div>` : ''}
      </section>
      <section><h2>Zoning <span class="pill ${v[0]}">${v[1]}</span></h2>
        <dl><dt>Zone</dt><dd>${esc(c.zoning || '—')}</dd></dl>
        <p class="small" data-taper="3">${esc(c.sports_note ?? '')}</p></section>
      <section><h2>Owner</h2>
        <div data-taper="2">${(c.signals ?? []).map((s) => `<span class="chip">${esc(s)}</span>`).join('') || '<span class="muted">No owner signals.</span>'}</div>
        <dl><dt>Tax bill mailed to</dt><dd>${esc(c.mail_city_state || '—')}</dd></dl>
        <div id="pmOwn" class="muted small">Loading ownership history…</div></section>
      <section><h2>Land</h2><dl>
        <dt>Current use</dt><dd>${esc(c.present_use || '—')}</dd>
        <dt>Land value</dt><dd>${usd(c.land_value)}${landPerAc ? ` (${usd(landPerAc)}/ac)` : ''}</dd>
        <dt>Building value</dt><dd>${usd(c.impr_value)}</dd></dl>
        <p class="muted small">County assessed values, not market prices.</p></section>`;
    window.paydirtTaper?.apply(el);
    const say = (t, err) => { const m = el.querySelector('#pmMsg'); m.className = err ? 'msg err' : 'msg'; m.textContent = t; };
    const patch = async (body, ok) => {
      try { await api(`/api/projects/${current.projectId}/reviews/${encodeURIComponent(current.pin)}`, { method: 'PATCH', body }); say(ok); changed(); }
      catch (e) { say(e.message, true); }
    };
    el.querySelector('#pmStatus').onchange = (e) => patch({ status: e.target.value }, 'Status saved.');
    const notes = el.querySelector('#pmNotes');
    notes.onblur = () => { if (notes.value !== notes.defaultValue) { notes.defaultValue = notes.value; patch({ notes: notes.value }, 'Notes saved.'); } };
  }

  function renderOwnership(o) {
    const el = document.getElementById('pmOwn'); if (!el) return;
    if (!o?.available || !o.records) { el.textContent = 'No recorded sales for this parcel.'; return; }
    const lm = o.lastMarketSale;
    el.className = '';
    el.innerHTML = `<dl><dt>Last transfer</dt><dd>${esc(o.lastTransfer.date)} · ${esc(o.lastTransfer.kind)} (${o.yearsSinceTransfer} yrs ago)</dd>
      <dt>To</dt><dd>${esc(o.lastTransfer.buyer || '—')}</dd>
      <dt>Last market sale</dt><dd>${lm ? `${esc(lm.date)} · ${usd(lm.price)}` : 'None on record'}</dd></dl>`;
  }

  function paintSave() {
    const b = dlg.querySelector('#pmSave');
    b.setAttribute('aria-pressed', String(current.saved));
    b.textContent = current.saved ? '★ Saved' : '☆ Save';
  }
  async function toggleSave() {
    const next = !current.saved;
    try {
      await api(`/api/projects/${current.projectId}/saved/${encodeURIComponent(current.pin)}`, { method: 'PUT', body: { saved: next } });
      current.saved = next; paintSave(); changed();
    } catch (e) { const m = document.getElementById('pmMsg'); if (m) { m.className = 'msg err'; m.textContent = e.message; } }
  }
  let changedTimer;
  const changed = () => { clearTimeout(changedTimer); changedTimer = setTimeout(() => document.dispatchEvent(new CustomEvent('paydirt:changed')), 50); };

  return { open };
})();
