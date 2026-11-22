/* global api, $, esc, setSpend */
// Criteria builder: draft a project's criteria from a markdown brief or an interview (Claude),
// show the draft for review, and only save when the person applies it.
(() => {
  const panel = () => { $('detail').hidden = false; window.clearCandidate?.(); return $('detailBody'); };
  let lastDraft = null, source = 'markdown', chat = [];

  // ---------- Markdown / brief ----------
  // revise: start with "Revise the current project" ticked (the project menu's "Revise from a new brief").
  function openBrief({ revise = false } = {}) {
    const cur = window.paydirtProjects.current();
    panel().innerHTML = `
      <div class="builder">
        <h3>Criteria from a brief</h3>
        <p class="muted" style="margin:0">Upload a markdown or text file, or paste notes. Claude drafts criteria with the reason for each, and lists anything unclear. Nothing is saved until you apply it.</p>
        <label>File <input id="brFile" type="file" accept=".md,.markdown,.txt,text/plain,text/markdown"></label>
        <label>Brief <textarea id="brText" placeholder="e.g. We run youth soccer and want 15+ acres near Redmond or Sammamish…"></textarea></label>
        ${cur ? `<label class="check"><input id="brRevise" type="checkbox" ${revise ? 'checked' : ''}> Revise “${esc(cur.name)}” instead of starting a new project</label>` : ''}
        <button id="brGo" type="button">Draft criteria</button>
        <p id="brMsg" class="msg"></p>
        <div id="brOut"></div>
      </div>`;
    $('brFile').onchange = async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      if (f.size > 500_000) { $('brMsg').className = 'msg err'; $('brMsg').textContent = 'That file is over 500 KB; paste the relevant part instead.'; return; }
      $('brText').value = await f.text();
    };
    $('brGo').onclick = async () => {
      const revise = $('brRevise')?.checked;
      $('brGo').disabled = true; $('brMsg').className = 'msg'; $('brMsg').textContent = 'Drafting… this takes about half a minute.'; $('brOut').innerHTML = '';
      try {
        const d = await api('/api/drafts/from-text', { method: 'POST', body: { text: $('brText').value, projectId: revise ? cur.id : null } });
        source = 'markdown';
        $('brMsg').textContent = `Draft ready (about $${d.costUsd.toFixed(3)}).`;
        showDraft($('brOut'), d, revise ? cur : null);
        refreshSpend();
      } catch (err) { $('brMsg').className = 'msg err'; $('brMsg').textContent = err.message; }
      finally { $('brGo').disabled = false; }
    };
    $('brText').focus();
  }
  $('bBrief').onclick = () => openBrief();
  window.paydirtBuilder = { brief: openBrief };

  // ---------- Interview ----------
  $('bInterview').onclick = () => {
    chat = [];
    panel().innerHTML = `
      <div class="builder">
        <h3>Build criteria by interview</h3>
        <p class="muted" style="margin:0">Claude asks a few questions, one at a time, then drafts criteria for you to review. Say “that's all” anytime to finish early.</p>
        <div id="ivChat" class="chat"></div>
        <form id="ivForm" class="btnRow" style="flex-wrap:nowrap"><input id="ivIn" type="text" style="flex:1" placeholder="Type your answer" autocomplete="off"><button id="ivSend" type="submit">Send</button></form>
        <p id="ivMsg" class="msg"></p>
        <div id="ivOut"></div>
      </div>`;
    const say = async (text) => {
      if (text) chat.push({ role: 'user', content: text });
      renderChat();
      $('ivSend').disabled = true; $('ivMsg').className = 'msg'; $('ivMsg').textContent = 'Thinking…';
      try {
        const r = await api('/api/drafts/interview', { method: 'POST', body: { messages: chat.length ? chat : [{ role: 'user', content: 'Hi, I want to set up a land search.' }] } });
        if (!chat.length) chat.push({ role: 'user', content: 'Hi, I want to set up a land search.' });
        chat.push({ role: 'assistant', content: r.reply });
        renderChat();
        $('ivMsg').textContent = '';
        if (r.done && r.draft) { source = 'interview'; $('ivForm').hidden = true; showDraft($('ivOut'), r.draft, null); }
        refreshSpend();
      } catch (err) {
        $('ivMsg').className = 'msg err'; $('ivMsg').textContent = err.message;
        if (text) chat.pop(); renderChat();
      } finally { $('ivSend').disabled = false; $('ivIn').focus(); }
    };
    $('ivForm').onsubmit = (e) => { e.preventDefault(); const t = $('ivIn').value.trim(); if (!t) return; $('ivIn').value = ''; say(t); };
    say(null);
  };

  function renderChat() {
    // Skip the opening line we send on the person's behalf.
    $('ivChat').innerHTML = chat.filter((m, i) => !(i === 0 && m.content === 'Hi, I want to set up a land search.'))
      .map((m) => `<div class="b ${m.role === 'user' ? 'u' : 'a'}">${esc(m.content)}</div>`).join('');
    $('ivChat').scrollTop = $('ivChat').scrollHeight;
  }

  // ---------- Draft review + apply ----------
  // The draft shows as the same chips as the map bar; clicking one changes the draft before it is saved.
  async function showDraft(el, d, reviseProject) {
    lastDraft = d;
    const { catalog } = await api('/api/projects');
    el.innerHTML = `
      <div class="draft">
        <strong>${esc(d.name)}</strong>
        <p style="margin:0" data-taper="3">${esc(d.summary)}</p>
        <div id="dChips" class="critChips" role="group" aria-label="What this draft looks for"></div>
        <p class="muted" style="margin:0;font-size:12px">Click any of these to change it before you save.</p>
        ${d.questions.length ? `<h2 style="margin:4px 0 0">Questions</h2><ul>${d.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
        ${d.unsupported.length ? `<p class="muted" style="margin:0;font-size:12px">Not something Paydirt can check yet: ${d.unsupported.map(esc).join('; ')}.</p>` : ''}
        ${d.errors.length ? '<p class="warn">Part of the brief couldn\'t be turned into a chip. Check the chips above, or add more detail and draft again.</p>' : ''}
        <label>Project name <input id="dName" type="text" value="${esc(reviseProject ? reviseProject.name : d.name)}"></label>
        <div class="btnRow">
          ${reviseProject ? `<button id="dRevise" type="button">Save as new version of “${esc(reviseProject.name)}”</button>` : ''}
          <button id="dCreate" type="button" class="${reviseProject ? 'secondary' : ''}">Create new project</button>
        </div>
        <p class="muted" style="margin:0;font-size:12px">You can change any of this afterwards from the criteria bar above the map.</p>
        <p id="dMsg" class="msg"></p>
      </div>`;
    window.paydirtTaper.apply(el);
    window.paydirtCriteria.draft($('dChips'), d, catalog);
    const apply = async (asRevision) => {
      $('dMsg').className = 'msg'; $('dMsg').textContent = 'Saving…';
      try {
        const body = { name: $('dName').value.trim() || d.name, brief: d.brief, spec: d.spec, source, changeNote: `Drafted from ${source === 'markdown' ? 'a brief' : 'an interview'}` };
        const saved = asRevision
          ? await window.paydirtCriteria.request(`/api/projects/${reviseProject.id}`, { method: 'PUT', body: { ...body, baseVersion: reviseProject.spec_version } })
          : await api('/api/projects', { method: 'POST', body });
        await window.paydirtProjects.reload(saved.id);
        $('dMsg').textContent = asRevision ? `Saved as version ${saved.spec_version}.` : 'Project created. The list on the left now ranks for it.';
      } catch (err) {
        $('dMsg').className = 'msg err';
        $('dMsg').textContent = err.status === 409
          ? `A teammate changed “${reviseProject.name}” since you started. Your draft is still here: save it as a new project, or draft again to build on their version.`
          : err.message;
      }
    };
    if (reviseProject) $('dRevise').onclick = () => apply(true);
    $('dCreate').onclick = () => apply(false);
  }

  async function refreshSpend() {
    try { const c = await api('/api/config'); setSpend(c.spentUsd); } catch { /* spend display is best-effort */ }
  }
})();
