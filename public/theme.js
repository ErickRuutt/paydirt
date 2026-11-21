/* Theme switch shared by every page: Auto follows the system; Light/Dark are saved per browser. */
(() => {
  const btns = [...document.querySelectorAll('[data-theme-set]')];
  const apply = (mode) => {
    if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
    else delete document.documentElement.dataset.theme;
    for (const b of btns) b.setAttribute('aria-pressed', String(b.dataset.themeSet === (mode || 'system')));
    try { if (mode === 'light' || mode === 'dark') localStorage.setItem('paydirt.theme', mode); else localStorage.removeItem('paydirt.theme'); } catch { /* storage blocked */ }
  };
  let saved = null; try { saved = localStorage.getItem('paydirt.theme'); } catch { /* storage blocked */ }
  apply(saved);
  for (const b of btns) b.onclick = () => apply(b.dataset.themeSet);
})();

/* Top bar: Map and Saved follow the project you're in (or last used). */
(() => {
  const q = new URLSearchParams(location.search);
  let id = q.get('project') || q.get('id');
  try { if (id) localStorage.setItem('paydirt.project', id); else id = localStorage.getItem('paydirt.project'); } catch { /* storage blocked */ }
  id = id || '1';
  const m = document.getElementById('navMap'), s = document.getElementById('navSaved');
  if (m) m.href = `map.html?project=${encodeURIComponent(id)}`;
  if (s) s.href = `project.html?id=${encodeURIComponent(id)}`;
})();
