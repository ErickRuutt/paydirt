/* Change log: public/changelog.json, newest first. One entry per push: what changed and why it makes Paydirt better.
   An entry is written before its push ("pending") and marked "live" once it is out. */
(async () => {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = document.getElementById('changes');
  try {
    const list = await (await fetch('changelog.json', { cache: 'no-cache' })).json();
    const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    el.innerHTML = list.map((e) => `
      <section class="block">
        <div class="block-head"><h2 class="title"><i class="tilt" aria-hidden="true"></i>${esc(e.title)}</h2>
          <span class="lblish">${esc(day(e.date))} · ${e.status === 'live' ? 'Live' : 'Not live yet'}</span></div>
        <ul class="changeList">${e.changes.map((c) => `<li><p class="what">${esc(c.what)}</p><p class="why"><span class="lblish">Why</span> ${esc(c.why)}</p></li>`).join('')}</ul>
      </section>`).join('');
  } catch { el.innerHTML = '<p class="msg err">The change log could not be loaded.</p>'; }
})();
