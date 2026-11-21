/* Theme switch shared by every page: Auto follows the system; Light/Dark are saved per browser. */
const isDarkTheme = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
};
/* The basemap style is chosen when a map is created; maps are not restyled in place. */
window.paydirtBasemapStyle = () => new URL(isDarkTheme() ? 'map-style-dark.json' : 'map-style-light.json', location.href).href;

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
  /* A map keeps the basemap it was created with, so a theme change that flips light/dark reloads map pages. */
  for (const b of btns) b.onclick = () => {
    const wasDark = isDarkTheme();
    apply(b.dataset.themeSet);
    if (isDarkTheme() !== wasDark && (document.getElementById('map') || document.getElementById('pmMap'))) location.reload();
  };
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
