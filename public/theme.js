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
