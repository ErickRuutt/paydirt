/* "Where to search" for a project: the list of areas it searches, and adding one. Name a town or county and the
   dialog says which of three states it is in (unlocked, ready to unlock, on request), what layers of facts the
   county comes with, and the one thing to do next. Unlocking adds the place to the project in the same step. Used on the map, the Saved page and fit statements:
   window.paydirtAreas.open({ projectId, place?, focus?: 'zoning', onChanged? }) */
window.paydirtAreas = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const titleCase = (s) => String(s ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const date = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
  async function call(path, { method = 'GET', body } = {}) {
    const token = await window.paydirtAuth.token();
    const res = await fetch(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error ?? `Request failed (${res.status})`), { status: res.status, body: json });
    return json;
  }

  let dlg, st = {};
  const $ = (s) => dlg.querySelector(s);
  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'critDlg areaDlg';
    dlg.setAttribute('aria-labelledby', 'adTitle');
    dlg.innerHTML = `
      <div class="adHead"><h2 id="adTitle" class="critTitle">where to search</h2><button type="button" class="ghost" data-close title="Close (Esc)">Close ✕</button></div>
      <p class="critKicker" id="adKicker"></p>
      <section class="adList adFirst"><h3 class="lbl">This project searches</h3><div id="adAreas"><p class="muted small">Loading…</p></div></section>
      <form id="adForm" class="adForm">
        <label>Add a town, city or county<input id="adPlace" required maxlength="120" placeholder="e.g. Sequim"></label>
        <button type="submit" id="adCheck">Check</button>
      </form>
      <div id="adResult" aria-live="polite"></div>
      <section class="adList" id="adReqs" hidden><h3 class="lbl">Requests from this project</h3><div id="adMine"></div></section>
      <p class="adFoot lblish" id="adBalance"></p>`;
    document.body.append(dlg);
    $('[data-close]').onclick = () => dlg.close();
    $('#adForm').onsubmit = (e) => { e.preventDefault(); check(); };
    $('#adResult').addEventListener('click', onAction);
    $('#adResult').addEventListener('change', (e) => { if (e.target.id === 'adSize') { st.size = Number(e.target.value); check(); } });
    $('#adAreas').addEventListener('click', onArea);
  }

  // The project's use, in words, for zoning requests.
  const useOf = (p) => (p.spec.pending ?? []).find((x) => x.key === 'other_use_zoning')?.value?.replace(/^zoning that allows /i, '')
    ?? ([...p.spec.requirements, ...p.spec.preferences].some((x) => x.field === 'zoning.sports_facility') ? 'a sports facility' : p.name);
  // Parcel size comes from the project's own size criterion; it can be changed under "Parcel size".
  function defaultSize(p, sizes) {
    const must = p.spec.requirements.find((r) => r.field === 'acres')?.value?.[0];
    const nice = p.spec.preferences.find((x) => x.field === 'acres')?.params?.min;
    const want = Number(must ?? nice ?? 5);
    return [...sizes].reverse().find((x) => x <= want) ?? sizes[0];
  }

  const AREA_STATE = { ready: 'Not unlocked', on_request: 'On request', empty: 'No sites by this name' };
  async function loadMine() {
    const a = await call(`/api/projects/${st.project.id}/areas`);
    st.areas = a;
    $('#adBalance').textContent = `${a.balance.toLocaleString()} credits`;
    $('#adAreas').innerHTML = a.areas.length ? `<ul class="adRows">${a.areas.map((x) => `<li><div><b>${esc(x.label)}</b>
        <span class="muted small">${esc(x.place ? x.county_name ?? 'County not found' : 'Whole county')}${x.state === 'loaded' ? ` · ${x.sites.toLocaleString()} sites` : ''}</span></div>
        <span class="btnRow">${x.state === 'loaded' ? '' : x.state === 'ready' ? `<button type="button" data-check="${esc(x.place ?? x.label)}">See what unlocking takes</button>` : `<span class="pill review">${AREA_STATE[x.state]}</span>`}
        <button type="button" class="linkBtn" data-remove="${esc(x.area_uid)}" aria-label="Stop searching ${esc(x.label)}">Remove</button></span></li>`).join('')}</ul>`
      : '<p class="muted small">Everywhere your organization has unlocked. Add a town or county to narrow it.</p>';
    const reqs = a.requests.filter((r) => r.status !== 'unlocked');
    $('#adReqs').hidden = !reqs.length;
    $('#adMine').innerHTML = `<ul class="adRows">${reqs.map((r) => `<li><div><b>${esc(r.area)}</b><span class="muted small">${esc(a.kinds[r.kind] ?? r.kind)}${r.use_text ? ` · for ${esc(r.use_text)}` : ''} · ${esc(date(r.created_at))}</span></div>
      ${r.ready ? `<button type="button" data-check="${esc(r.place)}">Ready: unlock now</button>` : `<span class="pill ${r.status === 'declined' ? 'fail' : 'review'}">${esc(a.statuses[r.status] ?? r.status)}</span>`}</li>`).join('')}</ul>`;
    $('#adMine').onclick = (e) => { const b = e.target.closest('[data-check]'); if (b) { $('#adPlace').value = b.dataset.check; check(); } };
  }
  async function onArea(e) {
    const c = e.target.closest('[data-check]');
    if (c) { $('#adPlace').value = c.dataset.check; return check(); }
    const b = e.target.closest('[data-remove]'); if (!b) return;
    b.disabled = true;
    try { await call(`/api/projects/${st.project.id}/areas/${encodeURIComponent(b.dataset.remove)}`, { method: 'DELETE' }); await loadMine(); changed(); }
    catch (err) { b.disabled = false; say(esc(err.message), true); }
  }

  const band = (tone, html) => `<div class="fitBand ${tone}">${html}</div>`;
  async function check() {
    const place = $('#adPlace').value.trim(); if (!place) return;
    const btn = $('#adCheck'); btn.disabled = true;
    $('#adResult').innerHTML = '<p class="muted">Finding the county and counting parcels…</p>';
    try {
      st.quote = await call(`/api/areas/quote?${new URLSearchParams({ place, minAcres: st.size })}`);
      paintQuote();
    } catch (err) { $('#adResult').innerHTML = `<p class="msg err">${esc(err.message)}</p>`; }
    finally { btn.disabled = false; }
  }

  // What the county comes with, layer by layer: ● all of it, ◐ part of it, ○ not yet.
  const MARK = { yes: ['●', 'Included'], partial: ['◐', 'Partly'], site: ['◐', 'Per site'], no: ['○', 'Not yet'] };
  function ladderHtml(q) {
    if (!q.layers?.length) return '';
    const zoningAsk = (l) => (l.key === 'zoning' && l.state !== 'yes' && q.supported
      ? ` <button type="button" class="linkBtn" data-act="zoning">Ask us to read it for ${esc(useOf(st.project))}</button>` : '');
    return `<ul class="adLadder" aria-label="What ${esc(q.county)} comes with">${q.layers.map((l) => `<li class="${l.state}">
      <span class="adMark" aria-hidden="true">${MARK[l.state][0]}</span>
      <div><b>${esc(l.label)}</b> <span class="lblish">${MARK[l.state][1]}</span>
        <span class="small">${esc(l.note ?? l.answers + '.')}${zoningAsk(l)}</span></div></li>`).join('')}</ul>`;
  }
  const sizeHtml = (q) => `<details class="adSizeBox"><summary class="small">Parcel size: ${q.minAcres}+ acres, from this project’s size</summary>
    <label class="small">Unlock parcels of <select id="adSize">${q.sizes.map((x) => `<option value="${x}" ${x === q.minAcres ? 'selected' : ''}>${x}+ acres</option>`).join('')}</select> Smaller parcels cost more because there are more of them.</label></details>`;
  const inProject = (q) => (st.areas?.areas ?? []).find((a) => a.county_fips === q.fips && (!a.place || a.place.toLowerCase() === q.place.toLowerCase()));
  const isCounty = (q) => q.place.toLowerCase() === q.county.toLowerCase();
  // "Sequim is in Clallam County, WA." or just "Hood River County, OR." when the place is the county itself.
  const placeLine = (q) => (isCounty(q) ? `${esc(q.county)}, ${esc(q.state)}` : `${esc(q.place)} is in ${esc(q.county)}, ${esc(q.state)}`);
  const STATE = { in_plan: ['pass', 'Unlocked'], ready: ['review', 'Ready to unlock'], on_request: ['fail', 'On request'] };

  function paintQuote() {
    const q = st.quote, [tone, word] = STATE[q.stage];
    const head = `<span class="adState"><span class="pill ${tone}">${word}</span> <b>${placeLine(q)}</b></span>`;
    let body;
    if (q.stage === 'on_request') {
      body = `<span>Paydirt has no parcel source connected for ${esc(q.county)} yet, so it can’t be unlocked with credits. Request it and its status shows here; you’ll be able to unlock it yourself once the source is connected.</span>
        <span class="btnRow"><button type="button" data-act="request">Request ${esc(q.county)}</button></span>`;
    } else if (q.stage === 'in_plan') {
      const there = inProject(q);
      body = `<span>${q.loaded.toLocaleString()} parcels of ${q.minAcres}+ acres are loaded. Nothing more to pay.</span>${ladderHtml(q)}
        <span class="btnRow">${there ? `<span class="small">${esc(there.label)} is already in this project’s search.</span>` : `<button type="button" data-act="add">Add ${esc(isCounty(q) ? q.county : q.place)} to this project</button>`}
        ${!isCounty(q) && !(there && !there.place) ? `<button type="button" class="paper" data-act="addCounty">Search all of ${esc(q.county)}</button>` : ''}</span>`;
    } else {
      const enough = q.balance >= q.credits;
      body = `<span><strong>${q.credits.toLocaleString()} credits</strong> unlocks all ${q.parcels.toLocaleString()} parcels of ${q.minAcres}+ acres in ${esc(q.county)}, for every project in your organization. You have ${q.balance.toLocaleString()}. Loading takes about a minute.</span>
        <span class="lbl">What you get: ${q.covered} of ${q.of} layers</span>${ladderHtml(q)}
        <span class="btnRow"><button type="button" data-act="unlock" ${enough ? '' : 'disabled'}>${enough ? `Unlock and add to this project · ${q.credits.toLocaleString()} credits` : 'Not enough credits'}</button></span>
        ${enough ? '' : '<span class="small">Ask us for credits with the Feedback button; card payments are coming.</span>'}${sizeHtml(q)}`;
    }
    $('#adResult').innerHTML = band(q.stage === 'in_plan' ? 'ok' : 'plain', head + body);
    if (st.focus === 'zoning') $('#adResult [data-act="zoning"]')?.focus();
  }
  const say = (html, err) => $('#adResult').insertAdjacentHTML('beforeend', `<p class="msg ${err ? 'err' : ''}">${html}</p>`);

  async function onAction(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const q = st.quote, p = st.project, act = b.dataset.act;
    const area = `${q.place} (${q.county}, ${q.state})`;
    b.disabled = true;
    try {
      if (act === 'unlock') {
        b.textContent = 'Unlocking… loading parcels (about a minute)';
        const r = await call('/api/areas/unlock', { method: 'POST', body: { place: q.place, minAcres: q.minAcres, projectId: p.id } });
        st.quote = { ...q, ...r };
        await loadMine(); paintQuote();
        say(`Unlocked and added to this project: ${(r.loaded ?? 0).toLocaleString()} parcels loaded. ${r.balance.toLocaleString()} credits left.`);
        changed(); return;
      } else if (act === 'add' || act === 'addCounty') {
        await call(`/api/projects/${p.id}/areas`, { method: 'POST', body: { place: q.place, wholeCounty: act === 'addCounty' } });
        await loadMine(); paintQuote(); changed(); return;
      } else if (act === 'request') {
        await call('/api/areas/requests', { method: 'POST', body: { kind: 'county', area, useText: useOf(p), projectId: p.id, countyFips: q.fips, notes: `From project "${p.name}".` } });
        b.textContent = 'Requested ✓';
      } else if (act === 'zoning') {
        await call('/api/areas/requests', { method: 'POST', body: { kind: 'zoning', area, useText: useOf(p), projectId: p.id, countyFips: q.fips, notes: `From project "${p.name}".` } });
        b.textContent = 'Zoning requested ✓';
      }
      await loadMine();
    } catch (err) { b.disabled = false; say(esc(err.message), true); }
  }

  function changed() {
    document.dispatchEvent(new CustomEvent('paydirt:changed'));
    st.onChanged?.(st.project);
  }

  async function open({ projectId, place = '', focus = null, onChanged = null }) {
    if (!dlg) build();
    st = { focus, onChanged };
    $('#adResult').innerHTML = ''; $('#adPlace').value = place;
    dlg.showModal();
    try {
      st.project = await call(`/api/projects/${projectId}`);
      $('#adKicker').textContent = st.project.name;
      await loadMine();
      st.size = defaultSize(st.project, st.areas.sizes);
      if (place) await check(); else $('#adPlace').focus();
    } catch (err) { $('#adResult').innerHTML = `<p class="msg err">${esc(err.message)}</p>`; }
  }
  return { open, titleCase };
})();
