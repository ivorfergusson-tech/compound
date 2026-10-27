// Investing-strand calculators: income yields, a mini index, diversification, fees, margins, valuation, portfolios.
import { esc, gbp } from './util.js';
import { lineChart, moneyShort } from './charts.js';

const pct = v => `${+(+v).toFixed(2)}%`;
const pounds = v => gbp(v, 0);
const pence = v => (v < 1 ? `${Math.round(v * 100)}p` : gbp(v, 2));

function slider(id, label, s) {
  return `<label class="slider"><span class="slider-top"><span>${esc(label)}</span><output data-out="${id}"></output></span>`
    + `<input type="range" data-in="${id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}" aria-label="${esc(label)}"></label>`;
}
const stat = (label, id, tone = '') => `<div class="stat ${tone}" data-stat="${id}"><span>${esc(label)}</span><strong data-v="${id}"></strong></div>`;
const card = (title, body, note) => `<div class="calc"><h3 class="calc-title">${esc(title)}</h3>${body}${note ? `<p class="calc-note">${note}</p>` : ''}</div>`;

function wire(root, fmts, draw) {
  const update = () => {
    const v = {};
    for (const el of root.querySelectorAll('[data-in]')) v[el.dataset.in] = parseFloat(el.value);
    for (const [k, f] of Object.entries(fmts)) { const o = root.querySelector(`[data-out="${k}"]`); if (o) o.textContent = f(v[k], v); }
    draw(v, (id, text) => { const e = root.querySelector(`[data-v="${id}"]`); if (e) e.textContent = text; });
  };
  root.addEventListener('input', update);
  update();
}

// Present value of a stream: cash flow cf growing at g for n years, then a terminal value growing at tg, discounted at r.
export function dcf({ cf, g, r, n = 5, tg }) {
  let pv = 0, flow = cf;
  for (let t = 1; t <= n; t++) { flow *= 1 + g; pv += flow / (1 + r) ** t; }
  const terminal = r > tg ? (flow * (1 + tg)) / (r - tg) / (1 + r) ** n : Infinity;
  return { pv, terminal, total: pv + terminal };
}

// Volatility of an equal-weighted portfolio of n holdings, each with volatility s and pairwise correlation c.
export const portfolioVol = (n, s, c) => s * Math.sqrt(1 / n + (1 - 1 / n) * c);

export const investCalculators = {
  income(root, a) {
    root.innerHTML = card('What shares and bonds pay you',
      `<p class="small muted">A share</p>`
      + slider('price', 'Share price', { min: 0.5, max: 50, step: 0.1, value: a.price ?? 4 })
      + slider('div', 'Dividend per share, per year', { min: 0, max: 3, step: 0.01, value: a.div ?? 0.2 })
      + `<p class="small muted">A bond (£100 face value)</p>`
      + slider('bprice', 'Bond price', { min: 60, max: 130, step: 1, value: a.bprice ?? 100 })
      + slider('coupon', 'Coupon (interest on £100 a year)', { min: 0, max: 10, step: 0.25, value: a.coupon ?? 4 })
      + `<div class="stats">${stat('Dividend yield', 'dy', 'good')}${stat('Bond yield (on price paid)', 'by', 'good')}</div>`,
      'Dividend yield = yearly dividend ÷ share price. A bond\'s current yield = coupon ÷ price. Dividends can be cut; a bond\'s coupon is fixed unless the issuer defaults.');
    wire(root, { price: pence, div: pence, bprice: v => gbp(v, 0), coupon: v => gbp(v, 2) }, (v, set) => {
      set('dy', `${((v.div / v.price) * 100).toFixed(2)}%`);
      set('by', `${((v.coupon / v.bprice) * 100).toFixed(2)}%`);
    });
  },

  miniindex(root, a) {
    const cos = [['Big Co', 4000], ['Mid Co', 800], ['Small Co', 200]]; // millions of shares
    root.innerHTML = card('A tiny index of three companies',
      cos.map(([n], i) => slider(`p${i}`, `${n} share price`, { min: 1, max: 20, step: 0.1, value: [10, 10, 10][i] })).join('')
      + `<div class="stats">${cos.map((c, i) => stat(`${c[0]} market cap`, `m${i}`)).join('')}</div>`
      + `<div class="stats">${stat('Big Co share of the index', 'w0', 'warm')}${stat('Index level', 'idx', 'good')}</div>`,
      'Each company\'s weight is its market cap (share price × number of shares). Index starts at 1,000 when all prices are £10. Move Big Co a little and the index moves a lot; move Small Co a lot and the index barely notices.');
    const base = cos.reduce((s, [, sh]) => s + sh * 10, 0);
    wire(root, Object.fromEntries(cos.map((_, i) => [`p${i}`, v => gbp(v, 2)])), (v, set) => {
      const caps = cos.map(([, sh], i) => sh * v[`p${i}`]);
      const total = caps.reduce((s, x) => s + x, 0);
      caps.forEach((c, i) => set(`m${i}`, c >= 1000 ? `£${(c / 1000).toFixed(1)}bn` : `£${Math.round(c)}m`));
      set('w0', `${Math.round((caps[0] / total) * 100)}%`);
      set('idx', Math.round((total / base) * 1000).toLocaleString('en-GB'));
    });
  },

  diversify(root, a) {
    root.innerHTML = card('Diversification: how many holdings?',
      slider('n', 'Number of different shares', { min: 1, max: 50, step: 1, value: a.n ?? 1 })
      + slider('c', 'How closely they move together (correlation)', { min: 0, max: 1, step: 0.05, value: a.c ?? 0.3 })
      + `<div class="stats">${stat('Ups and downs (volatility)', 'vol', 'good')}${stat('Cut from one share', 'cut')}</div><div data-chart></div>`,
      'Assumes each share swings about 30% a year and all have the same expected return. Spreading cuts the swings, but only down to a floor set by how much they all move together: that floor is market risk, which no amount of spreading removes.');
    const s = 30;
    wire(root, { n: v => `${v}`, c: v => v.toFixed(2) }, (v, set) => {
      const vol = portfolioVol(v.n, s, v.c);
      set('vol', `${vol.toFixed(1)}% a year`); set('cut', `${Math.round((1 - vol / s) * 100)}%`);
      const pts = Array.from({ length: 50 }, (_, k) => [k + 1, portfolioVol(k + 1, s, v.c)]);
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: `Volatility falls from 30% with one share to ${vol.toFixed(1)}% with ${v.n}`,
        series: [{ name: 'Volatility as holdings rise', tone: 'a', points: pts }, { name: 'Market risk floor', tone: 'c', dashed: true, points: [[1, s * Math.sqrt(v.c)], [50, s * Math.sqrt(v.c)]] }],
        yFmt: x => `${Math.round(x)}%`, xFmt: x => `${x}`, xTicks: [1, 10, 20, 30, 40, 50],
      });
    });
  },

  drawdown(root, a) {
    root.innerHTML = card('Falls and recoveries',
      slider('fall', 'The investment falls by', { min: 5, max: 90, step: 5, value: a.fall ?? 50 })
      + `<div class="stats">${stat('£1,000 becomes', 'left', 'bad')}${stat('Gain needed to get back to £1,000', 'need', 'warm')}</div>`,
      'Losses and gains aren\'t symmetrical: after a fall, the same percentage rise starts from a smaller amount.');
    wire(root, { fall: v => `${v}%` }, (v, set) => {
      set('left', gbp(1000 * (1 - v.fall / 100), 0));
      set('need', `${Math.round((1 / (1 - v.fall / 100) - 1) * 100)}%`);
    });
  },

  riskladder(root) {
    const rows = [
      ['Cash savings', 'Can\'t fall in pounds (FSCS-protected); usually only just beats inflation', 1, 1],
      ['Government bonds', 'Prices move with interest rates; small long-run return above inflation', 2, 2],
      ['Corporate bonds', 'Extra return for the chance a company doesn\'t pay', 3, 3],
      ['Global shares (a fund)', 'Big swings, falls of a third or more happen; highest long-run return of the four', 4, 5],
      ['One company\'s shares', 'All the swings of shares plus the chance of going to zero, with no extra expected return', 5, 4],
    ];
    root.innerHTML = `<div class="calc"><h3 class="calc-title">The risk ladder</h3>${rows.map(([n, t, risk, ret]) => `
      <div class="ladder-row"><div class="ladder-name"><strong>${esc(n)}</strong><span class="small muted">${esc(t)}</span></div>
      <div class="ladder-bars" aria-label="Risk ${risk} of 5, expected return ${ret} of 5"><span class="lb-label">Risk</span><span class="lb-bar"><i style="width:${risk * 20}%" class="lb-risk"></i></span>
      <span class="lb-label">Return</span><span class="lb-bar"><i style="width:${ret * 20}%" class="lb-ret"></i></span></div></div>`).join('')}
      <p class="calc-note">A rough ranking, not exact numbers. Note the last row: more risk without more expected return, which is why spreading out beats picking one share.</p></div>`;
  },

  fees(root, a) {
    root.innerHTML = card('What fees cost over time',
      slider('start', 'Starting amount', { min: 0, max: 20000, step: 500, value: a.start ?? 1000 })
      + slider('monthly', 'Added each month', { min: 0, max: 1000, step: 25, value: a.monthly ?? 100 })
      + slider('years', 'Years', { min: 1, max: 45, step: 1, value: a.years ?? 30 })
      + slider('growth', 'Growth a year before fees', { min: 0, max: 10, step: 0.5, value: a.growth ?? 6 })
      + slider('feeA', 'Total yearly fees: option A', { min: 0, max: 2.5, step: 0.05, value: a.feeA ?? 0.3 })
      + slider('feeB', 'Total yearly fees: option B', { min: 0, max: 2.5, step: 0.05, value: a.feeB ?? 1.3 })
      + `<div class="stats">${stat('Pot with A', 'a', 'good')}${stat('Pot with B', 'b', 'warm')}${stat('Fees cost you', 'gap', 'bad')}</div><div data-chart></div>`,
      'Fees are a percentage of the whole pot, every year, whether the investments go up or down. The growth figure is an assumption, not a forecast. Total fees = fund charge + platform charge.');
    wire(root, { start: pounds, monthly: pounds, years: v => `${v}`, growth: pct, feeA: pct, feeB: pct }, (v, set) => {
      const run = fee => {
        const r = (1 + (v.growth - fee) / 100) ** (1 / 12) - 1;
        let b = v.start; const pts = [[0, b]];
        for (let m = 1; m <= v.years * 12; m++) { b = b * (1 + r) + v.monthly; if (m % 12 === 0) pts.push([m / 12, b]); }
        return { b, pts };
      };
      const A = run(v.feeA), B = run(v.feeB);
      set('a', gbp(A.b, 0)); set('b', gbp(B.b, 0)); set('gap', gbp(A.b - B.b, 0));
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: `After ${v.years} years, ${pct(v.feeA)} fees leave ${gbp(A.b, 0)} and ${pct(v.feeB)} leave ${gbp(B.b, 0)}`,
        series: [{ name: `Fees ${pct(v.feeA)}`, tone: 'a', points: A.pts }, { name: `Fees ${pct(v.feeB)}`, tone: 'b', dashed: true, points: B.pts }],
        yFmt: moneyShort, xFmt: x => `${x} yr`,
      });
    });
  },

  margins(root, a) {
    root.innerHTML = card('Profit and margins',
      slider('rev', 'Revenue (sales), £m', { min: 10, max: 1000, step: 10, value: a.rev ?? 200 })
      + slider('cos', 'Cost of sales, £m', { min: 0, max: 1000, step: 5, value: a.cos ?? 120 })
      + slider('opex', 'Running costs (wages, rent, marketing), £m', { min: 0, max: 500, step: 5, value: a.opex ?? 50 })
      + `<div class="stats">${stat('Gross profit', 'gp')}${stat('Gross margin', 'gm', 'good')}</div>`
      + `<div class="stats">${stat('Operating profit', 'op')}${stat('Operating margin', 'om', 'good')}</div>`,
      'Gross profit = revenue − cost of sales. Operating profit = gross profit − running costs. Margin = profit ÷ revenue.');
    wire(root, { rev: v => `£${v}m`, cos: v => `£${v}m`, opex: v => `£${v}m` }, (v, set) => {
      const gp = v.rev - v.cos, op = gp - v.opex;
      set('gp', `£${gp}m`); set('gm', `${((gp / v.rev) * 100).toFixed(1)}%`);
      set('op', `${op < 0 ? '−' : ''}£${Math.abs(op)}m`); set('om', `${((op / v.rev) * 100).toFixed(1)}%`);
      root.querySelector('[data-stat="om"]').className = `stat ${op >= 0 ? 'good' : 'bad'}`;
    });
  },

  pe(root, a) {
    root.innerHTML = card('Price/earnings (P/E) ratio',
      slider('price', 'Share price', { min: 1, max: 100, step: 0.5, value: a.price ?? 20 })
      + slider('eps', 'Earnings per share (profit ÷ shares)', { min: 0.1, max: 10, step: 0.1, value: a.eps ?? 1 })
      + `<div class="stats">${stat('P/E', 'pe', 'good')}${stat('Earnings yield', 'ey')}</div>`,
      'P/E = share price ÷ earnings per share: how many years of today\'s profit you pay for. Earnings yield is the same thing upside down.');
    wire(root, { price: v => gbp(v, 2), eps: v => gbp(v, 2) }, (v, set) => {
      set('pe', `${(v.price / v.eps).toFixed(1)}×`); set('ey', `${((v.eps / v.price) * 100).toFixed(1)}%`);
    });
  },

  dcf(root, a) {
    root.innerHTML = card('A simple discounted cash flow (DCF)',
      slider('cf', 'Free cash flow this year, £m', { min: 10, max: 500, step: 5, value: a.cf ?? 100 })
      + slider('g', 'Growth a year for the next 5 years', { min: -5, max: 25, step: 1, value: a.g ?? 8 })
      + slider('tg', 'Growth a year after that, forever', { min: 0, max: 4, step: 0.5, value: a.tg ?? 2 })
      + slider('r', 'Discount rate (the return you require)', { min: 5, max: 15, step: 0.5, value: a.r ?? 9 })
      + slider('shares', 'Number of shares, millions', { min: 50, max: 2000, step: 50, value: a.shares ?? 1000 })
      + `<div class="stats">${stat('Next 5 years, today\'s value', 'pv')}${stat('Everything after, today\'s value', 'tv')}</div>`
      + `<div class="stats">${stat('Company value', 'total', 'good')}${stat('Value per share', 'per', 'good')}</div>`,
      'Each future pound is divided by (1 + discount rate) for every year you wait. Small changes to growth or the discount rate move the answer a lot: a DCF is only as good as its guesses. Ignores debt and cash for simplicity.');
    wire(root, { cf: v => `£${v}m`, g: pct, tg: pct, r: pct, shares: v => `${v}m` }, (v, set) => {
      const x = dcf({ cf: v.cf, g: v.g / 100, r: v.r / 100, tg: v.tg / 100 });
      const m = n => (n >= 1000 ? `£${(n / 1000).toFixed(2)}bn` : `£${Math.round(n)}m`);
      set('pv', m(x.pv)); set('tv', m(x.terminal)); set('total', m(x.total)); set('per', gbp(x.total / v.shares, 2));
    });
  },

  portfolio(root, a) {
    root.innerHTML = card('Shares, bonds and cash: a rough picture',
      slider('sh', 'Shares', { min: 0, max: 100, step: 5, value: a.sh ?? 60 })
      + slider('bo', 'Bonds', { min: 0, max: 100, step: 5, value: a.bo ?? 30 })
      + `<p class="small muted" data-v="cash"></p>`
      + `<div class="stats">${stat('Long-run return above inflation (assumed)', 'ret', 'good')}${stat('In a bad year like 2008 (illustration)', 'bad', 'bad')}</div>`
      + `<div class="stats">${stat('£10,000 after 20 years (today\'s money)', 'pot', 'good')}${stat('£10,000 in that bad year', 'dip', 'warm')}</div>`,
      'Illustrative assumptions only: shares 5% a year above inflation, bonds 1.5%, cash 0.5%; in a crash year shares −35%, bonds −5%, cash 0%. Real returns vary hugely, and no mix is safe from every kind of loss.');
    wire(root, { sh: v => `${v}%`, bo: v => `${v}%` }, (v, set) => {
      let sh = v.sh, bo = Math.min(v.bo, 100 - sh); const cash = 100 - sh - bo;
      root.querySelector('[data-v="cash"]').textContent = `Cash: ${cash}%${bo < v.bo ? ' (bonds capped so the total is 100%)' : ''}`;
      const ret = (sh * 5 + bo * 1.5 + cash * 0.5) / 100;
      const bad = (sh * -35 + bo * -5) / 100;
      set('ret', `${ret.toFixed(1)}% a year`); set('bad', `${bad.toFixed(1)}%`);
      set('pot', gbp(10000 * (1 + ret / 100) ** 20, 0)); set('dip', gbp(10000 * (1 + bad / 100), 0));
    });
  },
};
