/* "Add an area" from inside a project: name a town, see its county and the unlock price, unlock it with credits
   (or request it when Paydirt can't load it yet), add it to the project's Where, or ask for its zoning to be read
   for this project's use. Everything it does is tied to the project. Used on the map, the Saved page and fit statements:
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
      <div class="adHead"><h2 id="adTitle" class="critTitle">add an area</h2><button type="button" class="ghost" data-close title="Close (Esc)">Close ✕</button></div>
      <p class="critKicker" id="adKicker"></p>
      <form id="adForm" class="adForm">
        <label>Town, city or county<input id="adPlace" required maxlength="120" placeholder="e.g. Sequim"></label>
        <label>Parcel size<select id="adSize"></select></label>
        <button type="submit" id="adCheck">Check</button>
      </form>
      <div id="adResult" aria-live="polite"></div>
      <section class="adList"><h3 class="lbl">This project’s areas</h3><div id="adMine"><p class="muted small">Loading…</p></div></section>
      <p class="adFoot lblish" id="adBalance"></p>`;
    document.body.append(dlg);
    $('[data-close]').onclick = () => dlg.close();
    $('#adForm').onsubmit = (e) => { e.preventDefault(); check(); };
    $('#adResult').addEventListener('click', onAction);
    // A request whose county Paydirt can now load: go straight to its price.
    $('#adMine').addEventListener('click', (e) => { const b = e.target.closest('[data-ready]'); if (!b) return; $('#adPlace').value = b.dataset.ready; check(); });
  }

  // The project's use, in words, for zoning requests.
  const useOf = (p) => (p.spec.pending ?? []).find((x) => x.key === 'other_use_zoning')?.value?.replace(/^zoning that allows /i, '')
    ?? ([...p.spec.requirements, ...p.spec.preferences].some((x) => x.field === 'zoning.sports_facility') ? 'a sports facility' : p.name);
  function defaultSize(p, sizes) {
    const must = p.spec.requirements.find((r) => r.field === 'acres')?.value?.[0];
    const nice = p.spec.preferences.find((x) => x.field === 'acres')?.params?.min;
    const want = Number(must ?? nice ?? 5);
    return [...sizes].reverse().find((x) => x <= want) ?? sizes[0];
  }
  const wherePlaces = (p) => (p.chips?.find((c) => c.key === 'where')?.must?.area ?? []).map((a) => a.toLowerCase());

  async function loadMine() {
    const a = await call(`/api/projects/${st.project.id}/areas`);
    st.areas = a;
    $('#adBalance').textContent = `${a.balance.toLocaleString()} credits`;
    if (!$('#adSize').options.length) $('#adSize').innerHTML = a.sizes.map((x) => `<option value="${x}">${x}+ acres</option>`).join('');
    const rows = [
      ...a.unlocks.map((u) => ({ when: u.created_at, what: `${u.county_name} unlocked`, detail: `${Number(u.loaded ?? u.parcels).toLocaleString()} parcels of ${Number(u.min_acres)}+ acres · ${u.credits} credits`, status: u.status === 'done' ? ['pass', 'Unlocked'] : u.status === 'failed' ? ['fail', 'Refunded'] : ['review', 'Loading'] })),
      ...a.requests.map((r) => ({ when: r.created_at, what: r.area, detail: `${a.kinds[r.kind] ?? r.kind}${r.use_text ? ` · for ${r.use_text}` : ''}`,
        ready: r.ready ? r.place : null,
        status: r.ready ? ['pass', 'Ready to unlock'] : [r.status === 'unlocked' ? 'pass' : r.status === 'declined' ? 'fail' : 'review', a.statuses[r.status] ?? r.status] })),
    ].sort((x, y) => new Date(y.when) - new Date(x.when));
    $('#adMine').innerHTML = rows.length ? `<ul class="adRows">${rows.map((r) => `<li><div><b>${esc(r.what)}</b><span class="muted small">${esc(r.detail)} · ${esc(date(r.when))}</span></div>
      ${r.ready ? `<button type="button" data-ready="${esc(r.ready)}">Unlock now</button>` : `<span class="pill ${r.status[0]}">${esc(r.status[1])}</span>`}</li>`).join('')}</ul>`
      : '<p class="muted small">Nothing requested or unlocked from this project yet.</p>';
  }

  const band = (tone, html) => `<div class="fitBand ${tone}">${html}</div>`;
  async function check() {
    const place = $('#adPlace').value.trim(); if (!place) return;
    const btn = $('#adCheck'); btn.disabled = true;
    $('#adResult').innerHTML = '<p class="muted">Finding the county and counting parcels…</p>';
    try {
      const q = await call(`/api/areas/quote?${new URLSearchParams({ place, minAcres: $('#adSize').value })}`);
      st.quote = q; paintQuote();
    } catch (err) { $('#adResult').innerHTML = `<p class="msg err">${esc(err.message)}</p>`; }
    finally { btn.disabled = false; }
  }
  function zoningButton(q) {
    return `<button type="button" class="paper" data-act="zoning">Ask for ${esc(q.place)}’s zoning to be read for ${esc(useOf(st.project))}</button>`;
  }
  function whereButton(q) {
    if (wherePlaces(st.project).includes(q.place.toLowerCase())) return `<span class="small">${esc(q.place)} is already in this project’s Where.</span>`;
    return `<button type="button" data-act="where">Add ${esc(q.place)} to this project’s Where</button>`;
  }
  // "Sequim is in Clallam County, WA." or just "Hood River County, OR." when the place is the county itself.
  const placeLine = (q) => (q.place.toLowerCase() === q.county.toLowerCase() ? `${esc(q.county)}, ${esc(q.state)}.` : `${esc(q.place)} is in ${esc(q.county)}, ${esc(q.state)}.`);
  function paintQuote() {
    const q = st.quote, county = `${q.county}, ${q.state}`;
    if (!q.supported) {
      $('#adResult').innerHTML = band('warn', `<b>${placeLine(q)}</b><span>${esc(q.why)}</span>
        <span class="btnRow"><button type="button" data-act="request">Request ${esc(q.county)} for this project</button></span>`);
    } else if (q.unlocked && q.loaded) {
      $('#adResult').innerHTML = band('ok', `<b>${esc(county)} is in Paydirt.</b><span>${q.loaded.toLocaleString()} parcels of ${q.minAcres}+ acres are loaded.</span>
        <span class="btnRow">${whereButton(q)}${zoningButton(q)}</span>`);
    } else {
      const enough = q.balance >= q.credits;
      $('#adResult').innerHTML = band(enough ? 'ok' : 'warn', `<b>${placeLine(q)}</b>
        <span>Unlocking the county’s <strong>${q.parcels.toLocaleString()}</strong> parcels of ${q.minAcres}+ acres costs <strong>${q.credits.toLocaleString()} credits</strong>. You have ${q.balance.toLocaleString()}.</span>
        <span class="small">You get every ${q.minAcres}+ acre parcel in the county with owner, zoning code, assessed values and last deed date.</span>
        <span class="btnRow">${enough ? `<button type="button" data-act="unlock">Unlock for ${q.credits.toLocaleString()} credits</button>` : '<button type="button" disabled>Not enough credits</button>'}
          <button type="button" class="paper" data-act="request">Request it instead</button></span>
        ${enough ? '' : '<span class="small">Ask us for credits with the Feedback button; card payments are coming.</span>'}`);
    }
    if (st.focus === 'zoning' && q.unlocked) $('#adResult [data-act="zoning"]')?.focus();
  }
  const say = (html, err) => $('#adResult').insertAdjacentHTML('beforeend', `<p class="msg ${err ? 'err' : ''}">${html}</p>`);

  async function onAction(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const q = st.quote, p = st.project, act = b.dataset.act;
    b.disabled = true;
    try {
      if (act === 'unlock') {
        b.textContent = 'Unlocking… loading parcels (about a minute)';
        const r = await call('/api/areas/unlock', { method: 'POST', body: { place: q.place, minAcres: q.minAcres, projectId: p.id } });
        st.quote = { ...q, unlocked: true, loaded: r.loaded, balance: r.balance };
        paintQuote(); say(`Unlocked: ${(r.loaded ?? 0).toLocaleString()} parcels loaded. ${r.balance.toLocaleString()} credits left.`);
        changed();
      } else if (act === 'request') {
        await call('/api/areas/requests', { method: 'POST', body: { kind: q.supported ? 'city' : 'county', area: `${q.place} (${q.county}, ${q.state})`, useText: useOf(p), projectId: p.id, countyFips: q.fips, notes: `From project "${p.name}".` } });
        b.textContent = 'Requested ✓'; say('Requested. Its status shows below.');
      } else if (act === 'zoning') {
        await call('/api/areas/requests', { method: 'POST', body: { kind: 'zoning', area: `${q.place} (${q.county}, ${q.state})`, useText: useOf(p), projectId: p.id, countyFips: q.fips, notes: `From project "${p.name}".` } });
        b.textContent = 'Zoning requested ✓';
      } else if (act === 'where') {
        await addToWhere(q.place);
        b.replaceWith(Object.assign(document.createElement('span'), { className: 'small', textContent: `${q.place} added to this project’s Where.` }));
        changed();
      }
      await loadMine();
    } catch (err) { b.disabled = false; say(esc(err.message), true); }
  }

  // Add a place to the Where chip, keeping whatever else the chip says (e.g. city vs unincorporated).
  async function addToWhere(place) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const where = st.project.chips?.find((c) => c.key === 'where');
      const must = { ...(where?.must ?? {}) };
      const areas = must.area ?? [];
      if (areas.some((a) => a.toLowerCase() === place.toLowerCase())) return;
      must.area = [...areas, place];
      try {
        st.project = await call(`/api/projects/${st.project.id}`, { method: 'PUT', body: { chip: { key: 'where', edit: { must, nice: null } }, baseVersion: st.project.spec_version } });
        return;
      } catch (err) {
        if (err.status === 409 && err.body?.project) { st.project = err.body.project; continue; } // a teammate saved first: add to theirs
        throw err;
      }
    }
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
      $('#adSize').value = String(defaultSize(st.project, st.areas.sizes));
      if (place) await check(); else $('#adPlace').focus();
    } catch (err) { $('#adResult').innerHTML = `<p class="msg err">${esc(err.message)}</p>`; }
  }
  return { open, titleCase };
})();
