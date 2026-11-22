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
