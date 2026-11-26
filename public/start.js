/* Home: start a project in five steps, one question each. Every step shows how many loaded sites still match,
   so nobody lands on an empty map without knowing why.
     1 What are you building   2 Where   3 How much land   4 Deal-breakers   5 What to rank by, then create
   A pasted brief (step 1) is drafted by Paydirt and pre-fills the steps; it never skips them. */
(() => {
  const { $, esc, api } = pd;
  const box = $('startBox'); if (!box) return;
  const STEPS = ['What you’re building', 'Where', 'How much land', 'Deal-breakers', 'Ranking'];
  const RANKS = [
    ['vacancy', 'Vacant or lightly built land', 'Less to demolish and fewer people to displace.'],
    ['zoning.sports_facility', 'Zoning that allows it outright', 'A building permit beats a hearing.', 'sports'],
    ['acres', 'Closest to your ideal size', 'Sites in the size range you set rank above near misses.'],
    ['land_value_per_acre', 'Lower assessed land value', 'A rough guide to price; it is not an asking price.'],
    ['hh200k_10mi', 'More households earning $200k+ within 10 miles', 'For projects that depend on nearby families with money to spend.'],
    ['owner_signals', 'Owners who may be open to selling', 'Long-held, inherited or absentee-owned land. Off-market outreach.'],
  ];
  const st = { step: 0, use: null, useText: '', brief: '', places: [], min: '', max: '', vacant: false, zoning: 'any', juris: 'any', rank: new Set(['vacancy']), extraReqs: [], extraPrefs: [], name: '' };
  let seq = 0;

  const say = (t, err) => { $('startMsg').className = err ? 'msg err' : 'msg'; $('startMsg').textContent = t ?? ''; };
  const n = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const useLabel = () => (st.use === 'sports' ? 'a sports facility' : st.useText.trim() || 'your project');
  const areas = () => st.places.filter((p) => p.fips).map((p) => ({ county_fips: p.fips, place: p.whole ? null : p.place }));

  // The steps as one spec, in the same shape the map's filters save.
  function spec({ withAreas = false } = {}) {
    const req = [...st.extraReqs], pref = [...st.extraPrefs];
    if (n(st.min) != null || n(st.max) != null) req.push({ field: 'acres', value: [n(st.min), n(st.max)], why: 'Size you chose when setting up the project.' });
    if (st.vacant) req.push({ field: 'vacant', value: true, why: 'Vacant land only.' });
    if (st.use === 'sports' && st.zoning !== 'any') req.push({ field: 'zoning.sports_facility', value: st.zoning === 'outright' ? ['permitted'] : ['permitted', 'conditional', 'unknown'], why: st.zoning === 'outright' ? 'Zoning must allow it outright.' : 'Zoning must allow it, or not be ruled out yet.' });
    if (st.juris !== 'any') req.push({ field: 'jurisdiction', value: [st.juris], why: st.juris === 'city' ? 'Inside a city only.' : 'Unincorporated county land only.' });
    if (withAreas && st.places.length) req.push({ field: 'area', value: st.places.map((p) => p.asked), why: 'Places you chose when setting up the project.' });
    const picks = [...st.rank].filter((f) => f !== 'zoning.sports_facility' || st.use === 'sports');
    for (const f of picks) pref.push({ field: f, weight: Math.round(100 / picks.length), ...(f === 'acres' && n(st.min) != null ? { params: { min: n(st.min), max: n(st.max) ?? 1000 } } : {}), why: RANKS.find((r) => r[0] === f)[2] });
    const pending = st.use === 'other' && st.useText.trim() ? [{ key: 'other_use_zoning', value: `zoning that allows ${st.useText.trim()}` }] : [];
    return { requirements: req, preferences: pref, pending };
  }

  // ---------- Steps ----------
  const opt = (name, value, cur, title, sub) => `<label class="wizOpt"><input type="${name === 'rank' ? 'checkbox' : 'radio'}" name="${name}" value="${esc(value)}" ${cur ? 'checked' : ''}><span><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></label>`;
  const VIEWS = [
    () => `<h2 class="wizQ">What are you building?</h2>
      <div class="wizOpts">
        ${opt('use', 'sports', st.use === 'sports', 'A sports facility', 'Indoor courts or turf plus outdoor fields. Paydirt has zoning answers for this use in King County and its larger cities, and can read other places’ codes on request.')}
        ${opt('use', 'other', st.use === 'other', 'Something else', 'Paydirt will find and rank the land. Zoning answers for your use are not read yet; each site shows its zone so you can check.')}
      </div>
      <label id="useTextRow" ${st.use === 'other' ? '' : 'hidden'}>What is it? <input id="useText" type="text" maxlength="120" value="${esc(st.useText)}" placeholder="e.g. a farm stay with a house, a 40-unit townhome community"></label>
      <details class="wizBrief"><summary>Or paste a brief and let Paydirt fill in the steps</summary>
        <textarea id="startText" rows="4" placeholder="Paste your notes: what it is, how much land, where, what matters.">${esc(st.brief)}</textarea>
        <div class="startActions"><button id="startGo" type="button" class="secondary">Fill in the steps from this</button>
          <label class="fileLink"><input id="startFile" type="file" accept=".md,.markdown,.txt,text/plain,text/markdown"> or upload a file</label></div>
      </details>`,
    () => `<h2 class="wizQ">Where should Paydirt look?</h2>
      <p class="muted">Name a town, city or county. Paydirt tells you whether its land is loaded, and what it costs to unlock if not. Add as many as you like, or none to search everywhere already loaded.</p>
      <form id="placeForm" class="wizPlace"><input id="placeIn" type="text" maxlength="120" placeholder="e.g. Gig Harbor, or Kitsap County" aria-label="Town, city or county"><button type="submit" class="secondary" id="placeAdd">Add</button></form>
      <ul id="placeList" class="wizPlaces">${st.places.map(placeRow).join('')}</ul>`,
    () => `<h2 class="wizQ">How much land?</h2>
      <div class="row wizSize"><label>At least (acres) <input id="minAc" type="number" min="1" step="1" value="${esc(st.min)}"></label><label>At most (acres) <input id="maxAc" type="number" min="1" step="1" value="${esc(st.max)}"></label></div>
      <p class="muted small">Leave either side empty for no limit. Click a bar to use that range.</p>
      <div id="bands" class="wizBands"><p class="muted small">Counting sites by size…</p></div>`,
    () => `<h2 class="wizQ">Any deal-breakers?</h2>
      <p class="muted">A deal-breaker hides sites. Use them sparingly: anything you only prefer belongs in the next step.</p>
      <label class="wizOpt"><input type="checkbox" id="dbVacant" ${st.vacant ? 'checked' : ''}><span><b>Vacant land only</b><small>Hides anything the assessor lists with a use or building.</small></span></label>
      ${st.use === 'sports' ? `<fieldset class="wizSet"><legend>Zoning</legend>
        ${opt('zoning', 'any', st.zoning === 'any', 'Show every zone', 'Rank by zoning instead of hiding sites.')}
        ${opt('zoning', 'allowed', st.zoning === 'allowed', 'Hide sites where it is not allowed', 'Keeps permitted, permit-needed and not-yet-read zones.')}
        ${opt('zoning', 'outright', st.zoning === 'outright', 'Only where it is allowed outright', 'Strict: also hides every place whose code has not been read.')}</fieldset>` : ''}
      <fieldset class="wizSet"><legend>City or county land</legend>
        ${opt('juris', 'any', st.juris === 'any', 'Either')}
        ${opt('juris', 'city', st.juris === 'city', 'Inside a city only', 'City zoning, permits and council.')}
        ${opt('juris', 'unincorporated', st.juris === 'unincorporated', 'Unincorporated county land only', 'County zoning; often fewer services.')}</fieldset>
      <div id="loosen"></div>`,
    () => `<h2 class="wizQ">What should rank sites higher?</h2>
      <p class="muted">Pick up to three. These never hide a site; they decide the order.</p>
      <div class="wizOpts">${RANKS.filter((r) => !r[3] || st.use === 'sports').map(([f, t, s]) => opt('rank', f, st.rank.has(f), t, s)).join('')}</div>
      <div class="wizReview"><p class="lbl">Your project</p><ul id="reviewList"></ul>
        <div class="startCreate"><label>Project name <input id="startName" type="text" maxlength="120" value="${esc(st.name || defaultName())}"></label></div></div>`,
  ];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const defaultName = () => `${cap(useLabel().replace(/^(a|an) /, ''))}${st.places.length ? ` · ${st.places.slice(0, 2).map((p) => p.place ?? p.asked).join(', ')}` : ''}`;

  function placeRow(p, i) {
    let state = '<span class="muted">Checking…</span>';
    if (p.error) state = `<span class="msg err">${esc(p.error)}</span>`;
    else if (p.stage === 'in_plan') state = `<span class="pill pass">Loaded</span> <span class="muted">${esc(p.county)}, ${esc(p.state)}</span>`;
    else if (p.stage === 'ready') state = `<span class="pill review">Not loaded</span> <span class="muted">${esc(p.county)}, ${esc(p.state)}: ${Number(p.parcels).toLocaleString()} parcels of 10+ acres, ${Number(p.credits).toLocaleString()} credits to unlock. You have ${Number(p.balance).toLocaleString()}. You can unlock it from the map once the project exists.</span>`;
    else if (p.stage === 'on_request') state = `<span class="pill">On request</span> <span class="muted">${esc(p.county)}, ${esc(p.state)} can’t be loaded automatically yet. Keep it and request it from the map.</span>`;
    return `<li><b>${esc(p.place ?? p.asked)}</b> ${state} <button type="button" class="linkBtn" data-drop="${i}">Remove</button></li>`;
  }

  function paint() {
    $('wizSteps').innerHTML = STEPS.map((s, i) => `<li class="${i === st.step ? 'on' : i < st.step ? 'done' : ''}"${i === st.step ? ' aria-current="step"' : ''}><button type="button" data-go="${i}" ${i > st.step ? 'disabled' : ''}>${esc(s)}</button></li>`).join('');
    $('wizBody').innerHTML = VIEWS[st.step]();
    $('wizBack').hidden = st.step === 0;
    $('wizNext').textContent = st.step === STEPS.length - 1 ? 'Create project and see sites' : 'Next';
    if (paint.last !== st.step) say(''); // a repaint of the same step keeps its message
    paint.last = st.step;
    wire(); count();
    $('wizBody').querySelector('input:not([type=file]):not([type=radio]):not([type=checkbox])')?.focus({ preventScroll: true });
  }

  function wire() {
    const b = $('wizBody');
    b.onchange = (e) => {
      const t = e.target;
      if (t.name === 'use') { st.use = t.value; $('useTextRow').hidden = st.use !== 'other'; if (st.use === 'other') $('useText').focus(); }
      else if (t.name === 'zoning') st.zoning = t.value;
      else if (t.name === 'juris') st.juris = t.value;
      else if (t.id === 'dbVacant') st.vacant = t.checked;
      else if (t.name === 'rank') {
        if (t.checked && st.rank.size >= 3) { t.checked = false; say('Three at most: untick one first.', true); return; }
        t.checked ? st.rank.add(t.value) : st.rank.delete(t.value); say('');
      } else return;
      count();
    };
    b.oninput = (e) => {
      const t = e.target;
      if (t.id === 'useText') st.useText = t.value;
      else if (t.id === 'startText') st.brief = t.value;
      else if (t.id === 'startName') st.name = t.value;
      else if (t.id === 'minAc' || t.id === 'maxAc') { st.min = $('minAc').value; st.max = $('maxAc').value; clearTimeout(wire.t); wire.t = setTimeout(count, 350); }
    };
    b.onclick = (e) => {
      const drop = e.target.closest('[data-drop]'); if (drop) { st.places.splice(Number(drop.dataset.drop), 1); paint(); return; }
      const band = e.target.closest('[data-band]'); if (band) { const [lo, hi] = band.dataset.band.split(','); st.min = lo; st.max = hi; paint(); }
    };
    if ($('placeForm')) $('placeForm').onsubmit = (e) => { e.preventDefault(); addPlace($('placeIn').value); };
    if ($('startGo')) $('startGo').onclick = fromBrief;
    if ($('startFile')) $('startFile').onchange = async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      if (f.size > 500_000) return say('That file is over 500 KB. Paste the part that matters instead.', true);
      st.brief = await f.text(); $('startText').value = st.brief; say(`Loaded ${f.name}.`);
    };
  }

  async function addPlace(text) {
    const asked = String(text ?? '').trim(); if (!asked) return;
    if (st.places.some((p) => p.asked.toLowerCase() === asked.toLowerCase())) return;
    const p = { asked }; st.places.push(p);
    if (st.step === 1) paint();
    try {
      const q = await api(`/api/areas/quote?${new URLSearchParams({ place: asked, minAcres: '10' })}`);
      Object.assign(p, { place: q.place, fips: q.fips, county: q.county, state: q.state, stage: q.loaded > 0 ? 'in_plan' : q.stage, // land already loaded is searchable today, whoever unlocked it
        parcels: q.parcels, credits: q.credits, balance: q.balance,
        whole: /county$/i.test(q.place ?? '') || q.place === q.county });
    } catch (err) { p.error = err.message; }
    if (st.step === 1 && st.places.includes(p)) paint();
  }

  // A pasted brief: Paydirt drafts filters, and the ones the steps cover are loaded into them. The rest are kept.
  async function fromBrief() {
    const text = (st.brief || '').trim();
    if (text.length < 20) { say('Say a little more: what it is, how much land, where.', true); return; }
    $('startGo').disabled = true; say('Reading your brief… about 30 seconds.');
    try {
      const d = await api('/api/drafts/from-text', { method: 'POST', body: { text } });
      const req = Object.fromEntries(d.spec.requirements.map((r) => [r.field, r.value]));
      const OWN = ['acres', 'vacant', 'zoning.sports_facility', 'jurisdiction', 'area'];
      st.extraReqs = d.spec.requirements.filter((r) => !OWN.includes(r.field));
      st.extraPrefs = [];
      st.rank = new Set(d.spec.preferences.map((p) => p.field).filter((f) => RANKS.some((r) => r[0] === f)).slice(0, 3));
      const other = (d.spec.pending ?? []).find((x) => x.key === 'other_use_zoning');
      const sports = [...d.spec.requirements, ...d.spec.preferences].some((x) => x.field === 'zoning.sports_facility');
      st.use = sports ? 'sports' : 'other';
      st.useText = other ? other.value.replace(/^zoning that allows /i, '') : sports ? '' : d.name;
      if (req.acres) { st.min = req.acres[0] ?? ''; st.max = req.acres[1] ?? ''; }
      st.vacant = req.vacant === true;
      st.zoning = !req['zoning.sports_facility'] ? 'any' : req['zoning.sports_facility'].length === 1 ? 'outright' : 'allowed';
      st.juris = req.jurisdiction?.length === 1 ? req.jurisdiction[0] : 'any';
      st.name = d.name;
      st.places = [];
      for (const a of req.area ?? []) addPlace(a);
      st.step = 1; paint.last = 1; paint();
      say(`Filled in from your brief. Check each step.${d.unsupported.length ? ` Not something Paydirt can check yet: ${d.unsupported.join('; ')}.` : ''}`);
    } catch (err) { say(`Paydirt couldn't read the brief. ${err.message}`, true); if ($('startGo')) $('startGo').disabled = false; }
  }

  // ---------- The running count ----------
  async function count() {
    const mine = ++seq, step = st.step;
    if (step === 0) { $('wizCount').textContent = ''; return; }
    $('wizCount').textContent = 'Counting matching sites…';
    try {
      const a = await api('/api/drafts/advice', { method: 'POST', body: { spec: spec(), areas: areas(), bands: step === 2 } });
      if (mine !== seq) return;
      const waiting = st.places.filter((p) => p.stage && p.stage !== 'in_plan').length;
      $('wizCount').innerHTML = `<b>${a.count.toLocaleString()}</b> loaded ${a.count === 1 ? 'site matches' : 'sites match'} so far${st.places.length ? '' : ', across everything loaded'}.${waiting ? ` ${waiting} of your places ${waiting === 1 ? 'is' : 'are'} not loaded, so ${waiting === 1 ? 'it adds' : 'they add'} nothing yet.` : ''}`;
      if (step === 2 && a.bands && $('bands')) {
        const top = Math.max(1, ...a.bands.map((x) => x.count));
        $('bands').innerHTML = a.bands.map((x) => `<button type="button" class="wizBand" data-band="${x.lo},${x.hi ?? ''}" aria-label="${x.lo}${x.hi ? ` to ${x.hi}` : ' or more'} acres: ${x.count} sites">
          <span class="bar"><i style="height:${Math.round((x.count / top) * 100)}%"></i></span><b>${x.count.toLocaleString()}</b><small>${x.lo}${x.hi ? `–${x.hi}` : '+'} ac</small></button>`).join('');
      }
      if (step === 3 && $('loosen')) $('loosen').innerHTML = a.loosen ? `<p class="startAdvice">Only ${a.count.toLocaleString()} left. “${esc(a.loosen.label)}” is cutting the most: without it, ${a.loosen.count.toLocaleString()} sites would match.</p>` : '';
      if (step === 4 && $('reviewList')) {
        const s = spec(), out = [`Building: ${esc(useLabel())}`,
          `Where: ${st.places.length ? st.places.map((p) => esc(p.place ?? p.asked)).join(', ') : 'everywhere loaded'}`,
          `Size: ${n(st.min) != null || n(st.max) != null ? `${n(st.min) ?? 'any'} to ${n(st.max) ?? 'any'} acres` : 'any'}`,
          `Deal-breakers: ${s.requirements.filter((r) => r.field !== 'acres').map((r) => esc(r.why.replace(/\.$/, ''))).join('; ') || 'none'}`,
          `<b>${a.count.toLocaleString()} sites match today.</b>`];
        $('reviewList').innerHTML = out.map((x) => `<li>${x}</li>`).join('');
      }
    } catch (err) { if (mine === seq) $('wizCount').textContent = `Couldn't count sites: ${err.message}`; }
  }

  // ---------- Moving between steps ----------
  function valid() {
    if (st.step === 0 && !st.use) return 'Pick one to continue.';
    if (st.step === 0 && st.use === 'other' && st.useText.trim().length < 3) return 'Say what you’re building, in a few words.';
    if (st.step === 1 && st.places.some((p) => !p.stage && !p.error)) return 'Still checking a place: one moment.';
    if (st.step === 1 && st.places.some((p) => p.error)) return 'Remove the place Paydirt couldn’t find, or try another spelling.';
    if (st.step === 2 && n(st.min) != null && n(st.max) != null && n(st.min) > n(st.max)) return 'The smallest size is larger than the largest.';
    return null;
  }
  $('wizNext').onclick = () => {
    const bad = valid(); if (bad) return say(bad, true);
    if (st.step < STEPS.length - 1) { st.step++; paint(); } else create();
  };
  $('wizBack').onclick = () => { st.step = Math.max(0, st.step - 1); paint(); };
  $('wizSteps').onclick = (e) => { const b = e.target.closest('[data-go]'); if (b && !b.disabled) { st.step = Number(b.dataset.go); paint(); } };

  async function create() {
    $('wizNext').disabled = true; say('Creating…');
    try {
      const name = ($('startName')?.value ?? '').trim() || defaultName();
      const p = await api('/api/projects', { method: 'POST', body: { name, brief: st.brief || `Looking for land for ${useLabel()}.`, spec: spec({ withAreas: true }), source: st.brief ? 'markdown' : 'form' } });
      location.href = `map.html?project=${p.id}`;
    } catch (err) { say(err.message, true); $('wizNext').disabled = false; }
  }

  // A project with nothing set: every site is listed, and the filters on the map are where to start.
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-blank]'); if (!b) return;
    b.disabled = true; say('Creating…');
    try {
      const p = await api('/api/projects', { method: 'POST', body: { name: 'New project', spec: { requirements: [], preferences: [] }, source: 'form' } });
      location.href = `map.html?project=${p.id}`;
    } catch (err) { say(err.message, true); b.disabled = false; }
  });

  paint();
})();
