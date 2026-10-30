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
const axes = () => `<line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${my(0)}" class="ch-axis"/><line x1="${PAD.l}" y1="${my(0)}" x2="${W - PAD.r}" y2="${my(0)}" class="ch-axis"/>`
  + `<text x="${W - PAD.r}" y="${H - 10}" text-anchor="end" class="ch-label">Quantity</text>`
  + `<text x="12" y="${PAD.t + 4}" class="ch-label" transform="rotate(-90 12 ${PAD.t + 4})" text-anchor="end">Price</text>`;
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
