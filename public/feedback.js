/* Feedback pop-up, opened from the sidebar on every page. Posts to /api/feedback
   (saved in the database, then copied to the Notion "Feedback log"). */
(() => {
  const btn = document.getElementById('feedbackBtn');
  if (!btn) return;
  const KINDS = [['idea', 'Idea'], ['problem', 'Problem'], ['question', 'Question'], ['data', 'Data issue']];
  const dlg = document.createElement('dialog');
  dlg.id = 'feedbackModal';
  dlg.setAttribute('aria-labelledby', 'fbTitle');
  dlg.innerHTML = `
    <form method="dialog" class="fbForm" novalidate>
      <div class="fbHead"><h2 id="fbTitle" class="title"><i class="tilt" aria-hidden="true"></i>feedback</h2>
        <button type="button" class="ghost" data-close title="Close (Esc)">Close ✕</button></div>
      <p class="lede">What's working, what's confusing, what's missing. It goes straight to the build plan.</p>
      <fieldset class="fbKinds"><legend class="lbl">Type</legend>
        ${KINDS.map(([v, t], i) => `<label><input type="radio" name="fbKind" value="${v}" ${i === 0 ? 'checked' : ''}><span>${t}</span></label>`).join('')}</fieldset>
      <label class="fbMsg"><span class="lbl">Your feedback</span>
        <textarea id="fbText" rows="6" maxlength="10000" placeholder="e.g. On the map, I couldn't tell which parcels already have a building."></textarea></label>
      <p class="muted small" id="fbWhere"></p>
      <div class="fbFoot"><p id="fbMsg" class="msg" role="status"></p><button type="submit" id="fbSend">Send feedback</button></div>
    </form>`;
  document.body.append(dlg);
  const $ = (s) => dlg.querySelector(s);
  const page = () => (location.pathname.replace(/^\//, '') || 'index.html') + location.search;
  const say = (t, err) => { $('#fbMsg').className = err ? 'msg err' : 'msg'; $('#fbMsg').textContent = t; };

  btn.onclick = () => {
    say('');
    $('#fbWhere').textContent = `Sent with your name and this page (${page() || 'index.html'}).`;
    dlg.showModal();
    $('#fbText').focus();
  };
  $('[data-close]').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  $('form').onsubmit = async (e) => {
    e.preventDefault();
    const message = $('#fbText').value.trim();
    if (!message) { say('Write something first.', true); $('#fbText').focus(); return; }
    $('#fbSend').disabled = true; say('Sending…');
    try {
      const token = await window.paydirtAuth.token();
      const res = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, kind: dlg.querySelector('input[name=fbKind]:checked')?.value, page: page() }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      $('#fbText').value = '';
      say('Thanks. Logged for review.');
      setTimeout(() => { if (dlg.open) dlg.close(); }, 1400);
    } catch (err) { say(err.message, true); }
    finally { $('#fbSend').disabled = false; }
  };
})();
