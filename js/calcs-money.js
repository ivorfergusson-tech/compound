// Money-strand calculators: take-home pay, budgets, savings goals, debt, Lifetime ISA, pensions.
// Tax figures come from content/figures.json (ctx.figures), so the April update needs no code change.
import { esc, gbp } from './util.js';
import { lineChart, moneyShort } from './charts.js';

const pct = v => `${+(+v).toFixed(2)}%`;
const pounds = v => gbp(v, 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function slider(id, label, s) {
  return `<label class="slider"><span class="slider-top"><span>${esc(label)}</span><output data-out="${id}"></output></span>`
    + `<input type="range" data-in="${id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}" aria-label="${esc(label)}"></label>`;
}
function select(id, label, options, value) {
  return `<label class="field-inline"><span>${esc(label)}</span><select data-in="${id}">${options.map(([v, t]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
}
const stat = (label, id, tone = '') => `<div class="stat ${tone}" data-stat="${id}"><span>${esc(label)}</span><strong data-v="${id}"></strong></div>`;
const card = (title, body, note) => `<div class="calc"><h3 class="calc-title">${esc(title)}</h3>${body}${note ? `<p class="calc-note">${note}</p>` : ''}</div>`;

// Reads every [data-in], shows slider values with their formatter, then calls draw(values, set).
function wire(root, fmts, draw) {
  const update = () => {
    const v = {};
    for (const el of root.querySelectorAll('[data-in]')) v[el.dataset.in] = el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
    for (const [k, f] of Object.entries(fmts)) { const o = root.querySelector(`[data-out="${k}"]`); if (o) o.textContent = f(v[k]); }
    draw(v, (id, text) => { const e = root.querySelector(`[data-v="${id}"]`); if (e) e.textContent = text; }, root);
  };
  root.addEventListener('input', update);
  root.addEventListener('change', update);
  update();
}

function bandTax(taxable, bands) {
  let tax = 0, lower = 0;
  for (const [upper, rate] of bands) {
    const top = upper == null ? Infinity : upper;
    if (taxable > lower) tax += (Math.min(taxable, top) - lower) * rate / 100;
    lower = top;
  }
  return tax;
}

// Yearly pay breakdown. Pension here is a "net pay" workplace scheme: taken before tax, after NI.
export function payslip(F, { salary, region = 'ruk', plan = 'none', pensionPct = 0 }) {
  const pa = Math.max(0, F.personalAllowance.value - Math.max(0, salary - 100000) / 2);
  const band = F.aeBand;
  const pension = salary > band.value ? (pensionPct / 100) * (Math.min(salary, band.upper) - band.value) : 0;
  const taxable = Math.max(0, salary - pension - pa);
  const tax = bandTax(taxable, (region === 'scot' ? F.scottishBands : F.incomeTaxBands).bands);
  const ni = F.niEmployee;
  const nic = Math.max(0, Math.min(salary, ni.upper) - ni.lower) * ni.value / 100 + Math.max(0, salary - ni.upper) * ni.rateAbove / 100;
  const loanFig = { plan2: F.plan2, plan5: F.plan5, pg: F.postgradLoan }[plan];
  const loan = loanFig ? Math.max(0, salary - loanFig.value) * loanFig.rate / 100 : 0;
  return { salary, pa, pension, tax, ni: nic, loan, net: salary - pension - tax - nic - loan };
}

export const moneyCalculators = {
  takehome(root, a, { figures }) {
    const F = figures.figures;
    root.innerHTML = card('Take-home pay calculator',
      slider('salary', 'Yearly pay before deductions', { min: 0, max: 80000, step: 250, value: a.salary ?? 25000 })
      + `<div class="row">${select('region', 'Where you live', [['ruk', 'England, Wales or NI'], ['scot', 'Scotland']], a.region || 'ruk')}`
      + `${select('plan', 'Student loan', [['none', 'None'], ['plan5', 'Plan 5'], ['plan2', 'Plan 2'], ['pg', 'Postgraduate']], a.plan || 'none')}</div>`
      + slider('pensionPct', 'Your pension contribution', { min: 0, max: 10, step: 1, value: a.pension ?? 5 })
      + `<div class="stats">${stat('Income tax', 'tax')}${stat('National Insurance', 'ni')}${stat('Student loan', 'loan')}${stat('Pension', 'pension')}</div>`
      + `<div class="stats">${stat('Take-home a year', 'net', 'good')}${stat('Take-home a month', 'month', 'good')}</div><div class="split" aria-hidden="true"></div>`,
      `Tax year ${esc(figures.taxYear)}. The pension is modelled as a workplace scheme taken from pay from ${esc(F.aeBand.display)} before tax. A rough guide: real payslips can differ slightly because they're worked out each pay period.`);
    wire(root, { salary: pounds, pensionPct: v => `${v}% of qualifying pay` }, (v, set) => {
      const p = payslip(F, { salary: v.salary, region: v.region, plan: v.plan, pensionPct: v.pensionPct });
      set('tax', gbp(p.tax)); set('ni', gbp(p.ni)); set('loan', gbp(p.loan)); set('pension', gbp(p.pension));
      set('net', gbp(p.net)); set('month', gbp(p.net / 12));
      const parts = [['net', p.net, 'Take-home'], ['tax', p.tax, 'Tax'], ['ni', p.ni, 'NI'], ['loan', p.loan, 'Loan'], ['pension', p.pension, 'Pension']];
      root.querySelector('.split').innerHTML = v.salary > 0
        ? parts.filter(x => x[1] > 0).map(([k, val, name]) => `<span class="seg seg-${k}" style="flex:${val}" title="${name}"></span>`).join('') : '';
    });
  },

  budget(root, a) {
    root.innerHTML = card('Monthly budget',
      slider('income', 'Take-home pay a month', { min: 200, max: 4000, step: 25, value: a.income ?? 1600 })
      + slider('needs', 'Needs (rent, bills, travel, food)', { min: 0, max: 3000, step: 25, value: a.needs ?? 850 })
      + slider('wants', 'Wants (going out, subscriptions, clothes)', { min: 0, max: 2000, step: 25, value: a.wants ?? 450 })
      + slider('goal', 'Savings goal', { min: 250, max: 20000, step: 250, value: a.goal ?? 1500 })
      + `<div class="stats">${stat('Left to save', 'save', 'good')}${stat('Savings rate', 'rate')}${stat('Months to goal', 'months')}</div>`
      + `<div class="split" aria-hidden="true"></div><p class="small muted" data-v="rule"></p>`,
      'The 50/30/20 split (needs / wants / saving) is a starting point, not a rule. Rent alone can be more than half of pay in some areas.');
    wire(root, { income: pounds, needs: pounds, wants: pounds, goal: pounds }, (v, set) => {
      const save = v.income - v.needs - v.wants;
      set('save', save >= 0 ? gbp(save, 0) : `−${gbp(-save, 0)}`);
      root.querySelector('[data-stat="save"]').className = `stat ${save >= 0 ? 'good' : 'bad'}`;
      set('rate', save > 0 ? `${Math.round((save / v.income) * 100)}%` : '0%');
      set('months', save > 0 ? `${Math.ceil(v.goal / save)}` : 'never');
      const n = Math.round((v.needs / v.income) * 100), w = Math.round((v.wants / v.income) * 100);
      set('rule', save < 0 ? 'You are spending more than you earn: something has to give.' : `Your split: ${n}% needs, ${w}% wants, ${Math.max(0, 100 - n - w)}% saving.`);
      root.querySelector('.split').innerHTML = [['needs', v.needs], ['wants', v.wants], ['net', Math.max(0, save)]].map(([k, x]) => `<span class="seg seg-${k}" style="flex:${x}"></span>`).join('');
    });
  },

  savingsgoal(root, a) {
    root.innerHTML = card('Savings goal: how long?',
      slider('goal', 'Goal', { min: 250, max: 20000, step: 250, value: a.goal ?? 1500 })
      + slider('monthly', 'You save each month', { min: 10, max: 1000, step: 10, value: a.monthly ?? 150 })
      + slider('aer', 'Account rate (AER)', { min: 0, max: 7, step: 0.1, value: a.aer ?? 4.5 })
      + `<div class="stats">${stat('Months to goal', 'months', 'good')}${stat('Interest earned', 'interest')}${stat('At 1% instead', 'low')}</div>`,
      'AER already includes compounding. The calculator adds interest monthly, which is how most easy-access accounts pay.');
    const run = (goal, monthly, aer) => {
      const r = (1 + aer / 100) ** (1 / 12) - 1;
      let bal = 0, m = 0, paid = 0;
      while (bal < goal && m < 1200) { bal = bal * (1 + r) + monthly; paid += monthly; m++; }
      return { m, interest: bal - paid };
    };
    wire(root, { goal: pounds, monthly: pounds, aer: pct }, (v, set) => {
      const x = run(v.goal, v.monthly, v.aer), y = run(v.goal, v.monthly, 1);
      set('months', `${x.m}`); set('interest', gbp(x.interest)); set('low', `${y.m} months, ${gbp(y.interest)}`);
    });
  },

  debt(root, a) {
    root.innerHTML = card('Paying off a credit card',
      slider('balance', 'Balance', { min: 100, max: 10000, step: 50, value: a.balance ?? 1500 })
      + slider('apr', 'APR', { min: 0, max: 45, step: 0.5, value: a.apr ?? 24.9 })
      + slider('pay', 'You pay each month', { min: 10, max: 1000, step: 5, value: a.pay ?? 100 })
      + `<div class="stats">${stat('Clear in', 'months', 'good')}${stat('Interest paid', 'interest', 'warm')}</div>`
      + `<div class="stats">${stat('Minimum payments only: clear in', 'minMonths', 'bad')}${stat('Minimum payments only: interest', 'minInterest', 'bad')}</div><div data-chart></div>`,
      'Minimum payment modelled as interest + 1% of the balance, or £5 if more. Card minimums vary: check yours. Assumes no new spending and a fixed rate.');
    const run = (bal, apr, payFn) => {
      const r = (1 + apr / 100) ** (1 / 12) - 1;
      let m = 0, interest = 0; const pts = [[0, bal]];
      while (bal > 0.005 && m < 600) {
        const i = bal * r; interest += i;
        const pay = Math.min(bal + i, payFn(bal, i));
        if (pay <= i && m > 0) return { m: Infinity, interest, pts };
        bal = bal + i - pay; m++; pts.push([m, bal]);
      }
      return { m, interest, pts };
    };
    const span = m => (m === Infinity || m >= 600 ? 'never (payment too low)' : m >= 24 ? `${Math.floor(m / 12)} yrs ${m % 12} mths` : `${m} months`);
    wire(root, { balance: pounds, apr: pct, pay: pounds }, (v, set) => {
      const mine = run(v.balance, v.apr, () => v.pay);
      const min = run(v.balance, v.apr, (b, i) => Math.max(5, i + b * 0.01));
      set('months', span(mine.m)); set('interest', mine.m === Infinity ? '—' : gbp(mine.interest));
      set('minMonths', span(min.m)); set('minInterest', gbp(min.interest));
      const thin = pts => pts.filter((_, k) => k % Math.max(1, Math.ceil(pts.length / 60)) === 0 || k === pts.length - 1);
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: `Balance falls to zero in ${span(mine.m)} paying ${gbp(v.pay, 0)} a month, against ${span(min.m)} on minimum payments`,
        series: [
          { name: `Paying ${gbp(v.pay, 0)} a month`, tone: 'a', points: thin(mine.pts) },
          { name: 'Minimum payments', tone: 'b', dashed: true, points: thin(min.pts) },
        ],
        yFmt: moneyShort, xFmt: m => (m >= 24 ? `${Math.round(m / 12)} yr` : `${m} mth`),
      });
    });
  },

  lisa(root, a, { figures }) {
    const F = figures.figures, cap = F.lisaLimit.value;
    root.innerHTML = card('Lifetime ISA bonus',
      slider('pay', 'You pay in each year', { min: 0, max: cap, step: 100, value: a.pay ?? 2000 })
      + slider('years', 'Years before you buy', { min: 1, max: 15, step: 1, value: a.years ?? 5 })
      + slider('growth', 'Interest or growth a year', { min: 0, max: 7, step: 0.5, value: a.growth ?? 4 })
      + `<div class="stats">${stat('You put in', 'paid')}${stat('Government bonus', 'bonus', 'good')}${stat('Pot at the end', 'pot', 'good')}</div>`
      + `<div class="stats">${stat('If you took it out for something else', 'early', 'bad')}${stat('Of that, your own money lost', 'lost', 'bad')}</div>`,
      `Bonus ${F.lisaLimit.bonus}% on up to ${esc(F.lisaLimit.display)} a year (${esc(figures.taxYear)}). First home must cost ${esc(F.lisaHomeCap.display)} or less and the account must be open 12 months. Other withdrawals before 60 lose ${F.lisaHomeCap.charge}%.`);
    wire(root, { pay: pounds, years: v => `${v}`, growth: pct }, (v, set) => {
      let pot = 0;
      for (let y = 0; y < v.years; y++) pot = (pot + v.pay * 1.25) * (1 + v.growth / 100);
      const paid = v.pay * v.years, bonus = v.pay * 0.25 * v.years;
      set('paid', gbp(paid, 0)); set('bonus', gbp(bonus, 0)); set('pot', gbp(pot, 0));
      const early = pot * (1 - F.lisaHomeCap.charge / 100);
      set('early', gbp(early, 0));
      const own = paid * (pot / (paid * 1.25 || 1));
      set('lost', own > early ? gbp(own - early, 0) : '£0');
    });
  },

  // Plan 5 in today's money: interest is RPI only, so the balance doesn't grow above inflation.
  studentloan(root, a, { figures }) {
    const F = figures.figures, th = F.plan5.value, rate = F.plan5.rate / 100;
    root.innerHTML = card('Plan 5 student loan: what you\'d really repay',
      slider('borrowed', 'Total borrowed', { min: 10000, max: 90000, step: 10, value: a.borrowed ?? 61860 })
      + slider('salary', 'Starting salary after uni', { min: 18000, max: 60000, step: 500, value: a.salary ?? 28000 })
      + slider('growth', 'Pay rises a year above inflation', { min: 0, max: 5, step: 0.5, value: a.growth ?? 2 })
      + `<div class="stats">${stat('First year: repay a month', 'month')}${stat('Total repaid', 'total', 'warm')}${stat('Cleared?', 'cleared')}</div><div data-chart></div>`,
      `Plan 5: ${F.plan5.rate}% of pay above ${esc(F.plan5.display)}, written off 40 years after you're first due to repay. Shown in today's money: Plan 5 interest is set at RPI inflation (${esc(F.plan5Interest.display)} for ${esc('2026/27')}), so it doesn't grow above inflation. Assumes steady pay rises and no gaps in work. An illustration only.`);
    wire(root, { borrowed: pounds, salary: pounds, growth: pct }, (v, set) => {
      let paid = 0, s = v.salary, year = 0; const pts = [[0, v.borrowed]];
      for (year = 1; year <= 40 && paid < v.borrowed - 0.5; year++) {
        paid += Math.min(Math.max(0, (s - th) * rate), v.borrowed - paid);
        s *= 1 + v.growth / 100;
        pts.push([year, v.borrowed - paid]);
      }
      const cleared = paid >= v.borrowed - 0.5;
      set('month', gbp(Math.max(0, (v.salary - th) * rate) / 12));
      set('total', gbp(paid, 0));
      set('cleared', cleared ? `Yes, after ${pts.length - 1} years` : `No: ${gbp(v.borrowed - paid, 0)} written off`);
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: cleared ? `Loan cleared after ${pts.length - 1} years` : `Loan written off after 40 years with ${gbp(v.borrowed - paid, 0)} left`,
        series: [{ name: 'Balance left (today\'s money)', tone: 'b', points: pts }],
        yFmt: moneyShort, xFmt: x => `yr ${x}`,
      });
    });
  },

  pension(root, a, { figures }) {
    const F = figures.figures, band = F.aeBand;
    root.innerHTML = card('Workplace pension',
      slider('salary', 'Yearly pay', { min: 10000, max: 80000, step: 500, value: a.salary ?? 25000 })
      + slider('me', 'You pay', { min: 0, max: 15, step: 1, value: a.me ?? 5 })
      + slider('boss', 'Your employer pays', { min: 3, max: 15, step: 1, value: a.boss ?? 3 })
      + slider('start', 'Starting age', { min: 16, max: 50, step: 1, value: a.start ?? 22 })
      + slider('growth', 'Growth a year after inflation', { min: 0, max: 6, step: 0.5, value: a.growth ?? 3 })
      + `<div class="stats">${stat('Each month: you', 'mine')}${stat('Employer adds', 'theirs', 'good')}${stat('Costs you after tax relief', 'cost')}</div>`
      + `<div class="stats">${stat('Pot at 67, in today\'s money', 'pot', 'good')}${stat('Cost to you after tax relief', 'paid')}</div><div data-chart></div>`,
      `Contributions on pay from ${esc(band.display)} (minimums: ${esc(F.aeMinimum.display)}). Assumes a basic-rate taxpayer, pay rising with inflation and steady growth, which real markets never give. An illustration, not a forecast.`);
    wire(root, { salary: pounds, me: v => `${v}%`, boss: v => `${v}%`, start: v => `${v}`, growth: pct }, (v, set) => {
      const q = clamp(v.salary, band.value, band.upper) - band.value;
      const mine = q * v.me / 100, theirs = q * v.boss / 100;
      set('mine', gbp(mine / 12)); set('theirs', gbp(theirs / 12)); set('cost', gbp((mine * 0.8) / 12));
      const years = Math.max(0, 67 - v.start);
      let pot = 0; const pts = [[v.start, 0]];
      for (let y = 1; y <= years; y++) { pot = (pot + mine + theirs) * (1 + v.growth / 100); pts.push([v.start + y, pot]); }
      set('pot', gbp(pot, 0)); set('paid', gbp(mine * years * 0.8, 0));
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: `Pension pot grows to ${gbp(pot, 0)} by 67`, series: [{ name: 'Pot (today\'s money)', tone: 'a', points: pts }],
        yFmt: moneyShort, xFmt: x => `age ${x}`,
      });
    });
  },
};
