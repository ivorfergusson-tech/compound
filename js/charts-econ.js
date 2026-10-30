// Economics diagrams for lessons (:::chart <name> {args}). Inline SVG, colours from the theme tokens,
// and every diagram writes a plain-text description of what it shows (for screen readers and for revision).
import { esc } from './util.js';

const W = 340, H = 260, PAD = { l: 44, r: 16, t: 14, b: 40 };

function slider(id, label, { min, max, step, value, fmt }) {
  return `<label class="slider"><span class="slider-top"><span>${esc(label)}</span><output data-out="${id}">${esc(fmt(value))}</output></span>`
    + `<input type="range" data-in="${id}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${esc(label)}"></label>`;
}
const stat = (label, id, tone = '') => `<div class="stat ${tone}"><span>${esc(label)}</span><strong data-v="${id}"></strong></div>`;

function wire(root, specs, draw) {
  const read = () => Object.fromEntries(Object.keys(specs).map(k => [k, parseFloat(root.querySelector(`[data-in="${k}"]`).value)]));
  const update = () => {
    const v = read();
    for (const [k, s] of Object.entries(specs)) root.querySelector(`[data-out="${k}"]`).textContent = s.fmt(v[k]);
    draw(v, (id, text) => { root.querySelector(`[data-v="${id}"]`).textContent = text; });
  };
  root.addEventListener('input', update);
  update();
}

// A bowed-out PPF: a quarter circle of radius r, so the opportunity cost of x rises as more x is made.
export const ppfY = (x, r) => (x >= r ? 0 : r * Math.sqrt(1 - (x / r) ** 2));
// The slope: how much y is given up for one more unit of x at this point (Infinity at the end of the curve).
export const ppfCost = (x, r) => (x >= r ? Infinity : x / Math.sqrt(r * r - x * x));

export const econCharts = {
  ppf(root, a) {
    const xName = a.x || 'Consumer goods', yName = a.y || 'Capital goods';
    const specs = {
      mix: { min: 0, max: 100, step: 5, value: a.mix ?? 50, fmt: v => `${v}% to ${xName.toLowerCase()}` },
      use: { min: 40, max: 100, step: 5, value: a.use ?? 100, fmt: v => `${v}%` },
      grow: { min: 0, max: 30, step: 5, value: a.grow ?? 0, fmt: v => (v ? `+${v}%` : 'none') },
    };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">Production possibility diagram</h3>`
      + slider('mix', 'How resources are split', specs.mix) + slider('use', 'Resources in use', specs.use)
      + slider('grow', 'More or better resources (growth)', specs.grow)
      + `<div class="stats">${stat(xName, 'x')}${stat(yName, 'y')}${stat(`Cost of 1 more ${xName.toLowerCase().replace(/s$/, '')}`, 'oc', 'warm')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ mix, use, grow }, set) => {
      const r0 = 100, r = 100 * (1 + grow / 100), max = 135;
      const th = (mix / 100) * Math.PI / 2;
      const fx = r * Math.sin(th), fy = r * Math.cos(th); // the point on the boundary for this split
      const x = fx * use / 100, y = fy * use / 100;
      const px = v => PAD.l + (v / max) * (W - PAD.l - PAD.r);
      const py = v => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
      const curve = rad => Array.from({ length: 41 }, (_, i) => {
        const t = (i / 40) * Math.PI / 2;
        return `${i ? 'L' : 'M'}${px(rad * Math.sin(t)).toFixed(1)},${py(rad * Math.cos(t)).toFixed(1)}`;
      }).join('');
      const cost = ppfCost(fx, r);
      const onBoundary = use === 100;
      set('x', Math.round(x)); set('y', Math.round(y));
      set('oc', !onBoundary ? 'nothing yet' : Number.isFinite(cost) && cost < 100 ? `${cost.toFixed(1)} ${yName.toLowerCase()}` : 'no more possible');
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Production possibility diagram with ${esc(xName)} on the horizontal axis and ${esc(yName)} on the vertical axis">`
        + `<line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${py(0)}" class="ch-axis"/><line x1="${PAD.l}" y1="${py(0)}" x2="${W - PAD.r}" y2="${py(0)}" class="ch-axis"/>`
        + `<text x="${W - PAD.r}" y="${H - 10}" text-anchor="end" class="ch-label">${esc(xName)}</text>`
        + `<text x="12" y="${PAD.t + 4}" class="ch-label" transform="rotate(-90 12 ${PAD.t + 4})" text-anchor="end">${esc(yName)}</text>`
        + (grow ? `<path d="${curve(r0)}" class="ch-line ch-c ch-dash"/>` : '')
        + `<path d="${curve(r)}" class="ch-line ch-a"/>`
        + `<line x1="${px(x)}" y1="${py(y)}" x2="${px(x)}" y2="${py(0)}" class="ch-grid ch-dash"/><line x1="${px(0)}" y1="${py(y)}" x2="${px(x)}" y2="${py(y)}" class="ch-grid ch-dash"/>`
        + `<circle cx="${px(x)}" cy="${py(y)}" r="6" class="ch-dot-b"/>`
        + `<text x="${px(x) + 9}" y="${py(y) - 8}" class="ch-label ch-tag">${onBoundary ? 'A' : 'U'}</text>`
        + '</svg>';
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}<figcaption class="legend">`
        + `<span><i class="key ch-a"></i>${grow ? 'New boundary' : 'Production possibility boundary'}</span>${grow ? '<span><i class="key ch-c dash"></i>Old boundary</span>' : ''}`
        + '<span><i class="key ch-b"></i>Where the economy is</span></figcaption></figure>';
      const where = onBoundary
        ? `Point A is on the boundary: every resource is in use, so the economy is productively efficient. ${Number.isFinite(cost) && cost < 100 ? `One more unit of ${xName.toLowerCase()} would mean giving up about ${cost.toFixed(1)} ${yName.toLowerCase()}.` : `It is making all the ${xName.toLowerCase()} it can.`}`
        : `Point U is inside the boundary: ${100 - use}% of resources are unemployed. Output of both goods could rise with no opportunity cost by putting them to work.`;
      root.querySelector('[data-desc]').textContent = `${where}${grow ? ` The boundary has shifted out by ${grow}%: the economy can now make more of both goods.` : ''}`;
    });
  },
};
