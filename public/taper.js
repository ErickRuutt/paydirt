/* Tapered text: long blocks show their first few lines and fade out at the bottom edge.
   - The opening lines carry the point (write summary first), so the taper rarely hides what matters.
   - "Show more" expands in place; the choice sticks while the panel is open.
   - Hover is a preview, never the only way in: on a mouse, hovering lifts the fade a little;
     single-line truncations get a native tooltip with the full text.
   Usage: add data-taper="3" (lines) to any element; call paydirtTaper.apply(root) after rendering. */
(() => {
  function apply(root = document) {
    for (const el of root.querySelectorAll('[data-taper]:not([data-taper-ready])')) {
      el.dataset.taperReady = '1';
      const lines = Number(el.dataset.taper) || 3;
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
      const max = Math.round(lh * lines);
      if (el.scrollHeight <= max + 4) continue; // short enough: leave it alone
      el.classList.add('taper', 'tapered');
      el.style.setProperty('--taper-max', `${max}px`);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'taperToggle';
      btn.textContent = 'Show more';
      btn.setAttribute('aria-expanded', 'false');
      btn.onclick = () => {
        const open = el.classList.toggle('tapered') === false;
        btn.textContent = open ? 'Show less' : 'Show more';
        btn.setAttribute('aria-expanded', String(open));
      };
      el.after(btn);
    }
    // Single-line ellipses: full text on hover (and for screen readers via the element itself).
    for (const el of root.querySelectorAll('.t, .ellipsis')) {
      if (!el.title && el.scrollWidth > el.clientWidth) el.title = el.textContent.trim();
    }
  }
  window.paydirtTaper = { apply };
})();
