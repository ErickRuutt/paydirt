/* One score color scale for everything: list chips, map dots, legend and score bars.
   A continuous ramp from bare ground (sand) through ore to deep fir, so a 72 is the same color everywhere. */
(() => {
  const STOPS = [[0, '#D8CDB8'], [35, '#CDB98F'], [50, '#B8902A'], [65, '#5E8A45'], [78, '#2E7A50'], [100, '#1F4D36']];
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  function scoreColor(score) {
    const s = Math.max(0, Math.min(100, Number(score) || 0));
    for (let i = 1; i < STOPS.length; i++) {
      const [s1, c1] = STOPS[i - 1], [s2, c2] = STOPS[i];
      if (s <= s2) {
        const t = (s - s1) / (s2 - s1), a = hex(c1), b = hex(c2);
        return toHex(a.map((v, k) => v + (b[k] - v) * t));
      }
    }
    return STOPS.at(-1)[1];
  }
  // Text on a score color: dark on the light half of the ramp, paper on the dark half.
  function scoreInk(score) {
    const [r, g, b] = hex(scoreColor(score)).map((v) => v / 255);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.42 ? '#2B1D14' : '#F3EDE2';
  }
  // The same ramp as a MapLibre expression and a CSS gradient.
  const mapExpr = (prop = 'score') => ['interpolate', ['linear'], ['get', prop], ...STOPS.flat()];
  const cssGradient = (dir = '90deg') => `linear-gradient(${dir}, ${STOPS.map(([s, c]) => `${c} ${s}%`).join(', ')})`;
  const chip = (score) => `<span class="score" style="background:${scoreColor(score)};color:${scoreInk(score)}">${Math.round(score)}</span>`;

  window.paydirtScore = { STOPS, scoreColor, scoreInk, mapExpr, cssGradient, chip };
  document.documentElement.style.setProperty('--score-gradient', cssGradient());
})();
