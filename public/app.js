/* global maplibregl */
const $ = (id) => document.getElementById(id);
const fmt = {
  ac: (x) => (x == null ? '—' : `${x.toFixed(1)} ac`),
  pct: (x) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`),
  grade: (x) => (x == null ? '—' : `${x.toFixed(1)}%`),
  usd: (x) => (x == null ? '—' : `$${Math.round(x).toLocaleString()}`),
  m: (x) => (x == null ? '—' : `${Math.round(x)} m`),
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const USE_LABELS = { lit_fields: 'Lit outdoor fields', sports_club: 'Sports club / indoor rec', restaurant: 'Restaurant', office: 'Coworking / office' };

let config, data = { type: 'FeatureCollection', features: [] }, selectedId = null, nextCursor = null;
let detailFor = null; // id of whatever the detail panel shows (searched parcel or candidate)

async function api(path, opts = {}) {
  const token = await window.paydirtAuth.token(); // waits until someone is signed in
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

// ---------- Map ----------
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [-122.05, 47.6],
  zoom: 9,
  maxPitch: 75,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');

map.on('load', () => {
  map.addSource('satellite', {
    type: 'raster', tileSize: 256, maxzoom: 19,
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  });
  map.addSource('dem', {
    type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    attribution: 'Elevation: Mapzen Terrain Tiles (USGS 3DEP, SRTM)',
  });
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } }, firstSymbol);
  map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#3b4a42' } }, firstSymbol);

  map.addSource('blockgroups', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'bg-fill', type: 'fill', source: 'blockgroups', layout: { visibility: 'none' },
    paint: { 'fill-color': ['case', ['==', ['get', 'share200k'], null], 'rgba(0,0,0,0)',
      ['interpolate', ['linear'], ['get', 'share200k'], 0, '#f1eef6', 0.25, '#9e9ac8', 0.5, '#3f007d']], 'fill-opacity': 0.55 } }, firstSymbol);
  map.addLayer({ id: 'bg-line', type: 'line', source: 'blockgroups', layout: { visibility: 'none' },
    paint: { 'line-color': '#6a51a3', 'line-width': 0.4, 'line-opacity': 0.5 } }, firstSymbol);
  map.on('click', 'bg-fill', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: ['parcel-fill', 'parcel-pt'] }).length) return;
    const p = e.features[0].properties;
    const html = p.hasData === true || p.hasData === 'true'
      ? `<strong>Block group ${esc(p.geoid)}</strong><br>${fmt.pct(Number(p.share200k))} of ${Number(p.households).toLocaleString()} households earn $200k+<br>Median income ${fmt.usd(Number(p.medianIncome))}<br>${fmt.pct(Number(p.shareWithKids))} households with kids`
      : `<strong>Block group ${esc(p.geoid)}</strong><br>No income data loaded yet.`;
    new maplibregl.Popup({ closeButton: true }).setLngLat(e.lngLat).setHTML(html).addTo(map);
  });

  map.addSource('drive', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // Mapbox returns the largest contour first; draw outer (30 min) lighter, inner (20 min) stronger.
  const driveColor = ['case', ['<=', ['get', 'contour'], 20], '#1f5c45', '#3f7f9f'];
  map.addLayer({ id: 'drive-fill', type: 'fill', source: 'drive', paint: { 'fill-color': driveColor, 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'drive-line', type: 'line', source: 'drive', paint: { 'line-color': driveColor, 'line-width': 2, 'line-dasharray': [2, 1] } });

  map.addSource('parcels', { type: 'geojson', data, promoteId: 'parcelnumb' });
  const color = ['match', ['get', 'screen'], 'pass', '#2e8b57', 'fail', '#b4492a', '#c99a1b'];
  map.addLayer({ id: 'parcel-fill', type: 'fill', source: 'parcels', filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': color, 'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.55, ['boolean', ['feature-state', 'hover'], false], 0.45, 0.3] } });
  map.addLayer({ id: 'parcel-line', type: 'line', source: 'parcels', filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'line-color': color, 'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 1.5] } });
  map.addLayer({ id: 'parcel-pt', type: 'circle', source: 'parcels', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-color': color, 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });

  let hoverId = null;
  for (const layer of ['parcel-fill', 'parcel-pt']) {
    map.on('mousemove', layer, (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const id = e.features[0].id;
      if (hoverId !== null && hoverId !== id) map.setFeatureState({ source: 'parcels', id: hoverId }, { hover: false });
      hoverId = id; map.setFeatureState({ source: 'parcels', id }, { hover: true });
    });
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = '';
      if (hoverId !== null) map.setFeatureState({ source: 'parcels', id: hoverId }, { hover: false });
      hoverId = null;
    });
    map.on('click', layer, (e) => select(e.features[0].id, false));
  }
  loadParcels(false); // no auto-zoom on load: Candidates is the main view
});

$('lySat').onchange = (e) => map.setLayoutProperty('satellite', 'visibility', e.target.checked ? 'visible' : 'none');
$('lyHill').onchange = (e) => map.setLayoutProperty('hillshade', 'visibility', e.target.checked ? 'visible' : 'none');
let bgLoaded = false;
$('lyAff').onchange = async (e) => {
  const on = e.target.checked;
  if (!map.getSource('blockgroups')) { e.target.checked = false; return; } // map style still loading
  if (on && !bgLoaded) { map.getSource('blockgroups').setData(await api('/api/block-groups')); bgLoaded = true; }
  for (const id of ['bg-fill', 'bg-line']) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  $('affLegend').hidden = !on || !config.hasDemographics;
  $('affMissing').hidden = !on || config.hasDemographics;
};
$('ly3d').onchange = (e) => {
  if (e.target.checked) { map.setTerrain({ source: 'dem', exaggeration: 1.5 }); map.easeTo({ pitch: 60 }); }
  else { map.setTerrain(null); map.easeTo({ pitch: 0 }); }
};

// ---------- Data ----------
async function loadConfig() {
  config = await api('/api/config');
  const s = config.criteria.search;
  $('acresMin').value = s.acresMin; $('acresMax').value = s.acresMax;
  $('minDev').value = s.minDevelopableAcres; $('maxWet').value = s.maxWetlandFraction;
  $('county').textContent = `${config.criteria.county.name} County, ${config.criteria.county.state2}`;
  $('keyWarn').hidden = config.hasKey;
  setSpend(config.spentUsd);
}
const setSpend = (s) => { $('spend').textContent = `$${Number(s).toFixed(2)} of $${config.maxSpendUsd.toFixed(2)} spent`; };

async function loadParcels(fit) {
  data = await api('/api/parcels');
  map.getSource('parcels')?.setData(data);
  renderList();
  if (fit && data.features.length) {
    const b = new maplibregl.LngLatBounds();
    for (const f of data.features) eachCoord(f.geometry, (c) => b.extend(c));
    map.fitBounds(b, { padding: 60, maxZoom: 14 });
  }
}
function eachCoord(g, fn) {
  if (g.type === 'Point') fn(g.coordinates);
  else if (g.type === 'Polygon') g.coordinates[0].forEach(fn);
  else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => p[0].forEach(fn));
}

function renderList() {
  const filter = $('filter').value;
  const items = data.features.filter((f) => filter === 'all' || (filter === 'shortlist' ? f.properties.status === 'shortlist' : f.properties.screen === filter));
  $('count').textContent = `(${items.length} of ${data.features.length})`;
  $('empty').hidden = data.features.length > 0;
  $('list').innerHTML = items.map((f) => {
    const p = f.properties;
    return `<li data-id="${esc(p.parcelnumb)}" class="${p.parcelnumb === selectedId ? 'sel' : ''}">
      <span class="t">${esc(p.address || p.parcelnumb)}</span><span class="pill ${p.screen}">${p.screen}</span>
      <span class="m">${fmt.ac(p.acres)} · ${esc(p.zoning || 'no zone')} · ${esc(p.jurisdiction)}${p.status !== 'new' ? ' · ' + esc(p.status) : ''}${p.yearsSinceMarketSale != null ? ` · held ${Math.floor(p.yearsSinceMarketSale)}y` : ''}${p.hh200kNearby != null ? ` · ${p.hh200kNearby.toLocaleString()} $200k+ hh in ${config?.criteria.reachHeadlineMiles ?? 10} mi` : ''}</span>
      ${(p.ownerSignals ?? []).filter((s) => /inherit|held|no market|family/.test(s)).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</li>`;
  }).join('');
}
$('list').onclick = (e) => { const li = e.target.closest('li'); if (li) select(li.dataset.id, true); };
$('filter').onchange = renderList;

// ---------- Search ----------
async function runSearch(cursor) {
  const btn = cursor ? $('moreBtn') : $('searchBtn');
  btn.disabled = true; $('searchMsg').className = 'msg'; $('searchMsg').textContent = 'Searching Mireye… this can take a minute.';
  try {
    const r = await api('/api/search', { method: 'POST', body: {
      acresMin: +$('acresMin').value, acresMax: +$('acresMax').value,
      minDevelopableAcres: +$('minDev').value || null, maxWetlandFraction: $('maxWet').value === '' ? null : +$('maxWet').value,
      city: $('city').value.trim() || null, limit: +$('limit').value || 10, cursor,
    } });
    nextCursor = r.nextCursor; $('moreBtn').hidden = !nextCursor;
    const remarks = r.remarks?.length ? ` Notes: ${r.remarks.map((x) => x.code).join(', ')}.` : '';
    $('searchMsg').textContent = `Found ${r.found}, stored ${r.stored}. Charged $${Number(r.chargedUsd).toFixed(2)}.${remarks}`;
    setSpend(r.spentUsd);
    await loadParcels(true);
  } catch (err) {
    $('searchMsg').className = 'msg err'; $('searchMsg').textContent = err.message;
  } finally { btn.disabled = false; }
}
$('searchForm').onsubmit = (e) => { e.preventDefault(); nextCursor = null; runSearch(); };
$('moreBtn').onclick = () => runSearch(nextCursor);

// ---------- Detail ----------
function select(id, fly) {
  if (selectedId) map.setFeatureState({ source: 'parcels', id: selectedId }, { selected: false });
  selectedId = id; detailFor = id;
  window.clearCandidate?.();
  map.setFeatureState({ source: 'parcels', id }, { selected: true });
  const f = data.features.find((x) => x.properties.parcelnumb === id);
  if (!f) return;
  if (fly) {
    const b = new maplibregl.LngLatBounds(); eachCoord(f.geometry, (c) => b.extend(c));
    map.fitBounds(b, { padding: { top: 80, bottom: 80, left: 80, right: 420 }, maxZoom: 16 });
  }
  setDrive(null);
  renderDetail(f.properties);
  renderList();
}

const CHECK_LABELS = { slope: 'Median slope', steepShare: 'Share over 5% grade', flood: 'Flood zone share', wetland: 'Wetland share', developable: 'Developable acres' };

function renderDetail(p) {
  const checks = typeof p.checks === 'string' ? JSON.parse(p.checks) : p.checks;
  const zby = typeof p.zoningByUse === 'string' ? JSON.parse(p.zoningByUse) : p.zoningByUse;
  const values = { slope: fmt.grade(p.slope_p50), steepShare: fmt.pct(p.slope_frac_over_5), flood: fmt.pct(p.flood_fraction), wetland: fmt.pct(p.wetland_fraction), developable: fmt.ac(p.developable_acres) };
  $('detailBody').innerHTML = `
    <h3>${esc(p.address || 'No situs address')}</h3>
    <p class="muted">APN ${esc(p.parcelnumb)} · ${fmt.ac(p.acres)} · ${esc(p.jurisdiction)} <span class="pill ${p.screen}">${p.screen}</span></p>
    ${p.hasBoundary ? '' : '<p class="warn">No boundary returned; showing the parcel point.</p>'}
    <section><h2>Screen</h2><dl>${Object.entries(CHECK_LABELS).map(([k, l]) => `<dt>${l}</dt><dd>${values[k]} <span class="pill ${checks[k] === 'pass' ? 'pass' : checks[k] === 'fail' ? 'fail' : 'review'}">${checks[k]}</span></dd>`).join('')}
      <dt>90th pct slope</dt><dd>${fmt.grade(p.slope_p90)}</dd>
      <dt>Elevation range</dt><dd>${fmt.m(p.elev_low)} – ${fmt.m(p.elev_high)}</dd></dl>
      <p class="muted" style="font-size:12px;margin:0">Slope is from a 30 m USGS 3DEP lattice: a screen, not a survey.</p></section>
    <section><h2>Zoning <span class="pill ${p.zoningOverall}">${p.zoningOverall}</span></h2>
      <dl><dt>Zone</dt><dd>${esc(p.zoning || '—')} ${p.zoning_type ? '(' + esc(p.zoning_type) + ')' : ''}</dd>
      <dt>Description</dt><dd>${esc(p.zoning_description || '—')}</dd>
      <dt>Current use</dt><dd>${esc(p.use_desc || '—')}</dd>
      <dt>Code</dt><dd>${p.zoning_code_link ? `<a href="${esc(p.zoning_code_link)}" target="_blank" rel="noopener">Open zoning code</a>` : '—'}</dd></dl>
      ${p.zoning ? `<p class="muted" style="font-size:12px;margin:0">Record what the ${esc(p.jurisdiction)} code allows in zone ${esc(p.zoning)}. Applies to every parcel with this zone.</p>
      ${config.criteria.uses.map((u) => `<div class="zrow"><span>${USE_LABELS[u] ?? u}</span>
        <select data-use="${u}">${['unknown', 'permitted', 'conditional', 'prohibited'].map((v) => `<option ${zby[u] === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`).join('')}` : ''}
    </section>
    <section><h2>Ownership history</h2><div id="ownOut" class="muted">Loading…</div></section>
    <section><h2>Who's nearby</h2><div id="reachOut" class="muted">Loading…</div></section>
    <section><h2>Owner &amp; value</h2><dl>
      <dt>Owner</dt><dd>${esc(p.owner || '—')}</dd><dt>Mailing</dt><dd>${esc(p.mail_address || '—')}</dd>
      <dt>Land value</dt><dd>${fmt.usd(p.land_value)}${p.land_value && p.acres ? ` (${fmt.usd(p.land_value / p.acres)}/ac)` : ''}</dd>
      <dt>Total value</dt><dd>${fmt.usd(p.parcel_value)}</dd>
      <dt>Last sale</dt><dd>${fmt.usd(p.sale_price)} ${esc(p.sale_date || '')}</dd>
      <dt>Last transfer</dt><dd>${esc(p.last_transfer_date || '—')}</dd></dl></section>
    <section><h2>Review</h2>
      <select id="status">${['new', 'shortlist', 'rejected', 'contacted'].map((s) => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <textarea id="notes" placeholder="Notes: site visit, owner contact, broker intel…">${esc(p.notes)}</textarea>
      <button id="saveReview" class="secondary" type="button">Save review</button></section>
    <section><h2>Enrich</h2>
      <p class="muted" style="font-size:12px;margin:0">Full Mireye profile for this parcel (zoning, terrain, constraints presets). $0.02 if matched.</p>
      <button id="enrichBtn" type="button">Enrich · $0.02</button><p id="enrichMsg" class="msg"></p><div id="enrichOut"></div></section>`;
  $('detail').hidden = false;

  $('detailBody').querySelectorAll('select[data-use]').forEach((sel) => {
    sel.onchange = async () => {
      await api('/api/zoning-rules', { method: 'PUT', body: { jurisdiction: p.jurisdiction, zone: p.zoning, use: sel.dataset.use, verdict: sel.value, source_url: p.zoning_code_link } });
      await loadParcels(false); select(p.parcelnumb, false);
    };
  });
  $('saveReview').onclick = async () => {
    await api(`/api/parcels/${encodeURIComponent(p.parcelnumb)}`, { method: 'PATCH', body: { status: $('status').value, notes: $('notes').value } });
    await loadParcels(false); select(p.parcelnumb, false);
  };
  $('enrichBtn').onclick = async () => {
    $('enrichBtn').disabled = true; $('enrichMsg').className = 'msg'; $('enrichMsg').textContent = 'Enriching…';
    try {
      const r = await api(`/api/parcels/${encodeURIComponent(p.parcelnumb)}/enrich`, { method: 'POST', body: {} });
      setSpend(r.spentUsd);
      const mismatch = r.sameParcel === false ? ` Warning: matched a different parcel (${esc(r.matchedParcel)}).` : '';
      $('enrichMsg').textContent = `Match: ${r.status}. Charged $${Number(r.chargedUsd).toFixed(2)}.${mismatch}`;
      showFields(r.fields);
    } catch (err) { $('enrichMsg').className = 'msg err'; $('enrichMsg').textContent = err.message; }
    finally { $('enrichBtn').disabled = false; }
  };
  api(`/api/parcels/${encodeURIComponent(p.parcelnumb)}/enrichments`).then((rows) => { if (rows[0]) showFields(rows[0].fields, rows[0].created_at); });
  api(`/api/parcels/${encodeURIComponent(p.parcelnumb)}/profile`).then((r) => renderProfile(r, p.parcelnumb)).catch((e) => { $('ownOut').textContent = e.message; });
}

function setDrive(fc) {
  map.getSource('drive')?.setData(fc ?? { type: 'FeatureCollection', features: [] });
  $('driveLegend').hidden = !fc;
}

const reachRow = (label, x) => `<tr><td>${label}</td><td class="n">${x.households.toLocaleString()}</td><td class="n">${x.hh200k.toLocaleString()} (${fmt.pct(x.share200k)})</td><td class="n">${fmt.pct(x.shareWithKids)}</td><td class="n">${fmt.usd(x.medianIncomeApprox)}</td></tr>`;

function renderProfile({ ownership: o, reach, drive, isochrones, driveError }, forId) {
  if (forId !== detailFor) return;
  setDrive(isochrones);
  if (!o.available) $('ownOut').textContent = 'Sales history not imported. Run node scripts/import-sales.js.';
  else if (!o.records) $('ownOut').innerHTML = `No recorded sales for this parcel number.${o.signals?.length ? ` <span class="chip">${esc(o.signals[0])}</span>` : ''}`;
  else {
    const lm = o.lastMarketSale;
    $('ownOut').className = '';
    $('ownOut').innerHTML = `<dl>
        <dt>Last transfer</dt><dd>${esc(o.lastTransfer.date)} · ${esc(o.lastTransfer.kind)} (${o.yearsSinceTransfer} yrs ago)</dd>
        <dt>To</dt><dd>${esc(o.lastTransfer.buyer || '—')}</dd>
        <dt>Last market sale</dt><dd>${lm ? `${esc(lm.date)} · ${fmt.usd(lm.price)} (${o.yearsSinceMarketSale} yrs ago)` : 'None on record'}</dd></dl>
      <div>${o.signals.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>
      <details><summary class="muted" style="font-size:12px;cursor:pointer">All ${o.records} recorded transfers</summary>
      <table class="hist"><tr><th>Date</th><th>Type</th><th class="n">Price</th><th>Buyer</th></tr>
      ${o.history.map((h) => `<tr><td>${esc(h.date)}</td><td title="${esc(h.instrument)} · ${esc(h.reason)}">${esc(h.kind)}</td><td class="n">${h.price ? fmt.usd(h.price) : '—'}</td><td>${esc(h.buyer)}</td></tr>`).join('')}
      </table></details>
      <p class="muted" style="font-size:12px;margin:4px 0 0">King County Assessor sales records.</p>`;
  }

  const driveNote = driveError ? `<p class="msg err" style="font-size:12px">Drive time unavailable: ${esc(driveError)}</p>`
    : !config.hasMapbox ? '<p class="muted" style="font-size:12px;margin:4px 0 0">Add MAPBOX_TOKEN to .env for drive-time areas.</p>' : '';
  if (!reach) {
    $('reachOut').innerHTML = `${esc(config.hasDemographics ? 'Parcel has no coordinates.' : 'Census income data not loaded. Add CENSUS_API_KEY to .env and run node scripts/import-census.js.')}
      ${isochrones ? `<p style="font-size:12px;margin:4px 0 0">Drive-time areas (${config.criteria.driveMinutes.join(' and ')} min) are on the map.</p>` : ''}${driveNote}`;
    return;
  }
  $('reachOut').className = '';
  $('reachOut').innerHTML = `<table class="hist"><tr><th>Within</th><th class="n">Households</th><th class="n">$200k+</th><th class="n">With kids</th><th class="n">Income*</th></tr>
    ${drive ? Object.entries(drive).map(([m, x]) => reachRow(`${m} min drive`, x)).join('') : ''}
    ${Object.entries(reach).map(([r, x]) => reachRow(`${r} mi`, x)).join('')}
    </table><p class="muted" style="font-size:12px;margin:4px 0 0">Census block groups (ACS 5-year) counted by interior point. Drive time is Mapbox typical traffic; miles are straight-line. *Household-weighted average of block-group medians.</p>${driveNote}`;
}

function showFields(fields, when) {
  const entries = Object.entries(fields ?? {});
  $('enrichOut').innerHTML = entries.length ? `${when ? `<p class="muted" style="font-size:12px">Saved ${esc(when)} UTC</p>` : ''}<div class="fields">${entries.map(([k, f]) =>
    `<div title="${esc(f.source)} · ${esc(f.confidence)}"><span>${esc(k)}</span><span>${esc(typeof f.value === 'object' ? JSON.stringify(f.value).slice(0, 80) : f.value)}${f.unit ? ' ' + esc(f.unit) : ''}</span></div>`).join('')}</div>` : '';
}
$('closeDetail').onclick = () => {
  $('detail').hidden = true;
  if (selectedId) map.setFeatureState({ source: 'parcels', id: selectedId }, { selected: false });
  selectedId = null; detailFor = null; setDrive(null); renderList();
  window.clearCandidate?.();
};

loadConfig().catch((e) => { $('searchMsg').className = 'msg err'; $('searchMsg').textContent = e.message; });
