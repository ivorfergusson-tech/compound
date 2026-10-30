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

// Straight-line market: demand Qd = 100 + d - P, supply Qs = P - 20 + s. d and s shift the curves (right is positive).
export const equilibrium = (d, s) => ({ p: 60 + (d - s) / 2, q: 40 + (d + s) / 2 });
export const marketGap = (price, d = 0, s = 0) => Math.max(0, 100 + d - price) - Math.max(0, price - 20 + s); // above 0 is excess demand
// New revenue after a percentage price change, for a given PED (a negative number).
export function pedRevenue(pctPrice, ped, p = 10, q = 100) {
  const pctQ = ped * pctPrice;
  return { pctQ, before: p * q, after: p * (1 + pctPrice / 100) * q * (1 + pctQ / 100) };
}

const MAX = 130;
const mx = v => PAD.l + (v / MAX) * (W - PAD.l - PAD.r);
const my = v => H - PAD.b - (v / MAX) * (H - PAD.t - PAD.b);
const seg = (x1, y1, x2, y2, cls) => `<line x1="${mx(x1).toFixed(1)}" y1="${my(y1).toFixed(1)}" x2="${mx(x2).toFixed(1)}" y2="${my(y2).toFixed(1)}" class="${cls}"/>`;
const tag = (x, y, text) => `<text x="${mx(x).toFixed(1)}" y="${my(y).toFixed(1)}" class="ch-label ch-tag">${esc(text)}</text>`;
const demandLine = (d, cls) => seg(Math.max(0, d - 30), Math.min(MAX, 100 + d), 100 + d, 0, cls);
const supplyLine = (s, cls) => { const end = Math.min(MAX, 110 + s); return seg(Math.max(0, s - 20), Math.max(0, 20 - s), end, end + 20 - s, cls); };
const axes = () => `<line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${my(0)}" class="ch-axis"/><line x1="${PAD.l}" y1="${my(0)}" x2="${W - PAD.r}" y2="${my(0)}" class="ch-axis"/>`
  + `<text x="${W - PAD.r}" y="${H - 10}" text-anchor="end" class="ch-label">Quantity</text>`
  + `<text x="12" y="${PAD.t + 4}" class="ch-label" transform="rotate(-90 12 ${PAD.t + 4})" text-anchor="end">Price</text>`;
const legend = (items, dot) => `<figcaption class="legend">${items.map(([cls, name]) => `<span><i class="key ${cls}"></i>${esc(name)}</span>`).join('')}${dot ? `<span><i class="key ch-b"></i>${esc(dot)}</span>` : ''}</figcaption>`;

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

  // Shift demand and supply; the new equilibrium and the old curves show on the diagram.
  market(root, a) {
    const shift = v => (v ? (v > 0 ? `right ${v}` : `left ${-v}`) : 'none');
    const specs = {
      d: { min: -30, max: 30, step: 5, value: a.d ?? 0, fmt: shift },
      s: { min: -30, max: 30, step: 5, value: a.s ?? 0, fmt: shift },
    };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">Demand and supply</h3>`
      + slider('d', 'Shift demand', specs.d) + slider('s', 'Shift supply', specs.s)
      + `<div class="stats">${stat('Equilibrium price', 'p', 'good')}${stat('Equilibrium quantity', 'q')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    const word = (now, was) => (now > was ? 'rises' : now < was ? 'falls' : 'stays the same');
    wire(root, specs, ({ d, s }, set) => {
      const e = equilibrium(d, s), old = equilibrium(0, 0);
      set('p', `£${e.p}`); set('q', e.q);
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Demand and supply diagram with price on the vertical axis and quantity on the horizontal axis">${axes()}`
        + (d ? demandLine(0, 'ch-line ch-c ch-dash') : '') + (s ? supplyLine(0, 'ch-line ch-c ch-dash') : '')
        + demandLine(d, 'ch-line ch-a') + supplyLine(s, 'ch-line ch-b')
        + seg(0, e.p, e.q, e.p, 'ch-grid ch-dash') + seg(e.q, 0, e.q, e.p, 'ch-grid ch-dash')
        + tag(92 + d, 16, 'D') + tag(Math.min(118, 98 + s), 124, 'S')
        + `<circle cx="${mx(e.q)}" cy="${my(e.p)}" r="6" class="ch-dot-a"/></svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-a', 'Demand'], ['ch-b', 'Supply'], ...(d || s ? [['ch-c dash', 'Before the shift']] : [])], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = d || s
        ? `Compared with the start, the equilibrium price ${word(e.p, old.p)} (£${old.p} to £${e.p}) and the quantity ${word(e.q, old.q)} (${old.q} to ${e.q}).`
        : `Demand and supply cross at a price of £${e.p} and a quantity of ${e.q}. Move a slider to shift a curve.`;
    });
  },

  // Hold the price away from equilibrium and see the excess demand or excess supply.
  disequilibrium(root) {
    const specs = { price: { min: 30, max: 90, step: 5, value: 80, fmt: v => `£${v}` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">Equilibrium and disequilibrium</h3>${slider('price', 'Market price', specs.price)}`
      + `<div class="stats">${stat('Quantity demanded', 'qd')}${stat('Quantity supplied', 'qs')}${stat('Gap', 'gap', 'warm')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ price }, set) => {
      const qd = 100 - price, qs = price - 20, gap = marketGap(price);
      set('qd', qd); set('qs', qs);
      set('gap', gap > 0 ? `${gap} short` : gap < 0 ? `${-gap} surplus` : 'none');
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Demand and supply diagram with a line at the market price of £${price}">${axes()}`
        + demandLine(0, 'ch-line ch-a') + supplyLine(0, 'ch-line ch-b') + seg(0, price, 125, price, 'ch-line ch-c ch-dash')
        + `<circle cx="${mx(qd)}" cy="${my(price)}" r="5" class="ch-dot-a"/><circle cx="${mx(qs)}" cy="${my(price)}" r="5" class="ch-dot-b"/></svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-a', 'Demand'], ['ch-b', 'Supply'], ['ch-c dash', 'Market price']], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = gap > 0
        ? `Excess demand of ${gap}: buyers want more than sellers offer, so the price is pushed up towards £60.`
        : gap < 0 ? `Excess supply of ${-gap}: sellers can't sell it all, so the price is pushed down towards £60.`
          : 'Equilibrium: quantity demanded equals quantity supplied, so there is no pressure on the price to change.';
    });
  },

  // What a price change does to quantity and revenue, for a chosen PED.
  ped(root, a) {
    const specs = {
      pc: { min: -30, max: 30, step: 5, value: a.pc ?? 10, fmt: v => `${v > 0 ? '+' : ''}${v}%` },
      e: { min: 0.2, max: 3, step: 0.1, value: a.e ?? 0.5, fmt: v => `−${v.toFixed(1)}` },
    };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">Price elasticity and revenue</h3>`
      + slider('pc', 'Change in price', specs.pc) + slider('e', 'Price elasticity of demand', specs.e)
      + `<div class="stats">${stat('Change in quantity', 'q')}${stat('Revenue before', 'b')}${stat('Revenue after', 'r', 'good')}</div>`
      + `<p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ pc, e }, set) => {
      const r = pedRevenue(pc, -e);
      set('q', `${r.pctQ > 0 ? '+' : ''}${+r.pctQ.toFixed(1)}%`); set('b', `£${r.before}`); set('r', `£${Math.round(r.after)}`);
      const kind = e > 1 ? 'elastic' : e < 1 ? 'inelastic' : 'unit elastic';
      const moved = Math.abs(r.after - r.before) < 0.5 ? 'stays about the same' : r.after > r.before ? 'rises' : 'falls';
      root.querySelector('[data-desc]').textContent = `Starts at a price of £10 and 100 sold. Demand is ${kind}, so ${pc ? `this price change means revenue ${moved}` : 'move the price to see the effect'}.`;
    });
  },
};
