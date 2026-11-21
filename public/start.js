/* Home: start a project from one box. Describe the site → Paydirt drafts plain-language criteria →
   name it → Create, which opens the map ranked for it. Experts can still set criteria by hand. */
(() => {
  const { $, esc, api } = pd;
  const box = $('startBox'); if (!box) return;
  let draft = null, catalog = null;

  const valueText = (r) => {
    const d = catalog.requirements[r.field];
    if (d.type === 'range') {
      const [lo, hi] = r.value;
      return lo != null && hi != null ? `${lo}–${hi}` : lo != null ? `at least ${lo}` : `at most ${hi}`;
    }
    if (d.type === 'set') return r.value.map((v) => (r.field === 'owner_signals' ? catalog.signals[v] : v)).join(', ');
    if (d.type === 'list') return r.value.map((v) => (catalog.tags?.[v] ?? v).toLowerCase()).join(', ');
    if (d.type === 'bool') return 'yes';
    return Number(r.value).toLocaleString();
  };
  const say = (t, err) => { $('startMsg').className = err ? 'msg err' : 'msg'; $('startMsg').textContent = t; };

  $('startFile').onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 500_000) return say('That file is over 500 KB. Paste the part that matters instead.', true);
    $('startText').value = await f.text();
    say(`Loaded ${f.name}.`);
  };

  $('startGo').onclick = async () => {
    const text = $('startText').value.trim();
    if (text.length < 20) { say('Say a little more: size, area, what it is for.', true); $('startText').focus(); return; }
    $('startGo').disabled = true; $('startOut').innerHTML = ''; say('Reading your description… about 30 seconds.');
    try {
      [draft, { catalog }] = await Promise.all([api('/api/drafts/from-text', { method: 'POST', body: { text } }), api('/api/projects')]);
      say('');
      render();
    } catch (err) { say(err.message, true); }
    finally { $('startGo').disabled = false; }
  };

  function render() {
    const must = draft.spec.requirements.map((r) => `<li><b>Must:</b> ${esc(catalog.requirements[r.field].label)} ${esc(valueText(r))}</li>`);
    const total = draft.spec.preferences.reduce((a, p) => a + p.weight, 0) || 1;
    const better = [...draft.spec.preferences].sort((a, b) => b.weight - a.weight)
      .map((p) => `<li><b>Better if:</b> ${esc(catalog.preferences[p.field].label)} <span class="muted">(${Math.round(p.weight / total * 100)}% of the score)</span></li>`);
    $('startOut').innerHTML = `
      <div class="startDraft">
        <p class="lbl">Here's what Paydirt will look for</p>
        <ul class="plainList">${[...must, ...better].join('')}</ul>
        ${draft.unsupported.length ? `<p class="muted small">Not something Paydirt can check yet: ${draft.unsupported.map(esc).join('; ')}.</p>` : ''}
        ${draft.questions.length ? `<p class="muted small">Worth deciding later: ${draft.questions.map(esc).join(' ')}</p>` : ''}
        ${draft.errors.length ? `<p class="warn">${draft.errors.map(esc).join(' ')}</p>` : ''}
        <div class="startCreate">
          <label>Project name <input id="startName" type="text" maxlength="120" value="${esc(draft.name)}"></label>
          <button id="startCreate" type="button">Create project and see sites</button>
        </div>
        <p class="muted small">Not right? Edit your description and draft again, or adjust any of it later on the map.</p>
      </div>`;
    $('startCreate').onclick = create;
  }

  async function create() {
    if (draft.errors.length && !draft.spec.preferences.length) return say('This draft has nothing to rank by. Add more detail and draft again.', true);
    $('startCreate').disabled = true; say('Creating…');
    try {
      const p = await api('/api/projects', { method: 'POST', body: { name: $('startName').value.trim() || draft.name, brief: draft.brief, spec: draft.spec, source: 'markdown', changeNote: 'Drafted from a description on the home page' } });
      location.href = `map.html?project=${p.id}`;
    } catch (err) { say(err.message, true); $('startCreate').disabled = false; }
  }
})();
