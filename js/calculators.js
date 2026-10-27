// Live calculators and interactive charts used by lessons (:::calc name {args} and :::chart name {args}).
// Each one is mount(container, args) and redraws when an input changes.
import { esc, gbp } from './util.js';
import { lineChart, moneyShort } from './charts.js';
import { moneyCalculators } from './calcs-money.js';
import { investCalculators } from './calcs-invest.js';
import { tradeCalculators } from './calcs-trade.js';
import { industryCalculators } from './calcs-industry.js';

function slider(id, label, { min, max, step, value, fmt }) {
  return `<label class="slider"><span class="slider-top"><span>${esc(label)}</span><output data-out="${id}">${esc(fmt(value))}</output></span>`
    + `<input type="range" data-in="${id}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${esc(label)}"></label>`;
}

function stat(label, valueId, tone = '') {
  return `<div class="stat ${tone}"><span>${esc(label)}</span><strong data-v="${valueId}"></strong></div>`;
}

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

function card(title, body, note = '') {
  return `<div class="calc"><h3 class="calc-title">${esc(title)}</h3>${body}${note ? `<p class="calc-note">${esc(note)}</p>` : ''}</div>`;
}

const pct = v => `${+v.toFixed(2)}%`;
const yrs = v => `${v} ${v === 1 ? 'year' : 'years'}`;
const pounds = v => gbp(v, 0);

export const calculators = {
  ...moneyCalculators,
  ...investCalculators,
  ...tradeCalculators,
  ...industryCalculators,

  compound(root, a) {
    const specs = {
      p: { min: 100, max: 20000, step: 100, value: a.p ?? 1500, fmt: pounds },
      r: { min: 0, max: 12, step: 0.1, value: a.r ?? 4.5, fmt: pct },
      y: { min: 1, max: 50, step: 1, value: a.y ?? 10, fmt: yrs },
    };
    root.innerHTML = card('Compound interest calculator',
      slider('p', 'Starting amount', specs.p) + slider('r', 'Interest rate a year', specs.r) + slider('y', 'Years', specs.y)
      + `<div class="stats">${stat('Compound', 'c', 'good')}${stat('Simple', 's')}${stat('Interest on interest', 'x', 'warm')}</div><div data-chart></div>`,
      'Assumes the rate never changes, which it will. A picture of how compounding works, not a forecast.');
    wire(root, specs, ({ p, r, y }, set) => {
      const c = p * (1 + r / 100) ** y, s = p + p * (r / 100) * y;
      set('c', gbp(c)); set('s', gbp(s)); set('x', gbp(c - s));
      const pts = f => Array.from({ length: y + 1 }, (_, t) => [t, f(t)]);
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: `Compound grows to ${gbp(c)} against ${gbp(s)} with simple interest after ${y} years`,
        series: [
          { name: 'Compound', tone: 'a', points: pts(t => p * (1 + r / 100) ** t) },
          { name: 'Simple', tone: 'c', dashed: true, points: pts(t => p + p * (r / 100) * t) },
        ],
        yFmt: moneyShort, xFmt: v => `${v} yr`,
      });
    });
  },

  rule72(root, a) {
    const specs = { r: { min: 1, max: 15, step: 0.5, value: a.r ?? 6, fmt: pct } };
    root.innerHTML = card('Rule of 72',
      slider('r', 'Interest rate a year', specs.r)
      + `<div class="stats">${stat('Rule of 72 says', 'est', 'good')}${stat('Exact answer', 'exact')}</div>`,
      '72 ÷ rate ≈ years to double. It works best for rates between about 2% and 15%.');
    wire(root, specs, ({ r }, set) => {
      set('est', `${+(72 / r).toFixed(1)} years`);
      set('exact', `${(Math.log(2) / Math.log(1 + r / 100)).toFixed(2)} years`);
    });
  },

  real(root, a) {
    const specs = {
      r: { min: 0, max: 10, step: 0.1, value: a.r ?? 4.5, fmt: pct },
      i: { min: 0, max: 12, step: 0.1, value: a.i ?? 3.5, fmt: pct },
      p: { min: 100, max: 20000, step: 100, value: a.p ?? 1500, fmt: pounds },
    };
    root.innerHTML = card('Real return calculator',
      slider('r', 'Your interest rate', specs.r) + slider('i', 'Inflation', specs.i) + slider('p', 'Amount', specs.p)
      + `<div class="stats">${stat('Real return', 'real', 'good')}${stat('Pounds after a year', 'nom')}${stat("In today's prices", 'today')}</div>`,
      'Real return = (1 + rate) ÷ (1 + inflation) − 1. Quick version: rate − inflation.');
    wire(root, specs, ({ r, i, p }, set) => {
      const real = ((1 + r / 100) / (1 + i / 100) - 1) * 100;
      set('real', `${real >= 0 ? '+' : '−'}${Math.abs(real).toFixed(2)}%`);
      root.querySelector('[data-v="real"]').closest('.stat').className = `stat ${real >= 0 ? 'good' : 'bad'}`;
      set('nom', gbp(p * (1 + r / 100)));
      set('today', gbp((p * (1 + r / 100)) / (1 + i / 100)));
    });
  },
};

export const charts = {
  inflation(root, a) {
    const specs = {
      cpi: { min: 0, max: 10, step: 0.5, value: a.cpi ?? 3.5, fmt: pct },
      years: { min: 1, max: 30, step: 1, value: a.years ?? 10, fmt: yrs },
    };
    const p = a.p ?? 1500;
    root.innerHTML = card(`What ${gbp(p, 0)} in cash can buy`,
      slider('cpi', 'Inflation a year', specs.cpi) + slider('years', 'Years', specs.years)
      + `<div class="stats">${stat('Pounds you hold', 'held')}${stat("Worth in today's prices", 'worth', 'bad')}</div><div data-chart></div>`);
    wire(root, specs, ({ cpi, years }, set) => {
      const worth = t => p / (1 + cpi / 100) ** t;
      set('held', gbp(p, 0)); set('worth', gbp(worth(years), 0));
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: `£${p} kept as cash buys what ${gbp(worth(years), 0)} buys today after ${years} years of ${cpi}% inflation`,
        series: [
          { name: 'Pounds you hold', tone: 'c', dashed: true, points: [[0, p], [years, p]] },
          { name: 'What they can buy', tone: 'b', points: Array.from({ length: years + 1 }, (_, t) => [t, worth(t)]) },
        ],
        area: false, yFmt: moneyShort, xFmt: v => `${v} yr`,
      });
    });
  },
};
