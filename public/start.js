/* Home: start a project from one box. Describe the site → Paydirt drafts it as the same chips the map
   shows (click any to change it) → name it → Create, which opens the map ranked for it.
   "Set criteria yourself" skips the description and opens the map with nothing set yet. */
(() => {
  const { $, esc, api } = pd;
  const box = $('startBox'); if (!box) return;
  let draft = null, catalog = null, lastText = '';

  const say = (t, err) => { $('startMsg').className = err ? 'msg err' : 'msg'; $('startMsg').textContent = t; };

  $('startFile').onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 500_000) return say('That file is over 500 KB. Paste the part that matters instead.', true);
    $('startText').value = await f.text();
    say(`Loaded ${f.name}.`);
  };

  $('startGo').onclick = () => {
    const text = $('startText').value.trim();
    if (text.length < 20) { say('Say a little more: size, area, what it is for.', true); $('startText').focus(); return; }
    run(text);
  };

  async function run(text) {
    lastText = text;
    $('startGo').disabled = true; $('startOut').innerHTML = ''; say('Reading your description and drafting your project… about 30 seconds.');
    try {
      const [d, r] = await Promise.all([api('/api/drafts/from-text', { method: 'POST', body: { text } }), catalog ? null : api('/api/projects')]);
      if (r) catalog = r.catalog;
      draft = d;
      say('');
      render();
    } catch (err) { say(''); failed(err); }
    finally { $('startGo').disabled = false; }
  }

  function failed(err) {
    $('startOut').innerHTML = `
      <div class="startDraft">
        <p class="msg err" role="alert">Paydirt couldn't draft this project. ${esc(err.message)}</p>
        <div class="startCreate"><button id="startRetry" type="button">Try again</button><button type="button" class="linkish" data-blank>Set criteria yourself</button></div>
      </div>`;
    $('startRetry').onclick = () => run(lastText);
  }

  function render() {
    $('startOut').innerHTML = `
      <div class="startDraft">
        <p class="lbl">Here's what Paydirt will look for</p>
        <div id="startChips" class="critChips" role="group" aria-label="What this project will look for"></div>
        <p class="muted small">Click any of these to change it before you create the project.</p>
        <div id="startAdvice" class="startAdvice" aria-live="polite"></div>
        ${draft.unsupported.length ? `<p class="muted small">Not something Paydirt can check yet: ${draft.unsupported.map(esc).join('; ')}.</p>` : ''}
        ${draft.questions.length ? `<p class="muted small">Worth deciding later: ${draft.questions.map(esc).join(' ')}</p>` : ''}
        ${draft.errors.length ? '<p class="warn">Part of your description couldn\'t be turned into a chip. Check the chips above, or add more detail and draft again.</p>' : ''}
        <div class="startCreate">
          <label>Project name <input id="startName" type="text" maxlength="120" value="${esc(draft.name)}"></label>
          <button id="startCreate" type="button">Create project and see sites</button>
        </div>
        <p class="muted small">Not right? Edit your description and draft again, or change any of it later on the map.</p>
      </div>`;
    window.paydirtCriteria.draft($('startChips'), draft, catalog);
    $('startCreate').onclick = create;
    advise();
    // Re-count after a chip is changed (the chip row is redrawn on every change).
    new MutationObserver(advise).observe($('startChips'), { childList: true });
  }

  // What this draft finds today, and what to change to find more: counted from loaded data, shown before creating.
  let adviceFor = null;
  async function advise() {
    const el = $('startAdvice'); if (!el) return;
    const key = JSON.stringify(draft.spec); if (key === adviceFor) return; adviceFor = key;
    el.innerHTML = '<p class="muted small">Counting matching sites…</p>';
    try {
      const a = await api('/api/drafts/advice', { method: 'POST', body: { spec: draft.spec } });
      if (adviceFor !== key || !el.isConnected) return;
      const out = [`<p><b>${a.count.toLocaleString()} ${a.count === 1 ? 'site matches' : 'sites match'} today.</b>${a.few && !a.loosen ? (a.count ? ' That is a short list.' : ' No single filter is the cause, so more than one needs widening.') : ''}</p>`];
      if (a.loosen) out.push(`<p>“${esc(a.loosen.label)}” is the filter cutting the most: without it, ${a.loosen.count.toLocaleString()} sites would match. Click it above to widen it.</p>`);
      const missing = a.places.filter((p) => !p.loaded);
      if (missing.length) out.push(`<p>${missing.map((p) => esc(p.name)).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not loaded yet. After you create the project, use “Where to search” on the map to see what unlocking ${missing.length === 1 ? 'it' : 'them'} costs.</p>`);
      const have = a.places.filter((p) => p.loaded);
      if (have.length) out.push(`<p class="muted small">Loaded: ${have.map((p) => `${esc(p.name)} (${p.sites.toLocaleString()} sites of any kind)`).join(', ')}.</p>`);
      el.innerHTML = out.join('');
    } catch (err) { if (adviceFor === key) el.innerHTML = `<p class="muted small">Couldn't count sites: ${esc(err.message)}</p>`; }
  }

  async function create() {
    $('startCreate').disabled = true; say('Creating…');
    try {
      const p = await api('/api/projects', { method: 'POST', body: { name: $('startName').value.trim() || draft.name, brief: draft.brief, spec: draft.spec, source: 'markdown' } });
      location.href = `map.html?project=${p.id}`;
    } catch (err) { say(err.message, true); $('startCreate').disabled = false; }
  }

  // A project with nothing set: every site is listed, and the chips on the map are where to start.
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-blank]'); if (!b) return;
    b.disabled = true; say('Creating…');
    try {
      const p = await api('/api/projects', { method: 'POST', body: { name: 'New project', spec: { requirements: [], preferences: [] }, source: 'form' } });
      location.href = `map.html?project=${p.id}`;
    } catch (err) { say(err.message, true); b.disabled = false; }
  });
})();
