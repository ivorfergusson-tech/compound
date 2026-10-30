// Economics diagrams for lessons (:::chart <name> {args}). Inline SVG, colours from the theme tokens,
// and every diagram writes a plain-text description of what it shows (for screen readers and for revision).
import { esc } from './util.js';
import { lineChart } from './charts.js';

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
const axes = (xName = 'Quantity', yName = 'Price') => `<line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${my(0)}" class="ch-axis"/><line x1="${PAD.l}" y1="${my(0)}" x2="${W - PAD.r}" y2="${my(0)}" class="ch-axis"/>`
  + `<text x="${W - PAD.r}" y="${H - 10}" text-anchor="end" class="ch-label">${esc(xName)}</text>`
  + `<text x="12" y="${PAD.t + 4}" class="ch-label" transform="rotate(-90 12 ${PAD.t + 4})" text-anchor="end">${esc(yName)}</text>`;
const legend = (items, dot) => `<figcaption class="legend">${items.map(([cls, name]) => `<span><i class="key ${cls}"></i>${esc(name)}</span>`).join('')}${dot ? `<span><i class="key ch-b"></i>${esc(dot)}</span>` : ''}</figcaption>`;

// Short-run costs for output q: fixed cost fc, and variable cost scaled by w (the price of the variable factor).
export function costsAt(q, fc, w) {
  const tvc = w * (0.02 * q ** 3 - 0.4 * q ** 2 + 4 * q);
  return { tc: fc + tvc, afc: fc / q, avc: tvc / q, atc: (fc + tvc) / q, mc: w * (0.06 * q ** 2 - 0.8 * q + 4) };
}
export function lowestAtc(fc, w) {
  let best = 1;
  for (let q = 1; q <= 25; q += 0.01) if (costsAt(q, fc, w).atc < costsAt(best, fc, w).atc) best = q;
  return best;
}

// One firm's costs for the market structure diagrams: TC = 900 + 20q + 0.25q², so MC cuts ATC at its lowest (q 60, £50).
export const firmAtc = q => 900 / q + 20 + 0.25 * q;
export const firmMc = q => 20 + 0.5 * q;
// Perfect competition: price P is given, and the firm makes the output where MC = MR = P.
export function priceTaker(price) {
  const q = (price - 20) / 0.5, atc = firmAtc(q);
  return { q, atc, profit: (price - atc) * q };
}
// A price maker facing AR = a - 0.5q, so MR = a - q. MR = MC gives the output; P = MC gives the allocatively efficient one.
export function priceMaker(a) {
  const q = (a - 20) / 1.5, p = a - 0.5 * q, atc = firmAtc(q);
  return { q, p, atc, profit: (p - atc) * q, efficientQ: a - 20, efficientP: (a + 20) / 2 };
}
// Kinked demand: the kink is at £70 and 50 units. AR = 95 - 0.5q above it, AR = 120 - q below it, so MR jumps from 45 to 20 at the kink. MC = c + 0.4q.
export function kinked(c) {
  const mc = c + 20;
  if (mc >= 20 && mc <= 45) return { q: 50, p: 70, inGap: true };
  const q = mc > 45 ? (95 - c) / 1.4 : (120 - c) / 2.4;
  return { q, p: mc > 45 ? 95 - 0.5 * q : 120 - q, inGap: false };
}
// Welfare in the market D: P = 100 - Q, S: P = 20 + Q when output is held at q (40 is the competitive output).
export function surplus(q) {
  const p = 100 - q, cost = 20 + q;
  return { p, cs: q * q / 2, ps: (p - cost) * q + q * q / 2, dwl: (40 - q) ** 2 };
}
// Third-degree price discrimination with constant MC c. Market A: P = 100 - q. Market B: P = 50 - 0.5q (more elastic).
export function discrim(c) {
  const qA = (100 - c) / 2, pA = 100 - qA, qB = 50 - c, pB = 50 - 0.5 * qB;
  const single = (200 + 3 * c) / 6, both = (single - c) * (200 - 3 * single), onlyA = (pA - c) * qA;
  return { pA, qA, pB, qB, profit: (pA - c) * qA + (pB - c) * qB, singleProfit: Math.max(both, onlyA), singlePrice: both >= onlyA ? single : pA };
}
// Labour market: MRP (demand) W = 110 - L, labour supply W = 20 + L, so the competitive outcome is £65 and 45 workers.
export function labourFloor(w) {
  const floor = Math.max(w, 65), employed = 110 - floor, willing = floor - 20;
  return { wage: floor, employed, willing, unemployed: willing - employed };
}
// Monopsony: supply is the average cost of labour, and MCL = 20 + 2L, so it hires where MCL = MRP: 30 workers at £50.
// A wage floor f (minimum wage or union) up to £65 raises pay AND jobs; above £65 jobs fall along MRP.
export function monopsony(f = 0) {
  const wage = Math.max(f, 50);
  return { wage, employed: wage <= 65 ? wage - 20 : 110 - wage };
}
// Lorenz curve y = x^k has Gini (k - 1) / (k + 1), so a Gini g gives k = (1 + g) / (1 - g).
export const lorenzShare = (x, g) => x ** ((1 + g) / (1 - g));
// Externalities in the market MPB: P = 100 - Q, MPC: P = 20 + Q (market outcome £60 and 40).
// An external cost lifts MSC above MPC, and an external benefit lifts MSB above MPB. kind says which curve moves and which way.
const EXTERNAL = {
  'negative-production': { c: 1, b: 0, label: 'External cost of production' },
  'positive-production': { c: -1, b: 0, label: 'External benefit of production' },
  'negative-consumption': { c: 0, b: -1, label: 'External cost of consumption' },
  'positive-consumption': { c: 0, b: 1, label: 'External benefit of consumption' },
};
export function externality(kind, e) {
  const k = EXTERNAL[kind], c = k.c * e, b = k.b * e, q = 40 + (b - c) / 2;
  return { c, b, q, p: 20 + c + q, marketQ: 40, loss: e * e / 4 };
}
// A tax on a negative production externality of £20: the optimum is 30 units, so a £20 tax corrects it and a bigger one overshoots.
export function pigouTax(tax) {
  const q = 40 - tax / 2;
  return { q, price: 60 + tax / 2, revenue: tax * q, loss: (q - 30) ** 2 };
}
// A weighted price index, base 100: each item's price change counts in proportion to its weight.
export const BASKET = [{ id: 'food', name: 'Food', weight: 0.2 }, { id: 'energy', name: 'Energy', weight: 0.1 }, { id: 'other', name: 'Everything else', weight: 0.7 }];
export const basketIndex = rises => 100 + BASKET.reduce((t, b) => t + b.weight * rises[b.id], 0);
// AD: P = 130 + d - Y. SRAS: P = Y - 30 + s (s is higher costs, so it moves SRAS up and left). LRAS is vertical at 80 + l.
export function adas(d = 0, s = 0, l = 0) {
  const y = 80 + (d - s) / 2, p = 50 + (d + s) / 2, capacity = 80 + l;
  return { y, p, capacity, gap: y - capacity };
}
export const multiplierK = mpc => 1 / (1 - mpc);
// Spending after n rounds of an injection j: each round is mpc times the last.
export const multiplierRounds = (j, mpc, n) => j * (1 - mpc ** n) / (1 - mpc);
// The Keynesian AS curve: flat at £40 up to Y = 70, rising, and vertical at full capacity Y = 100.
export const keynesAS = y => (y <= 70 ? 40 : 30 + 300 / (100 - y));
export function keynesAt(a) {
  if (a - 70 <= 40) return { y: a - 40, p: 40, zone: 'flat' };
  let lo = 70, hi = 99.9;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (keynesAS(m) < a - m) lo = m; else hi = m; }
  return { y: lo, p: keynesAS(lo), zone: lo > 92 ? 'capacity' : 'rising' };
}
// The economic cycle: actual output swings round a rising trend. t runs 0 to 100, and one full cycle is 50.
export const trendAt = t => 40 + 0.5 * t;
export const actualAt = t => trendAt(t) + 12 * Math.sin((t / 50) * 2 * Math.PI);
export function cyclePhase(t) {
  const f = ((t % 50) + 50) % 50;
  if (f === 12.5) return 'Peak (boom)';
  if (f === 37.5) return 'Trough';
  return f < 12.5 || f > 37.5 ? 'Recovery' : 'Downturn';
}
// Short-run Phillips curve through the natural rate of 5%: inflation = expected + 30/u - 6.
export const NATURAL_RATE = 5;
export const phillips = (u, expected) => expected + 30 / u - 6;
// Fisher: MV = PQ, so P = MV / Q.
export const fisherP = (m, v, q) => (m * v) / q;
// A bond's yield: the fixed coupon as a percentage of its market price.
export const bondYield = (coupon, price) => (coupon / price) * 100;
// UK income tax for 2026 to 2027 (England, Wales and NI), up to £100,000, where the personal allowance starts to taper.
export function ukIncomeTax(income) {
  const basic = Math.max(0, Math.min(income, 50270) - 12570), higher = Math.max(0, income - 50270);
  const tax = basic * 0.2 + higher * 0.4;
  return { tax, average: income ? (tax / income) * 100 : 0, marginal: income > 50270 ? 40 : income > 12570 ? 20 : 0 };
}
// The budget deficit, as % of GDP: the structural part stays at any point in the cycle, and the cyclical part moves with the output gap.
export const budgetDeficit = (structural, gap) => ({ cyclical: -0.5 * gap, total: structural - 0.5 * gap });
const curve = (f, from, to, cls) => `<polyline fill="none" class="${cls}" points="${Array.from({ length: 41 }, (_, i) => from + (to - from) * i / 40).map(q => `${mx(q).toFixed(1)},${my(f(q)).toFixed(1)}`).join(' ')}"/>`;
const box = (x1, y1, x2, y2, cls) => `<rect x="${mx(Math.min(x1, x2)).toFixed(1)}" y="${my(Math.max(y1, y2)).toFixed(1)}" width="${Math.abs(mx(x2) - mx(x1)).toFixed(1)}" height="${Math.abs(my(y2) - my(y1)).toFixed(1)}" class="${cls}"/>`;
const money = v => `${v < 0 ? '−' : ''}£${Math.abs(Math.round(v)).toLocaleString('en-GB')}`;

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

  // Short-run cost curves: MC cuts AVC and ATC at their lowest points.
  perfect(root, a) {
    const specs = { price: { min: 30, max: 80, step: 5, value: a.price ?? 70, fmt: v => `£${v}` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">The firm in perfect competition</h3>${slider('price', 'Market price', specs.price)}`
      + `<div class="stats">${stat('Output (MC = MR)', 'q')}${stat('ATC at that output', 'atc')}${stat('Profit', 'profit', 'good')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ price }, set) => {
      const { q, atc, profit } = priceTaker(price), normal = Math.abs(profit) < 1;
      set('q', q); set('atc', `£${atc.toFixed(2)}`); set('profit', money(profit));
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Firm diagram. Price is a horizontal line at £${price}, which is also marginal revenue. The firm makes ${q} units, where marginal cost equals price.">${axes()}`
        + (normal ? '' : box(0, price, q, atc, profit > 0 ? 'ch-gain' : 'ch-loss'))
        + curve(firmAtc, 10, 118, 'ch-line ch-a') + curve(firmMc, 0, 118, 'ch-line ch-c') + seg(0, price, 125, price, 'ch-line ch-b')
        + `<circle cx="${mx(q)}" cy="${my(price)}" r="5" class="ch-dot-b"/></svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-b', 'P = AR = MR'], ['ch-c', 'MC'], ['ch-a', 'ATC']], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = normal
        ? 'Long-run equilibrium: price equals the lowest ATC and MC, so the firm makes normal profit. There is no reason to enter or leave.'
        : profit > 0 ? `Abnormal profit of ${money(profit)} (the shaded box). In the long run new firms enter, supply rises and the price falls to £50.`
          : `A loss of ${money(-profit)} (the shaded box). In the long run firms leave, supply falls and the price rises to £50.`;
    });
  },
  pricemaker(root, a) {
    const mono = a.model !== 'monopolistic', base = mono ? 110 : 72;
    const specs = { a: { min: mono ? 90 : 66, max: mono ? 130 : 110, step: mono ? 5 : 1, value: a.a ?? (mono ? 110 : 90), fmt: v => `${v >= base ? '+' : ''}${v - base}` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">${mono ? 'The monopolist' : 'The firm in monopolistic competition'}</h3>${slider('a', 'Strength of demand for this firm', specs.a)}`
      + `<div class="stats">${stat('Output (MR = MC)', 'q')}${stat('Price', 'p')}${stat('Profit', 'profit', 'good')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ a: top }, set) => {
      const r = priceMaker(top), normal = Math.abs(r.profit) < 15;
      set('q', r.q.toFixed(0)); set('p', `£${r.p.toFixed(0)}`); set('profit', normal ? '£0' : money(r.profit));
      const end = Math.min(125, top / 0.5), mrEnd = Math.min(125, top);
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Firm diagram with a downward-sloping demand curve and a steeper marginal revenue curve. The firm makes ${r.q.toFixed(0)} units, where marginal revenue equals marginal cost, and charges £${r.p.toFixed(0)}.">${axes()}`
        + (normal ? '' : box(0, r.p, r.q, r.atc, r.profit > 0 ? 'ch-gain' : 'ch-loss'))
        + curve(firmAtc, 10, 118, 'ch-line ch-a') + curve(firmMc, 0, 118, 'ch-line ch-c')
        + seg(0, top, end, top - 0.5 * end, 'ch-line ch-b') + seg(0, top, mrEnd, top - mrEnd, 'ch-line ch-b ch-dash')
        + seg(r.q, 0, r.q, r.p, 'ch-line ch-dash ch-guide') + `<circle cx="${mx(r.q)}" cy="${my(r.p)}" r="5" class="ch-dot-b"/></svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-b', 'AR (demand)'], ['ch-b dash', 'MR'], ['ch-c', 'MC'], ['ch-a', 'ATC']], '')}</figure>`;
      const after = mono ? 'Barriers to entry can protect this in the long run.' : 'In the long run this attracts new firms, which takes demand from this firm until AR just touches ATC.';
      const lossAfter = mono ? 'A monopolist in this position would leave the market in the long run.' : 'In the long run some firms leave, so demand for this firm rises until AR just touches ATC.';
      root.querySelector('[data-desc]').textContent = (normal
        ? `Normal profit: AR just touches ATC, at about £${r.p.toFixed(0)} and ${r.q.toFixed(0)} units.${mono ? '' : ' This is the long-run equilibrium.'} The firm still isn't at the lowest ATC, so it has excess capacity.`
        : r.profit > 0 ? `Abnormal profit of ${money(r.profit)} (the shaded box). ${after}` : `A loss of ${money(-r.profit)} (the shaded box). ${lossAfter}`)
        + ` Price is above MC: where P = MC the output would be ${r.efficientQ} at £${r.efficientP}.`;
    });
  },
  kinked(root, a) {
    const specs = { c: { min: 0, max: 40, step: 5, value: a.c ?? 10, fmt: v => `+£${v}` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">The kinked demand curve</h3>${slider('c', 'Rise in marginal cost', specs.c)}`
      + `<div class="stats">${stat('Price', 'p')}${stat('Output', 'q')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ c }, set) => {
      const r = kinked(c);
      set('p', `£${r.p.toFixed(0)}`); set('q', r.q.toFixed(0));
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kinked demand curve with a kink at £70 and 50 units. Marginal revenue has a vertical gap below the kink, and marginal cost ${r.inGap ? 'passes through the gap' : 'misses the gap'}.">${axes()}`
        + seg(0, 95, 50, 70, 'ch-line ch-b') + seg(50, 70, 110, 10, 'ch-line ch-b')
        + seg(0, 95, 50, 45, 'ch-line ch-b ch-dash') + seg(50, 45, 50, 20, 'ch-line ch-b ch-dash') + seg(50, 20, 60, 0, 'ch-line ch-b ch-dash')
        + curve(q => c + 0.4 * q, 0, 110, 'ch-line ch-c') + `<circle cx="${mx(r.q)}" cy="${my(r.p)}" r="5" class="ch-dot-b"/></svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-b', 'AR (demand)'], ['ch-b dash', 'MR'], ['ch-c', 'MC']], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = r.inGap
        ? 'MC passes through the gap in MR, so the firm keeps the price at £70 and output at 50. This is why prices in an oligopoly can be stable.'
        : 'MC has gone above the gap in MR, so this cost rise is large enough for the firm to raise its price.';
    });
  },
  surplus(root, a) {
    const specs = { q: { min: 20, max: 40, step: 5, value: a.q ?? 40, fmt: v => `${v}` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">Consumer and producer surplus</h3>${slider('q', 'Output', specs.q)}`
      + `<div class="stats">${stat('Consumer surplus', 'cs', 'good')}${stat('Producer surplus', 'ps')}${stat('Deadweight loss', 'dwl', 'warm')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    const tri = (pts, cls) => `<polygon class="${cls}" points="${pts.map(([x, y]) => `${mx(x).toFixed(1)},${my(y).toFixed(1)}`).join(' ')}"/>`;
    wire(root, specs, ({ q }, set) => {
      const r = surplus(q), mc = 20 + q;
      set('cs', money(r.cs)); set('ps', money(r.ps)); set('dwl', money(r.dwl));
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Demand and supply diagram. Output is ${q}, the price is £${r.p}, consumer surplus is the area above the price and producer surplus the area below it${q < 40 ? ', with a deadweight loss triangle between that output and 40' : ''}.">${axes()}`
        + tri([[0, 100], [0, r.p], [q, r.p]], 'ch-gain') + tri([[0, r.p], [q, r.p], [q, mc], [0, 20]], 'ch-prod')
        + (q < 40 ? tri([[q, r.p], [q, mc], [40, 60]], 'ch-loss') : '')
        + demandLine(0, 'ch-line ch-a') + supplyLine(0, 'ch-line ch-b') + seg(0, r.p, q, r.p, 'ch-line ch-dash ch-guide') + `</svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-a', 'Demand'], ['ch-b', 'Supply (MC)']], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = q === 40
        ? 'At the competitive output, price is £60 and total welfare is as large as it can be: £1,600 shared between consumers and producers.'
        : `Holding output at ${q} raises the price to £${r.p}. Consumers lose, producers gain part of what consumers lose, and ${money(r.dwl)} of welfare is lost to everyone.`;
    });
  },
  discrim(root, a) {
    const specs = { c: { min: 10, max: 30, step: 5, value: a.c ?? 20, fmt: v => `£${v}` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">Price discrimination in two markets</h3>${slider('c', 'Marginal cost', specs.c)}`
      + `<div class="stats">${stat('Price in A (less elastic)', 'pa')}${stat('Price in B (more elastic)', 'pb')}${stat('Extra profit', 'gain', 'good')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    const panel = (name, top, slope, q, p, c) => `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Market ${name}: where marginal revenue equals marginal cost of £${c}, the firm sells ${q} units at £${p}.">${axes()}`
      + seg(0, top, top / slope, 0, 'ch-line ch-b') + seg(0, top, top / slope / 2, 0, 'ch-line ch-b ch-dash') + seg(0, c, 125, c, 'ch-line ch-c')
      + seg(q, 0, q, p, 'ch-line ch-dash ch-guide') + `<circle cx="${mx(q)}" cy="${my(p)}" r="5" class="ch-dot-b"/></svg>`;
    wire(root, specs, ({ c }, set) => {
      const r = discrim(c);
      set('pa', `£${r.pA.toFixed(0)}`); set('pb', `£${r.pB.toFixed(0)}`); set('gain', money(r.profit - r.singleProfit));
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart"><div class="ch-pair"><div><strong>Market A</strong>${panel('A', 100, 1, r.qA, r.pA, c)}</div><div><strong>Market B</strong>${panel('B', 50, 0.5, r.qB, r.pB, c)}</div></div>${legend([['ch-b', 'AR'], ['ch-b dash', 'MR'], ['ch-c', 'MC']], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = `Where MR = MC in each market, the firm sells ${r.qA} units at £${r.pA} in A and ${r.qB} units at £${r.pB} in B. Profit is ${money(r.profit)}, against ${money(r.singleProfit)} with one price (£${r.singlePrice.toFixed(2)}).`;
    });
  },
  labour(root, a) {
    const mono = a.model === 'monopsony';
    const specs = { w: { min: mono ? 50 : 65, max: mono ? 80 : 85, step: 5, value: a.w ?? (mono ? 50 : 65), fmt: v => `£${v}` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">${mono ? 'A monopsony labour market' : 'A competitive labour market'}</h3>${slider('w', 'Wage floor (minimum wage or union)', specs.w)}`
      + `<div class="stats">${stat('Wage', 'wage')}${stat('Workers employed', 'emp', 'good')}${stat(mono ? 'Change in jobs' : 'Unemployed', 'gap', 'warm')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ w }, set) => {
      const r = mono ? monopsony(w) : labourFloor(w), gap = mono ? r.employed - 30 : r.unemployed;
      set('wage', `£${r.wage}`); set('emp', r.employed); set('gap', mono ? `${gap > 0 ? '+' : ''}${gap}` : gap);
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Labour market diagram with wage on the vertical axis. At a wage of £${r.wage}, ${r.employed} workers are employed.">${axes('Workers', 'Wage')}`
        + seg(0, 110, 110, 0, 'ch-line ch-a') + seg(0, 20, 110, 130, 'ch-line ch-b')
        + (mono ? seg(0, 20, 55, 130, 'ch-line ch-b ch-dash') : '')
        + seg(0, r.wage, 125, r.wage, 'ch-line ch-c') + `<circle cx="${mx(r.employed)}" cy="${my(r.wage)}" r="5" class="ch-dot-b"/></svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-a', 'Demand (MRP)'], ['ch-b', mono ? 'Supply (ACL)' : 'Supply'], ...(mono ? [['ch-b dash', 'MCL']] : []), ['ch-c', 'Wage']], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = mono
        ? (w === 50 ? 'The monopsonist hires where MCL = MRP: 30 workers, and it pays only £50, the wage on the supply curve. A competitive market would give £65 and 45 workers.'
          : w <= 65 ? `A floor of £${w} raises pay AND employment, to ${r.employed} workers, because hiring one more no longer pushes up the wage of everyone else.`
            : `At £${w} the floor is above the competitive wage, so employment falls back along MRP to ${r.employed}.`)
        : (w === 65 ? 'Equilibrium: £65 and 45 workers. Everyone who wants to work at this wage has a job.'
          : `A floor of £${w} is above equilibrium. Firms hire ${r.employed}, while ${r.willing} want to work, so ${r.unemployed} are unemployed.`);
    });
  },
  lorenz(root, a) {
    const specs = { g: { min: 0.1, max: 0.7, step: 0.05, value: a.g ?? 0.3, fmt: v => v.toFixed(2) } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">The Lorenz curve</h3>${slider('g', 'Gini coefficient', specs.g)}`
      + `<div class="stats">${stat('Share held by the poorest half', 'low', 'good')}${stat('Share held by the richest tenth', 'top', 'warm')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ g }, set) => {
      const low = lorenzShare(0.5, g) * 100, top = (1 - lorenzShare(0.9, g)) * 100;
      set('low', `${low.toFixed(0)}%`); set('top', `${top.toFixed(0)}%`);
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Lorenz curve below the 45 degree line of equality. With a Gini of ${g.toFixed(2)}, the poorest half have ${low.toFixed(0)} percent.">${axes('Share of people', 'Share of income')}`
        + seg(0, 0, 125, 125, 'ch-line ch-c ch-dash') + curve(q => lorenzShare(q / 125, g) * 125, 0, 125, 'ch-line ch-a') + `</svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-c dash', 'Line of perfect equality'], ['ch-a', 'Lorenz curve']], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = `The further the curve bows away from the line of equality, the higher the Gini and the more unequal the distribution. This is a smooth model curve, so the shares are illustrative.`;
    });
  },
  externality(root, a) {
    const kind = a.kind ?? 'negative-production', info = EXTERNAL[kind];
    const specs = { e: { min: 0, max: 40, step: 10, value: a.e ?? 20, fmt: v => `£${v}` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">${esc(info.label)}</h3>${slider('e', 'Size of the external effect', specs.e)}`
      + `<div class="stats">${stat('Market output', 'm')}${stat('Social optimum', 'q', 'good')}${stat('Welfare loss', 'loss', 'warm')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ e }, set) => {
      const r = externality(kind, e), over = r.q < 40, none = e === 0;
      const msc = q => 20 + r.c + q, msb = q => 100 + r.b - q;
      set('m', '40'); set('q', r.q); set('loss', money(r.loss));
      const from = Math.max(0, r.b - 30), mscFrom = Math.max(0, -20 - r.c);
      const pts = [[r.q, r.p], [40, 60 + r.b], [40, 60 + r.c]].map(([x, y]) => `${mx(x).toFixed(1)},${my(y).toFixed(1)}`).join(' ');
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost and benefit diagram. The market makes 40 units, where private benefit equals private cost. The social optimum is ${r.q} units, where social benefit equals social cost.">${axes('Quantity', 'Cost and benefit')}`
        + (none ? '' : `<polygon class="ch-loss" points="${pts}"/>`)
        + seg(0, 100, 100, 0, 'ch-line ch-a') + seg(0, 20, 110, 130, 'ch-line ch-b')
        + (r.b ? seg(from, msb(from), 100 + r.b, 0, 'ch-line ch-a ch-dash') : '')
        + (r.c ? seg(mscFrom, msc(mscFrom), 110 - r.c, 130, 'ch-line ch-b ch-dash') : '')
        + `<circle cx="${mx(40)}" cy="${my(60)}" r="5" class="ch-dot-b"/><circle cx="${mx(r.q)}" cy="${my(r.p)}" r="5" class="ch-dot-a"/></svg>`;
      const curves = [['ch-a', 'MPB'], ['ch-b', 'MPC'], ...(r.b ? [['ch-a dash', 'MSB']] : []), ...(r.c ? [['ch-b dash', 'MSC']] : [])];
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend(curves, '')}</figure>`;
      root.querySelector('[data-desc]').textContent = none
        ? 'With no external effect, private and social curves are the same, so the market makes the socially best output.'
        : `The market makes 40 units, where MPB = MPC, but the social optimum is ${r.q}, where MSB = MSC. So the market ${over ? 'over-produces' : 'under-produces'} by ${Math.abs(40 - r.q)} units, and the shaded triangle is a welfare loss of ${money(r.loss)}.`;
    });
  },
  pigou(root, a) {
    const specs = { t: { min: 0, max: 40, step: 5, value: a.t ?? 0, fmt: v => `£${v}` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">Taxing a negative externality</h3>${slider('t', 'Tax per unit', specs.t)}`
      + `<div class="stats">${stat('Output', 'q')}${stat('Tax revenue', 'rev', 'good')}${stat('Welfare loss left', 'loss', 'warm')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ t }, set) => {
      const r = pigouTax(t);
      set('q', r.q); set('rev', money(r.revenue)); set('loss', money(r.loss));
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost and benefit diagram with a £20 external cost and a tax of £${t} per unit. Output is ${r.q}, and the social optimum is 30.">${axes('Quantity', 'Cost and benefit')}`
        + seg(0, 100, 100, 0, 'ch-line ch-a') + seg(0, 20, 110, 130, 'ch-line ch-b') + seg(0, 40, 90, 130, 'ch-line ch-b ch-dash')
        + (t ? seg(0, 20 + t, 110 - t, 130, 'ch-line ch-c') : '')
        + `<circle cx="${mx(r.q)}" cy="${my(r.price)}" r="5" class="ch-dot-b"/></svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-a', 'MPB'], ['ch-b', 'MPC'], ['ch-b dash', 'MSC'], ['ch-c', 'MPC + tax']], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = t === 20
        ? 'The tax equals the £20 external cost, so firms pay the full social cost and output falls to the social optimum of 30. The externality is internalised.'
        : t < 20 ? `A tax of £${t} is below the £20 external cost, so output of ${r.q} is still above the optimum of 30.`
          : `A tax of £${t} is above the £20 external cost, so output of ${r.q} is below the optimum. Too big a tax is government failure.`;
    });
  },
  basket(root, a) {
    const specs = Object.fromEntries(BASKET.map(b => [b.id, { min: 0, max: 30, step: 1, value: a[b.id] ?? 0, fmt: v => `+${v}%` }]));
    root.innerHTML = `<div class="calc"><h3 class="calc-title">A weighted price index</h3>`
      + BASKET.map(b => slider(b.id, `${b.name} (weight ${b.weight * 100}%)`, specs[b.id])).join('')
      + `<div class="stats">${stat('Index (base year = 100)', 'i')}${stat('Inflation', 'r', 'warm')}</div>`
      + `<p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, (v, set) => {
      const i = basketIndex(v);
      set('i', i.toFixed(1)); set('r', `${(i - 100).toFixed(1)}%`);
      root.querySelector('[data-desc]').textContent = 'Each price rise counts in line with its weight, so a big rise in a small part of the basket adds less than a small rise in a large part.';
    });
  },
  circular(root, a) {
    const specs = { j: { min: 50, max: 150, step: 10, value: a.j ?? 100, fmt: v => `£${v}bn` }, w: { min: 50, max: 150, step: 10, value: a.w ?? 100, fmt: v => `£${v}bn` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">The circular flow of income</h3>${slider('j', 'Injections (I + G + X)', specs.j)}${slider('w', 'Withdrawals (S + T + M)', specs.w)}`
      + `<div class="stats">${stat('Gap (J − W)', 'gap')}${stat('National income', 'dir', 'good')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    const svg = `<svg viewBox="0 0 ${W} 130" role="img" aria-label="Circular flow diagram. Households supply factors to firms and receive income, then spend it on the goods firms make. Saving, tax and imports leave the flow, and investment, government spending and exports enter it.">`
      + `<rect x="12" y="55" width="96" height="60" rx="8" class="ch-node"/><rect x="232" y="55" width="96" height="60" rx="8" class="ch-node"/>`
      + `<text x="60" y="90" text-anchor="middle" class="ch-label">Households</text><text x="280" y="90" text-anchor="middle" class="ch-label">Firms</text>`
      + `<line x1="108" y1="68" x2="228" y2="68" class="ch-line ch-a"/><polygon points="232,68 222,63 222,73" class="ch-head-a"/><text x="170" y="60" text-anchor="middle" class="ch-label">Spending</text>`
      + `<line x1="232" y1="102" x2="112" y2="102" class="ch-line ch-b"/><polygon points="108,102 118,97 118,107" class="ch-head-b"/><text x="170" y="120" text-anchor="middle" class="ch-label">Income</text>`
      + `<text x="60" y="28" text-anchor="middle" class="ch-label">Out: S, T, M</text><line x1="60" y1="55" x2="60" y2="40" class="ch-line ch-c"/><polygon points="60,34 55,44 65,44" class="ch-head-c"/>`
      + `<text x="280" y="28" text-anchor="middle" class="ch-label">In: I, G, X</text><line x1="280" y1="36" x2="280" y2="49" class="ch-line ch-c"/><polygon points="280,55 275,45 285,45" class="ch-head-c"/></svg>`;
    wire(root, specs, ({ j, w }, set) => {
      const gap = j - w;
      set('gap', `${gap > 0 ? '+' : gap < 0 ? '−' : ''}£${Math.abs(gap)}bn`); set('dir', gap > 0 ? 'Rising' : gap < 0 ? 'Falling' : 'Steady');
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}</figure>`;
      root.querySelector('[data-desc]').textContent = gap > 0 ? 'More is entering the flow than leaving it, so spending, output and income rise.'
        : gap < 0 ? 'More is leaving the flow than entering it, so spending, output and income fall.'
          : 'Injections equal withdrawals, so national income is in equilibrium.';
    });
  },
  adas(root, a) {
    const specs = {
      d: { min: -30, max: 30, step: 10, value: a.d ?? 0, fmt: v => `${v > 0 ? '+' : ''}${v}` },
      s: { min: -30, max: 30, step: 10, value: a.s ?? 0, fmt: v => `${v > 0 ? '+' : ''}${v}` },
      l: { min: 0, max: 30, step: 10, value: a.l ?? 0, fmt: v => `+${v}` },
    };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">Aggregate demand and aggregate supply</h3>${slider('d', 'Aggregate demand', specs.d)}${slider('s', 'Costs of production', specs.s)}${slider('l', 'Long-run capacity', specs.l)}`
      + `<div class="stats">${stat('Real output', 'y', 'good')}${stat('Price level', 'p')}${stat('Output gap', 'gap', 'warm')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ d, s, l }, set) => {
      const r = adas(d, s, l);
      set('y', r.y); set('p', r.p); set('gap', `${r.gap > 0 ? '+' : ''}${r.gap}`);
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="AD and AS diagram. Equilibrium real output is ${r.y} at a price level of ${r.p}, and long-run capacity is ${r.capacity}.">${axes('Real output', 'Price level')}`
        + seg(Math.max(0, d), 130 + d - Math.max(0, d), 125, 5 + d, 'ch-line ch-a') + seg(35 - s, 5, 125, 95 + s, 'ch-line ch-b') + seg(r.capacity, 0, r.capacity, 125, 'ch-line ch-c ch-dash')
        + `<circle cx="${mx(r.y)}" cy="${my(r.p)}" r="5" class="ch-dot-b"/></svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-a', 'AD'], ['ch-b', 'SRAS'], ['ch-c dash', 'LRAS']], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = r.gap < 0 ? `Output is ${-r.gap} below capacity, so there's a negative output gap. ${d < 0 ? 'Weak demand means demand-deficient unemployment.' : s > 0 ? 'Higher costs have cut output and raised prices, which is cost-push inflation.' : 'Spending has not yet caught up with the extra capacity.'}`
        : r.gap > 0 ? `Output is ${r.gap} above capacity, so there's a positive output gap and pressure on prices.`
          : 'Output is at long-run capacity, so the economy is at its normal capacity level.';
    });
  },
  multiplier(root, a) {
    const specs = { m: { min: 0.5, max: 0.9, step: 0.1, value: a.m ?? 0.8, fmt: v => v.toFixed(1) } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">The multiplier</h3>${slider('m', 'Marginal propensity to consume', specs.m)}`
      + `<div class="stats">${stat('Multiplier', 'k', 'good')}${stat('Rise in income from £10bn', 'total')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ m }, set) => {
      const k = multiplierK(m);
      set('k', k.toFixed(1)); set('total', `£${(10 * k).toFixed(0)}bn`);
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: `Total rise in income after each round of spending, reaching about £${(10 * k).toFixed(0)}bn.`,
        series: [{ name: 'Total rise in income', tone: 'a', points: Array.from({ length: 15 }, (_, i) => [i + 1, +multiplierRounds(10, m, i + 1).toFixed(2)]) }],
        yFmt: v => `£${v}bn`, xFmt: v => `${v}`, xTicks: [1, 5, 10, 15],
      });
      root.querySelector('[data-desc]').textContent = `Each round, people spend ${(m * 100).toFixed(0)}p of each extra £1. Rounds get smaller, and the total heads towards £${(10 * k).toFixed(0)}bn. This is the multiplier: 1 ÷ (1 − MPC) = ${k.toFixed(1)}.`;
    });
  },
  keynesian(root, a) {
    const specs = { a: { min: 90, max: 200, step: 10, value: a.a ?? 100, fmt: v => `${v}` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">The Keynesian AS curve</h3>${slider('a', 'Aggregate demand', specs.a)}`
      + `<div class="stats">${stat('Real output', 'y', 'good')}${stat('Price level', 'p')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ a: top }, set) => {
      const r = keynesAt(top);
      set('y', r.y.toFixed(0)); set('p', r.p.toFixed(0));
      const from = Math.max(0, top - 125);
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Keynesian aggregate supply curve, flat at low output and vertical at full capacity of 100. Output is ${r.y.toFixed(0)} at a price level of ${r.p.toFixed(0)}.">${axes('Real output', 'Price level')}`
        + seg(0, 40, 70, 40, 'ch-line ch-b') + curve(keynesAS, 70, 97, 'ch-line ch-b') + seg(from, top - from, Math.min(125, top), Math.max(0, top - 125), 'ch-line ch-a')
        + `<circle cx="${mx(r.y)}" cy="${my(r.p)}" r="5" class="ch-dot-b"/></svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-a', 'AD'], ['ch-b', 'Keynesian AS']], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = r.zone === 'flat' ? 'There is plenty of spare capacity, so more demand raises output with no rise in prices.'
        : r.zone === 'rising' ? 'Spare capacity is running out, so more demand raises both output and prices.'
          : 'The economy is close to full capacity, so more demand mostly raises prices.';
    });
  },
  cycle(root, a) {
    const specs = { t: { min: 0, max: 100, step: 2.5, value: a.t ?? 12.5, fmt: v => `Year ${(v / 5).toFixed(1)}` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">The economic cycle</h3>${slider('t', 'Move through time', specs.t)}`
      + `<div class="stats">${stat('Phase', 'ph', 'good')}${stat('Output gap', 'gap', 'warm')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ t }, set) => {
      const gap = actualAt(t) - trendAt(t), ph = cyclePhase(t), rising = ph === 'Recovery';
      set('ph', ph); set('gap', `${gap >= 0 ? '+' : ''}${gap.toFixed(0)}`);
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Real GDP swinging above and below a rising trend line. The current phase is ${ph.toLowerCase()}, with an output gap of ${gap.toFixed(0)}.">${axes('Time', 'Real GDP')}`
        + seg(0, trendAt(0), 125, trendAt(100), 'ch-line ch-b ch-dash') + `<polyline fill="none" class="ch-line ch-a" points="${Array.from({ length: 81 }, (_, i) => i * 1.25).map(x => `${mx(x * 1.25).toFixed(1)},${my(actualAt(x)).toFixed(1)}`).join(' ')}"/>`
        + `<circle cx="${mx(t * 1.25)}" cy="${my(actualAt(t))}" r="5" class="ch-dot-a"/></svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-a', 'Actual real GDP'], ['ch-b dash', 'Trend growth']], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = Math.abs(gap) < 0.5
        ? `Actual output is on its trend, so the output gap is about zero, and the economy is ${rising ? 'recovering' : 'slowing'}.`
        : gap > 0 ? `Output is above trend: a positive output gap. Expect low unemployment and rising inflation pressure. The economy is ${rising ? 'still speeding up' : ph === 'Peak (boom)' ? 'at its peak' : 'slowing'}.`
          : `Output is below trend: a negative output gap. Expect higher unemployment and weak inflation. The economy is ${rising ? 'recovering' : ph === 'Trough' ? 'at its low point' : 'still slowing'}.`;
    });
  },
  phillips(root, a) {
    const specs = {
      u: { min: 3, max: 8, step: 1, value: a.u ?? 5, fmt: v => `${v}%` },
      e: { min: 0, max: 6, step: 2, value: a.e ?? 2, fmt: v => `${v}%` },
    };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">The Phillips curves</h3>${slider('u', 'Unemployment', specs.u)}${slider('e', 'Expected inflation', specs.e)}`
      + `<div class="stats">${stat('Inflation', 'pi', 'warm')}${stat('Natural rate', 'n')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    const px = v => v * 10, py = v => Math.max(0, v * 5);
    wire(root, specs, ({ u, e }, set) => {
      const pi = phillips(u, e);
      set('pi', `${pi.toFixed(1)}%`); set('n', `${NATURAL_RATE}%`);
      const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Phillips curve diagram. At ${u} percent unemployment and ${e} percent expected inflation, inflation is ${pi.toFixed(1)} percent. The long-run Phillips curve is vertical at the natural rate of 5 percent.">${axes('Unemployment', 'Inflation')}`
        + curve(x => py(phillips(x / 10, e)), 20, e < 6 ? Math.min(110, 300 / (6 - e)) : 110, 'ch-line ch-a') + seg(px(NATURAL_RATE), 0, px(NATURAL_RATE), 125, 'ch-line ch-c ch-dash')
        + `<circle cx="${mx(px(u))}" cy="${my(py(pi))}" r="5" class="ch-dot-b"/></svg>`;
      root.querySelector('[data-chart]').innerHTML = `<figure class="chart">${svg}${legend([['ch-a', 'Short-run Phillips curve'], ['ch-c dash', 'Long-run Phillips curve']], '')}</figure>`;
      root.querySelector('[data-desc]').textContent = u < NATURAL_RATE
        ? `Unemployment is below the natural rate, so inflation of ${pi.toFixed(1)}% is above what people expected. They will come to expect more, which shifts the short-run curve up, and unemployment drifts back to 5%.`
        : u > NATURAL_RATE ? `Unemployment is above the natural rate, so inflation of ${pi.toFixed(1)}% is below what people expected. Expectations fall, and the short-run curve shifts down.`
          : 'At the natural rate, inflation equals what people expect, so there is no pressure for it to change. Try a higher expected rate: the curve moves, and unemployment stays the same in the long run.';
    });
  },
  fisher(root, a) {
    const specs = {
      m: { min: 100, max: 200, step: 10, value: a.m ?? 100, fmt: v => `£${v}bn` },
      v: { min: 2, max: 5, step: 1, value: a.v ?? 3, fmt: v => `${v}` },
      q: { min: 100, max: 200, step: 10, value: a.q ?? 150, fmt: v => `${v}bn units` },
    };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">MV = PQ</h3>${slider('m', 'Money supply (M)', specs.m)}${slider('v', 'Velocity of circulation (V)', specs.v)}${slider('q', 'Real output (Q)', specs.q)}`
      + `<div class="stats">${stat('Price level (P)', 'p', 'warm')}${stat('Nominal income (PQ)', 'y')}</div>`
      + `<p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ m, v, q }, set) => {
      set('p', `£${fisherP(m, v, q).toFixed(2)}`); set('y', `£${m * v}bn`);
      root.querySelector('[data-desc]').textContent = 'Monetarists assume that V and Q are fairly stable. Hold them still and raise M: P rises in proportion.';
    });
  },
  bond(root, a) {
    const specs = {
      p: { min: 60, max: 140, step: 5, value: a.p ?? 100, fmt: v => `£${v}` },
      c: { min: 2, max: 8, step: 1, value: a.c ?? 5, fmt: v => `£${v}` },
    };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">Bond prices and yields</h3>${slider('p', 'Market price of the bond', specs.p)}${slider('c', 'Coupon each year', specs.c)}`
      + `<div class="stats">${stat('Yield', 'y', 'good')}${stat('Face value', 'f')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ p, c }, set) => {
      const y = bondYield(c, p);
      set('y', `${y.toFixed(2)}%`); set('f', '£100');
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: `Yield falls as the price of the bond rises. At a price of £${p}, the yield is ${y.toFixed(2)} percent.`,
        series: [{ name: 'Yield at each price', tone: 'a', points: Array.from({ length: 17 }, (_, i) => [60 + i * 5, +bondYield(c, 60 + i * 5).toFixed(2)]) }],
        yFmt: v => `${v}%`, xFmt: v => `£${v}`, xTicks: [60, 100, 140],
      });
      root.querySelector('[data-desc]').textContent = `The coupon stays at £${c}, so paying more for the bond means a lower return. Price up, yield down.`;
    });
  },
  incometax(root, a) {
    const specs = { i: { min: 10000, max: 100000, step: 5000, value: a.i ?? 30000, fmt: v => `£${v.toLocaleString('en-GB')}` } };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">UK income tax, 2026 to 2027</h3>${slider('i', 'Yearly income', specs.i)}`
      + `<div class="stats">${stat('Tax to pay', 't', 'warm')}${stat('Average rate', 'av', 'good')}${stat('Marginal rate', 'mg')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ i }, set) => {
      const r = ukIncomeTax(i);
      set('t', `£${Math.round(r.tax).toLocaleString('en-GB')}`); set('av', `${r.average.toFixed(1)}%`); set('mg', `${r.marginal}%`);
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: `Average rate of income tax rising with income. At £${i.toLocaleString('en-GB')}, it is ${r.average.toFixed(1)} percent.`,
        series: [{ name: 'Average tax rate', tone: 'a', points: Array.from({ length: 19 }, (_, k) => { const x = 10000 + k * 5000; return [x / 1000, +ukIncomeTax(x).average.toFixed(1)]; }) }],
        yFmt: v => `${v}%`, xFmt: v => `£${v}k`, xTicks: [10, 50, 90],
      });
      root.querySelector('[data-desc]').textContent = 'The average rate rises with income, so income tax is progressive. This is income tax only, for England, Wales and Northern Ireland, and it leaves out National Insurance.';
    });
  },
  budget(root, a) {
    const specs = {
      s: { min: 0, max: 6, step: 1, value: a.s ?? 2, fmt: v => `${v}%` },
      g: { min: -6, max: 6, step: 2, value: a.g ?? -4, fmt: v => `${v > 0 ? '+' : ''}${v}%` },
    };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">Cyclical and structural deficits</h3>${slider('s', 'Structural deficit (% of GDP)', specs.s)}${slider('g', 'Output gap (% of GDP)', specs.g)}`
      + `<div class="stats">${stat('Cyclical part', 'c')}${stat('Total deficit', 't', 'warm')}</div>`
      + `<p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ s, g }, set) => {
      const r = budgetDeficit(s, g);
      set('c', `${r.cyclical >= 0 ? '' : '−'}${Math.abs(r.cyclical).toFixed(1)}%`); set('t', `${r.total >= 0 ? '' : '−'}${Math.abs(r.total).toFixed(1)}%`);
      root.querySelector('[data-desc]').textContent = g < 0
        ? 'A negative output gap adds to the deficit, as tax revenue falls and benefit spending rises. This part goes away as the economy recovers. The structural part does not.'
        : g > 0 ? 'A positive output gap reduces the deficit, as tax revenue rises and benefit spending falls. The structural part stays, and a boom can hide it.'
          : 'With no output gap, the whole deficit is structural.';
    });
  },
  costs(root, a) {
    const specs = {
      fc: { min: 20, max: 200, step: 10, value: a.fc ?? 60, fmt: v => `£${v}` },
      w: { min: 1, max: 3, step: 0.5, value: a.w ?? 1, fmt: v => `${v} × normal` },
    };
    root.innerHTML = `<div class="calc"><h3 class="calc-title">Short-run cost curves</h3>`
      + slider('fc', 'Fixed costs', specs.fc) + slider('w', 'Wages (the variable cost)', specs.w)
      + `<div class="stats">${stat('Output at lowest ATC', 'q', 'good')}${stat('Lowest ATC', 'atc')}</div>`
      + `<div data-chart></div><p class="calc-note" data-desc aria-live="polite"></p></div>`;
    wire(root, specs, ({ fc, w }, set) => {
      const qs = Array.from({ length: 19 }, (_, i) => i + 2);
      const line = k => qs.map(q => [q, +costsAt(q, fc, w)[k].toFixed(2)]);
      const q0 = lowestAtc(fc, w), atc0 = costsAt(q0, fc, w).atc;
      set('q', q0.toFixed(1)); set('atc', `£${atc0.toFixed(2)}`);
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: `Marginal cost, average variable cost and average total cost curves. Average total cost is lowest at about ${q0.toFixed(1)} units, where marginal cost cuts it.`,
        series: [{ name: 'ATC', tone: 'a', points: line('atc') }, { name: 'AVC', tone: 'c', points: line('avc') }, { name: 'MC', tone: 'b', points: line('mc') }],
        yFmt: v => `£${v}`, xFmt: v => `${v}`, xTicks: [2, 8, 14, 20],
      });
      root.querySelector('[data-desc]').textContent = `MC cuts ATC at its lowest point, about £${atc0.toFixed(2)} at ${q0.toFixed(1)} units. Higher fixed costs raise ATC but leave MC and AVC alone; higher wages raise all three.`;
    });
  },
};
