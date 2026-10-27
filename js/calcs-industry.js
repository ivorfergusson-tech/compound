// Industry-strand calculators and diagrams: the finance map, banks, rates, buyouts, bonds and options.
import { esc, gbp } from './util.js';
import { lineChart, moneyShort } from './charts.js';

const pct = v => `${+(+v).toFixed(2)}%`;
const pounds = v => gbp(v, 0);

function slider(id, label, s) {
  return `<label class="slider"><span class="slider-top"><span>${esc(label)}</span><output data-out="${id}"></output></span>`
    + `<input type="range" data-in="${id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}" aria-label="${esc(label)}"></label>`;
}
const stat = (label, id, tone = '') => `<div class="stat ${tone}" data-stat="${id}"><span>${esc(label)}</span><strong data-v="${id}"></strong></div>`;
const card = (title, body, note) => `<div class="calc"><h3 class="calc-title">${esc(title)}</h3>${body}${note ? `<p class="calc-note">${note}</p>` : ''}</div>`;

function wire(root, fmts, draw) {
  const update = () => {
    const v = {};
    for (const el of root.querySelectorAll('[data-in]')) v[el.dataset.in] = el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
    for (const [k, f] of Object.entries(fmts)) { const o = root.querySelector(`[data-out="${k}"]`); if (o) o.textContent = f(v[k], v); }
    draw(v, (id, text) => { const e = root.querySelector(`[data-v="${id}"]`); if (e) e.textContent = text; });
  };
  root.addEventListener('input', update);
  root.addEventListener('change', update);
  update();
}

// ---------- maths (exported for tests) ----------
export function mortgagePayment(loan, ratePct, years) {
  const r = ratePct / 100 / 12, n = years * 12;
  return r === 0 ? loan / n : (loan * r) / (1 - (1 + r) ** -n);
}

export function bondPrice(couponPct, years, yieldPct, face = 100) {
  const c = face * couponPct / 100, y = yieldPct / 100;
  let p = 0;
  for (let t = 1; t <= years; t++) p += c / (1 + y) ** t;
  return p + face / (1 + y) ** years;
}

// A simple leveraged buyout: buy at entry multiple × EBITDA, part-funded by debt;
// cash flow pays down debt; sell at exit multiple. Returns money multiple and IRR for the equity.
export function lbo({ ebitda, entryMult, debtPct, growth, years, exitMult, paydownPct }) {
  const price = ebitda * entryMult, debt0 = price * debtPct / 100, equity0 = price - debt0;
  let e = ebitda, debt = debt0;
  for (let t = 0; t < years; t++) { e *= 1 + growth / 100; debt = Math.max(0, debt - e * paydownPct / 100); }
  const exitValue = e * exitMult, equityOut = Math.max(0, exitValue - debt);
  const moic = equityOut / equity0;
  return { price, equity0, debt0, exitValue, debtLeft: debt, equityOut, moic, irr: moic > 0 ? (moic ** (1 / years) - 1) * 100 : -100 };
}

export function optionPnl(type, strike, premium, price) {
  const intrinsic = type === 'call' ? Math.max(0, price - strike) : Math.max(0, strike - price);
  return intrinsic - premium;
}

// ---------- diagrams ----------
function box(title, sub, tone) { return `<div class="map-box map-${tone}"><strong>${esc(title)}</strong><span>${esc(sub)}</span></div>`; }

export const industryCalculators = {
  financemap(root) {
    root.innerHTML = `<figure class="calc fin-map" role="img" aria-label="Map of the finance industry: savers' money flows through banks, asset managers and markets to companies and governments, with brokers connecting people to markets and regulators overseeing everyone">
      <h3 class="calc-title">A map of the finance industry</h3>
      <div class="map-row">${box('Savers and investors', 'You, pension schemes, insurers', 'people')}</div>
      <div class="map-arrow" aria-hidden="true">↓ money ↓</div>
      <div class="map-row three">
        ${box('Retail banks', 'Deposits, loans, mortgages, payments', 'bank')}
        ${box('Asset managers', 'Funds, pensions, hedge funds, private equity', 'buy')}
        ${box('Brokers and platforms', 'Connect you to markets', 'broker')}
      </div>
      <div class="map-arrow" aria-hidden="true">↓ lending, investing, trading ↓</div>
      <div class="map-row two">
        ${box('Markets', 'Stock exchanges, bond markets, currencies', 'market')}
        ${box('Investment banks', 'Advise on deals, raise money, make markets', 'sell')}
      </div>
      <div class="map-arrow" aria-hidden="true">↓ money to use ↓</div>
      <div class="map-row">${box('Companies and governments', 'Build, hire, invest; pay back with interest, dividends and growth', 'users')}</div>
      <div class="map-reg"><strong>Watching over all of it:</strong> the Bank of England (and its PRA), the FCA, and HM Treasury.</div>
    </figure>`;
  },

  transmission(root) {
    const steps = [
      ['Bank of England changes Bank Rate', 'MPC vote, 8 times a year'],
      ['Banks change their rates', 'Mortgages, loans, savings, often within weeks'],
      ['Spending and borrowing change', 'Higher rates: borrow less, save more'],
      ['Demand in the economy changes', 'Less spending cools prices and hiring'],
      ['Inflation moves towards 2%', 'Full effect can take 18–24 months'],
    ];
    root.innerHTML = `<figure class="calc chain" role="img" aria-label="How a Bank Rate change spreads: banks change rates, spending changes, demand changes, inflation moves">
      <h3 class="calc-title">How a rate change spreads (the transmission mechanism)</h3>
      <ol class="chain-list">${steps.map(([t, s]) => `<li><strong>${esc(t)}</strong><span>${esc(s)}</span></li>`).join('')}</ol>
      <p class="calc-note">Other channels run alongside: the pound's exchange rate, asset prices like shares and houses, and confidence.</p></figure>`;
  },

  nim(root, a) {
    root.innerHTML = card('How a bank earns on the gap',
      slider('deposits', 'Customer deposits', { min: 100, max: 5000, step: 100, value: a.deposits ?? 1000 })
      + slider('saveRate', 'Rate it pays savers', { min: 0, max: 6, step: 0.1, value: a.saveRate ?? 2.5 })
      + slider('loanRate', 'Rate it charges borrowers', { min: 0, max: 12, step: 0.1, value: a.loanRate ?? 6 })
      + `<div class="stats">${stat('Interest earned', 'earned')}${stat('Interest paid', 'paid')}${stat('Net interest income', 'nii', 'good')}</div>`
      + `<div class="stats">${stat('Net interest margin', 'nim', 'good')}</div>`,
      'Simplified: assumes loans equal deposits, in £ millions. Real banks also earn fees and must cover staff, systems, bad loans and tax out of this margin.');
    wire(root, { deposits: v => `£${v}m`, saveRate: pct, loanRate: pct }, (v, set) => {
      const earned = v.deposits * v.loanRate / 100, paid = v.deposits * v.saveRate / 100;
      set('earned', `£${earned.toFixed(1)}m`); set('paid', `£${paid.toFixed(1)}m`); set('nii', `£${(earned - paid).toFixed(1)}m`);
      set('nim', pct(v.loanRate - v.saveRate));
    });
  },

  mortgage(root, a) {
    root.innerHTML = card('What a rate change does to a mortgage',
      slider('loan', 'Mortgage', { min: 50000, max: 500000, step: 5000, value: a.loan ?? 200000 })
      + slider('years', 'Term in years', { min: 10, max: 35, step: 1, value: a.years ?? 25 })
      + slider('rate', 'Interest rate', { min: 0.5, max: 9, step: 0.25, value: a.rate ?? 4.5 })
      + slider('change', 'Rates then rise by', { min: 0.25, max: 3, step: 0.25, value: a.change ?? 1 })
      + `<div class="stats">${stat('Monthly payment now', 'now')}${stat('After the rise', 'after', 'warm')}${stat('Extra each month', 'extra', 'bad')}</div>`,
      'Repayment mortgage, paid monthly. Fixed-rate mortgages only feel the change when the fix ends, which is one reason rate changes take time to work.');
    wire(root, { loan: pounds, years: v => `${v}`, rate: pct, change: v => `+${v}%` }, (v, set) => {
      const now = mortgagePayment(v.loan, v.rate, v.years), after = mortgagePayment(v.loan, v.rate + v.change, v.years);
      set('now', gbp(now, 0)); set('after', gbp(after, 0)); set('extra', gbp(after - now, 0));
    });
  },

  lbo(root, a) {
    root.innerHTML = card('A private equity buyout',
      slider('ebitda', 'Company\'s yearly EBITDA, £m', { min: 5, max: 100, step: 1, value: a.ebitda ?? 20 })
      + slider('entryMult', 'Buy at (EV / EBITDA)', { min: 4, max: 15, step: 0.5, value: a.entryMult ?? 10 })
      + slider('debtPct', 'Paid with borrowed money', { min: 0, max: 80, step: 5, value: a.debtPct ?? 60 })
      + slider('growth', 'EBITDA growth a year', { min: -10, max: 20, step: 1, value: a.growth ?? 5 })
      + slider('exitMult', 'Sell at (EV / EBITDA)', { min: 4, max: 15, step: 0.5, value: a.exitMult ?? 10 })
      + `<div class="stats">${stat('Price paid', 'price')}${stat('Fund\'s own money in', 'eq')}${stat('Sale value after 5 years', 'exit')}</div>`
      + `<div class="stats">${stat('Fund\'s money back', 'out', 'good')}${stat('Money multiple', 'moic', 'good')}${stat('Return a year', 'irr', 'good')}</div>`,
      'Simplified: 5 years, 40% of EBITDA each year used to repay debt, no fees, interest or tax shown. Try 0% debt to see how borrowing magnifies the return, then a fall in EBITDA to see how it magnifies losses.');
    wire(root, { ebitda: v => `£${v}m`, entryMult: v => `${v}×`, debtPct: v => `${v}%`, growth: v => `${v}%`, exitMult: v => `${v}×` }, (v, set) => {
      const x = lbo({ ...v, years: 5, paydownPct: 40 });
      const m = n => `£${Math.round(n)}m`;
      set('price', m(x.price)); set('eq', m(x.equity0)); set('exit', m(x.exitValue)); set('out', m(x.equityOut));
      set('moic', `${x.moic.toFixed(2)}×`); set('irr', `${x.irr.toFixed(1)}%`);
      for (const id of ['moic', 'irr', 'out']) root.querySelector(`[data-stat="${id}"]`).className = `stat ${x.moic >= 1 ? 'good' : 'bad'}`;
    });
  },

  bondprice(root, a) {
    root.innerHTML = card('Bond prices and yields',
      slider('coupon', 'Coupon (a year, per £100)', { min: 0, max: 8, step: 0.25, value: a.coupon ?? 4 })
      + slider('years', 'Years to maturity', { min: 1, max: 40, step: 1, value: a.years ?? 10 })
      + slider('yield', 'Yield the market now wants', { min: 0.5, max: 10, step: 0.1, value: a.yield ?? 5 })
      + `<div class="stats">${stat('Price per £100', 'price', 'good')}${stat('If yields rise 1 point', 'up', 'bad')}${stat('Change', 'chg', 'bad')}</div>`,
      'Price = today\'s value of all the coupons plus the £100 at the end, discounted at the yield (module 22). Longer bonds move more when yields change: that sensitivity is duration.');
    wire(root, { coupon: v => gbp(v, 2), years: v => `${v}`, yield: pct }, (v, set) => {
      const p = bondPrice(v.coupon, v.years, v.yield), q = bondPrice(v.coupon, v.years, v.yield + 1);
      set('price', gbp(p, 2)); set('up', gbp(q, 2)); set('chg', `${(((q - p) / p) * 100).toFixed(1)}%`);
    });
  },

  yieldcurve(root, a, { figures }) {
    const g = figures.figures.giltYields;
    root.innerHTML = card('The yield curve',
      `<label class="check"><input type="checkbox" data-in="inv"> Show an inverted curve (illustration)</label><div data-chart></div>`,
      `Gilt auction yields, ${esc(g.asOf)} (${esc(g.source)}, checked ${esc(g.checked)}). The inverted curve is a made-up illustration of what happens when short-term rates are above long-term ones.`);
    root.querySelector('[data-in]').addEventListener('change', draw);
    function draw() {
      const inv = root.querySelector('[data-in]').checked;
      const series = [{ name: 'Gilts, October 2026', tone: 'a', points: g.curve }];
      if (inv) series.push({ name: 'Inverted (illustration)', tone: 'b', dashed: true, points: [[2, 5.6], [5, 5.1], [10, 4.8], [37, 4.6]] });
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: inv ? 'Normal upward gilt curve compared with an inverted illustration' : 'Gilt yields rising from about 4.3% for 2 years to about 5.8% for 37 years',
        series, yMin: 3, yFmt: x => `${x.toFixed(1)}%`, xFmt: x => `${x} yr`, xTicks: [2, 10, 20, 37],
      });
    }
    draw();
  },

  optionpayoff(root, a) {
    root.innerHTML = card('Option payoff at expiry',
      `<label class="field-inline"><span>Type</span><select data-in="type"><option value="call">Call (right to buy)</option><option value="put">Put (right to sell)</option></select></label>`
      + slider('strike', 'Strike price', { min: 50, max: 150, step: 1, value: a.strike ?? 100 })
      + slider('prem', 'Premium paid', { min: 1, max: 20, step: 0.5, value: a.prem ?? 5 })
      + slider('price', 'Price at expiry', { min: 50, max: 150, step: 1, value: a.price ?? 110 })
      + `<div class="stats">${stat('Profit or loss per share', 'pl', 'good')}${stat('Break-even price', 'be')}${stat('Most you can lose', 'max', 'warm')}</div><div data-chart></div>`,
      'For the buyer of the option. The seller (writer) gets the premium and takes the opposite result, which for an uncovered call has no limit.');
    wire(root, { strike: v => gbp(v, 0), prem: v => gbp(v, 2), price: v => gbp(v, 0) }, (v, set) => {
      const pl = optionPnl(v.type, v.strike, v.prem, v.price);
      set('pl', `${pl >= 0 ? '+' : '−'}${gbp(Math.abs(pl), 2)}`);
      root.querySelector('[data-stat="pl"]').className = `stat ${pl >= 0 ? 'good' : 'bad'}`;
      set('be', gbp(v.type === 'call' ? v.strike + v.prem : v.strike - v.prem, 2)); set('max', gbp(v.prem, 2));
      const pts = []; for (let x = 50; x <= 150; x += 2) pts.push([x, optionPnl(v.type, v.strike, v.prem, x)]);
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: `${v.type === 'call' ? 'Call' : 'Put'} option payoff: loss limited to the premium, profit beyond break-even`,
        series: [{ name: 'Profit/loss at expiry', tone: 'a', points: pts }, { name: 'Break-even line', tone: 'c', dashed: true, points: [[50, 0], [150, 0]] }],
        yMin: Math.min(...pts.map(p => p[1])), yFmt: x => `£${Math.round(x)}`, xFmt: x => `£${x}`, xTicks: [50, 100, 150],
      });
    });
  },
};
