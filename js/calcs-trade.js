// Trading-strand calculators and charts. All price data here is made up (generated from a fixed seed),
// labelled as such on screen. Paper trading only.
import { esc, gbp } from './util.js';
import { lineChart } from './charts.js';
import { seededRng } from './quiz.js';

const pct = v => `${+(+v).toFixed(2)}%`;
const pounds = v => gbp(v, 0);

function slider(id, label, s) {
  return `<label class="slider"><span class="slider-top"><span>${esc(label)}</span><output data-out="${id}"></output></span>`
    + `<input type="range" data-in="${id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}" aria-label="${esc(label)}"></label>`;
}
const stat = (label, id, tone = '') => `<div class="stat ${tone}" data-stat="${id}"><span>${esc(label)}</span><strong data-v="${id}"></strong></div>`;
const card = (title, body, note) => `<div class="calc"><h3 class="calc-title">${esc(title)}</h3>${body}${note ? `<p class="calc-note">${note}</p>` : ''}</div>`;
const madeUp = '<p class="small muted made-up">Made-up price data for learning, not a real market.</p>';

function wire(root, fmts, draw) {
  const update = () => {
    const v = {};
    for (const el of root.querySelectorAll('[data-in]')) v[el.dataset.in] = el.type === 'checkbox' ? el.checked : el.tagName === 'TEXTAREA' ? el.value : parseFloat(el.value);
    for (const [k, f] of Object.entries(fmts)) { const o = root.querySelector(`[data-out="${k}"]`); if (o) o.textContent = f(v[k], v); }
    draw(v, (id, text) => { const e = root.querySelector(`[data-v="${id}"]`); if (e) e.textContent = text; });
  };
  root.addEventListener('input', update);
  root.addEventListener('change', update);
  update();
}

// ---------- price data and maths ----------

// A made-up market: rises, ranges between about 100 and 110, then breaks out upward.
export function makeCandles(seed = 7, n = 70) {
  const rng = seededRng(seed);
  const out = [];
  let price = 84;
  for (let i = 0; i < n; i++) {
    let drift;
    if (i < 18) drift = 0.9;
    else if (i < 52) drift = (price > 107.5 ? -2.2 : price < 102 ? 2.2 : (rng() - 0.5) * 3);
    else drift = 0.8;
    const o = price;
    const c = Math.max(60, o + drift + (rng() - 0.5) * 3);
    const h = Math.max(o, c) + rng() * 1.8;
    const l = Math.min(o, c) - rng() * 1.8;
    const v = Math.round(1000 + rng() * 800 + (i >= 52 && i < 56 ? 2200 : 0) + Math.abs(c - o) * 150);
    out.push({ o, h, l, c, v });
    price = c;
  }
  return out;
}

// Support and resistance of the sideways stretch (days 20 to 51): its lowest low and highest high.
export function rangeLevels(candles, from = 20, to = 51) {
  const part = candles.slice(from, to + 1);
  return { support: Math.min(...part.map(c => c.l)), resistance: Math.max(...part.map(c => c.h)) };
}

export function sma(values, n) {
  return values.map((_, i) => (i < n - 1 ? null : values.slice(i - n + 1, i + 1).reduce((s, x) => s + x, 0) / n));
}

export function rsi(closes, n = 14) {
  const out = closes.map(() => null);
  let gain = 0, loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    if (i <= n) {
      gain += Math.max(0, ch); loss += Math.max(0, -ch);
      if (i === n) { gain /= n; loss /= n; out[i] = 100 - 100 / (1 + gain / (loss || 1e-9)); }
      continue;
    }
    gain = (gain * (n - 1) + Math.max(0, ch)) / n;
    loss = (loss * (n - 1) + Math.max(0, -ch)) / n;
    out[i] = 100 - 100 / (1 + gain / (loss || 1e-9));
  }
  return out;
}

// Chance of at least one run of k losses in a row in n trades, each a loss with probability q.
export function streakChance(n, k, q) {
  // dp[j] = probability of being on a current losing run of j with no run of k yet
  let dp = new Array(k).fill(0); dp[0] = 1;
  let hit = 0;
  for (let t = 0; t < n; t++) {
    const next = new Array(k).fill(0);
    for (let j = 0; j < k; j++) {
      next[0] += dp[j] * (1 - q);
      if (j + 1 === k) hit += dp[j] * q; else next[j + 1] += dp[j] * q;
    }
    dp = next;
  }
  return hit;
}

export function tradeStats(rs) {
  const wins = rs.filter(r => r > 0), losses = rs.filter(r => r <= 0);
  let eq = 0, peak = 0, maxDd = 0, run = 0, longest = 0;
  const curve = [[0, 0]];
  rs.forEach((r, i) => {
    eq += r; peak = Math.max(peak, eq); maxDd = Math.max(maxDd, peak - eq);
    run = r <= 0 ? run + 1 : 0; longest = Math.max(longest, run);
    curve.push([i + 1, eq]);
  });
  return {
    n: rs.length, winRate: rs.length ? wins.length / rs.length : 0,
    avgWin: wins.length ? wins.reduce((s, x) => s + x, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((s, x) => s + x, 0) / losses.length : 0,
    expectancy: rs.length ? eq / rs.length : 0, total: eq, maxDd, longest, curve,
  };
}

// ---------- candlestick chart (inline SVG, follows light/dark) ----------
export function candleChart(candles, { lines = [], overlays = [], volume = false, label = 'Candlestick chart' } = {}) {
  const W = 340, H = volume ? 250 : 210, P = { l: 34, r: 8, t: 10, b: volume ? 60 : 22 };
  const lo = Math.min(...candles.map(c => c.l)) - 1, hi = Math.max(...candles.map(c => c.h)) + 1;
  const plotH = H - P.t - P.b, step = (W - P.l - P.r) / candles.length, bw = Math.max(2, step * 0.6);
  const y = v => P.t + (1 - (v - lo) / (hi - lo)) * plotH;
  const x = i => P.l + step * i + step / 2;
  let svg = '';
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="ch-grid"/><text x="${P.l - 4}" y="${y(v) + 4}" text-anchor="end" class="ch-label">${Math.round(v)}</text>`;
  }
  candles.forEach((c, i) => {
    const up = c.c >= c.o, top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
    svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${y(c.h)}" y2="${y(c.l)}" class="${up ? 'cd-up' : 'cd-down'}"/>`
      + `<rect x="${x(i) - bw / 2}" y="${top}" width="${bw}" height="${Math.max(1, bot - top)}" class="${up ? 'cd-up-body' : 'cd-down-body'}"/>`;
  });
  for (const o of overlays) {
    const d = o.values.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
    if (d.length) svg += `<polyline points="${d.join(' ')}" class="ch-line ch-${o.tone}" style="stroke-width:2"/>`;
  }
  for (const ln of lines) {
    svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(ln.y)}" y2="${y(ln.y)}" class="ch-line ch-${ln.tone} ch-dash" style="stroke-width:2"/>`
      + `<text x="${P.l + 4}" y="${y(ln.y) + (ln.below ? 13 : -5)}" class="ch-label ch-tag">${esc(ln.label)}</text>`;
  }
  if (volume) {
    const vmax = Math.max(...candles.map(c => c.v)), vb = H - 8, vh = 40;
    candles.forEach((c, i) => {
      const h = (c.v / vmax) * vh;
      svg += `<rect x="${x(i) - bw / 2}" y="${vb - h}" width="${bw}" height="${h}" class="vol-bar"/>`;
    });
    svg += `<text x="${P.l - 4}" y="${vb - vh / 2}" text-anchor="end" class="ch-label">vol</text>`;
  }
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${svg}</svg></figure>`;
}

function legend(items) {
  return `<div class="legend">${items.map(([tone, name, dashed]) => `<span><i class="key ch-${tone}${dashed ? ' dash' : ''}"></i>${esc(name)}</span>`).join('')}`
    + '<span><i class="cd-key up"></i>Up candle</span><span><i class="cd-key down"></i>Down candle</span></div>';
}

// ---------- calculators ----------
export const tradeCalculators = {
  ev(root, a) {
    root.innerHTML = card('Expected value of a bet or trade',
      slider('p', 'Chance of winning', { min: 1, max: 99, step: 1, value: a.p ?? 50 })
      + slider('win', 'You win', { min: 1, max: 500, step: 1, value: a.win ?? 100 })
      + slider('lose', 'You lose', { min: 1, max: 500, step: 1, value: a.lose ?? 100 })
      + `<div class="stats">${stat('Expected value per go', 'ev', 'good')}${stat('Over 100 goes, on average', 'ev100')}</div>`,
      'Expected value = (chance of winning × win) − (chance of losing × loss). Positive means you gain on average over many goes; negative means you lose on average, however lucky any one go feels.');
    wire(root, { p: v => `${v}%`, win: pounds, lose: pounds }, (v, set) => {
      const ev = (v.p / 100) * v.win - (1 - v.p / 100) * v.lose;
      set('ev', `${ev >= 0 ? '+' : '−'}${gbp(Math.abs(ev), 2)}`); set('ev100', `${ev >= 0 ? '+' : '−'}${gbp(Math.abs(ev * 100), 0)}`);
      root.querySelector('[data-stat="ev"]').className = `stat ${ev >= 0 ? 'good' : 'bad'}`;
    });
  },

  leverage(root, a) {
    root.innerHTML = card('Leverage: how a small move becomes a big one',
      slider('dep', 'Your deposit (margin)', { min: 50, max: 5000, step: 50, value: a.dep ?? 500 })
      + slider('lev', 'Leverage', { min: 1, max: 30, step: 1, value: a.lev ?? 20 })
      + slider('move', 'The market moves', { min: -10, max: 10, step: 0.5, value: a.move ?? -2 })
      + `<div class="stats">${stat('Position size', 'size')}${stat('Profit or loss', 'pl', 'good')}${stat('Of your deposit', 'pc', 'good')}</div>`
      + `<p class="small" data-v="note"></p>`,
      'FCA rules cap retail leverage at between 30:1 and 2:1, close positions when your funds fall to half the margin needed, and stop you losing more than your account. Ignores spreads and overnight charges, which make it worse.');
    wire(root, { dep: pounds, lev: v => `${v}:1`, move: v => `${v > 0 ? '+' : ''}${v}%` }, (v, set) => {
      const size = v.dep * v.lev, pl = size * v.move / 100, pc = pl / v.dep * 100;
      set('size', gbp(size, 0)); set('pl', `${pl >= 0 ? '+' : '−'}${gbp(Math.abs(pl), 0)}`); set('pc', `${pc >= 0 ? '+' : ''}${pc.toFixed(0)}%`);
      for (const id of ['pl', 'pc']) root.querySelector(`[data-stat="${id}"]`).className = `stat ${pl >= 0 ? 'good' : 'bad'}`;
      set('note', pc <= -50 ? 'At this point the provider would close your position (funds below half the margin needed).' : `A ${Math.abs(v.move)}% move in the market is a ${Math.abs(pc).toFixed(0)}% ${pl >= 0 ? 'gain' : 'loss'} on your deposit.`);
    });
  },

  spread(root, a) {
    root.innerHTML = card('The spread: starting every trade behind',
      slider('mid', 'Market price', { min: 10, max: 500, step: 1, value: a.mid ?? 100 })
      + slider('sp', 'Spread (ask − bid)', { min: 0.01, max: 2, step: 0.01, value: a.sp ?? 0.2 })
      + slider('qty', 'Number of shares or units', { min: 10, max: 5000, step: 10, value: a.qty ?? 500 })
      + `<div class="stats">${stat('You buy at (ask)', 'ask')}${stat('You could sell at (bid)', 'bid')}${stat('Down straight away', 'cost', 'bad')}</div>`,
      'You buy at the higher ask and sell at the lower bid, so every round trip starts with a loss equal to the spread. Busy, liquid markets have tight spreads; quiet ones wide spreads.');
    wire(root, { mid: v => gbp(v, 2), sp: v => gbp(v, 2), qty: v => `${v}` }, (v, set) => {
      set('ask', gbp(v.mid + v.sp / 2, 2)); set('bid', gbp(v.mid - v.sp / 2, 2)); set('cost', gbp(v.sp * v.qty, 2));
    });
  },

  candles(root, a) {
    const cs = makeCandles(a.seed ?? 7);
    const lv = rangeLevels(cs);
    root.innerHTML = card('Reading a chart',
      `<div class="row"><label class="check"><input type="checkbox" data-in="sr" ${a.lines === false ? '' : 'checked'}> Show support and resistance</label>`
      + `<label class="check"><input type="checkbox" data-in="weekly"> Weekly candles (5 days each)</label></div><div data-chart></div>${madeUp}`,
      'Each candle shows one period: the body runs from the open to the close; the thin wicks show the high and low. Hollow = closed higher than it opened; filled = closed lower.');
    wire(root, {}, v => {
      let data = cs;
      if (v.weekly) {
        data = [];
        for (let i = 0; i < cs.length; i += 5) {
          const w = cs.slice(i, i + 5);
          data.push({ o: w[0].o, c: w.at(-1).c, h: Math.max(...w.map(c => c.h)), l: Math.min(...w.map(c => c.l)), v: w.reduce((s, c) => s + c.v, 0) });
        }
      }
      root.querySelector('[data-chart]').innerHTML = candleChart(data, {
        label: `Made-up price rising, then moving sideways between about ${Math.round(lv.support)} and ${Math.round(lv.resistance)}, then breaking above ${Math.round(lv.resistance)}`,
        lines: v.sr ? [{ y: lv.resistance, label: 'Resistance', tone: 'b' }, { y: lv.support, label: 'Support', tone: 'a', below: true }] : [],
      }) + legend(v.sr ? [['b', 'Resistance', true], ['a', 'Support', true]] : []);
    });
  },

  indicators(root, a) {
    const cs = makeCandles(a.seed ?? 7);
    const closes = cs.map(c => c.c);
    root.innerHTML = card('Moving average, RSI and volume',
      slider('ma', 'Moving average length (days)', { min: 3, max: 30, step: 1, value: a.ma ?? 10 })
      + `<label class="check"><input type="checkbox" data-in="vol" checked> Show volume</label><div data-chart></div><div data-rsi></div>${madeUp}`,
      'A moving average smooths prices over the last N days: longer = smoother but slower to turn. RSI (14-day) runs from 0 to 100; above 70 is often called overbought, below 30 oversold. Both are worked out from past prices, so they lag.');
    wire(root, { ma: v => `${v}` }, v => {
      root.querySelector('[data-chart]').innerHTML = candleChart(cs, {
        label: `Made-up prices with a ${v.ma}-day moving average`, volume: v.vol,
        overlays: [{ tone: 'c', values: sma(closes, v.ma) }],
      }) + legend([['c', `${v.ma}-day moving average`]]);
      const r = rsi(closes);
      root.querySelector('[data-rsi]').innerHTML = lineChart({
        label: 'RSI of the made-up prices', yMin: 0,
        series: [
          { name: 'RSI (14)', tone: 'a', points: r.map((x, i) => [i, x]).filter(p => p[1] != null) },
          { name: '70 overbought', tone: 'b', dashed: true, points: [[14, 70], [cs.length - 1, 70]] },
          { name: '30 oversold', tone: 'c', dashed: true, points: [[14, 30], [cs.length - 1, 30]] },
        ],
        yFmt: x => `${Math.round(x)}`, xFmt: x => `${x}`, xTicks: [14, 40, cs.length - 1],
      });
    });
  },

  position(root, a) {
    root.innerHTML = card('Position size from your risk',
      slider('acct', 'Paper account size', { min: 500, max: 50000, step: 500, value: a.acct ?? 10000 })
      + slider('risk', 'Risk per trade', { min: 0.25, max: 5, step: 0.25, value: a.risk ?? 1 })
      + slider('entry', 'Entry price', { min: 1, max: 200, step: 0.5, value: a.entry ?? 50 })
      + slider('stop', 'Stop-loss price', { min: 0.5, max: 199, step: 0.5, value: a.stop ?? 48 })
      + slider('target', 'Target price', { min: 1, max: 260, step: 0.5, value: a.target ?? 56 })
      + `<div class="stats">${stat('Most you can lose', 'riskgbp', 'warm')}${stat('Position size', 'qty', 'good')}${stat('Costs', 'value')}</div>`
      + `<div class="stats">${stat('Reward : risk', 'rr', 'good')}${stat('Profit if target hit', 'win')}${stat('Win rate needed to break even', 'be')}</div>`
      + `<p class="small" data-v="warn"></p>`,
      'Position size = money at risk ÷ (entry − stop). 1R is the amount you risk. A long (buy) trade: stop below entry, target above. Ignores spreads and gaps through your stop.');
    wire(root, { acct: pounds, risk: pct, entry: v => gbp(v, 2), stop: v => gbp(v, 2), target: v => gbp(v, 2) }, (v, set) => {
      const r = v.acct * v.risk / 100, per = v.entry - v.stop;
      if (per <= 0 || v.target <= v.entry) {
        ['qty', 'value', 'rr', 'win', 'be'].forEach(id => set(id, '—')); set('riskgbp', gbp(r, 0));
        set('warn', 'For a long trade, put the stop below the entry and the target above it.'); return;
      }
      const qty = Math.floor(r / per), rr = (v.target - v.entry) / per;
      set('riskgbp', gbp(r, 0)); set('qty', `${qty} shares`); set('value', gbp(qty * v.entry, 0));
      set('rr', `${rr.toFixed(2)} : 1`); set('win', gbp(qty * (v.target - v.entry), 0)); set('be', `${Math.round(100 / (1 + rr))}%`);
      set('warn', qty * v.entry > v.acct ? 'This position costs more than the account: you\'d need leverage. Widen the stop or skip the trade.' : '');
    });
  },

  expectancy(root, a) {
    root.innerHTML = card('Expectancy and losing streaks',
      slider('wr', 'Win rate', { min: 10, max: 90, step: 1, value: a.wr ?? 40 })
      + slider('aw', 'Average win, in R', { min: 0.5, max: 5, step: 0.1, value: a.aw ?? 2 })
      + slider('al', 'Average loss, in R', { min: 0.5, max: 2, step: 0.1, value: a.al ?? 1 })
      + slider('k', 'Losing streak to check', { min: 3, max: 15, step: 1, value: a.k ?? 6 })
      + `<div class="stats">${stat('Expectancy per trade', 'exp', 'good')}${stat('Over 100 trades', 'r100')}</div>`
      + `<div class="stats">${stat('Chance of that streak in 100 trades', 'streak', 'warm')}</div>`,
      'Expectancy = (win rate × average win) − (loss rate × average loss), in R. Even a good strategy has long losing streaks; risking 1% per trade is what lets you survive them.');
    wire(root, { wr: v => `${v}%`, aw: v => `${v.toFixed(1)}R`, al: v => `${v.toFixed(1)}R`, k: v => `${v} losses in a row` }, (v, set) => {
      const e = (v.wr / 100) * v.aw - (1 - v.wr / 100) * v.al;
      set('exp', `${e >= 0 ? '+' : ''}${e.toFixed(2)}R`); set('r100', `${e >= 0 ? '+' : ''}${(e * 100).toFixed(0)}R`);
      root.querySelector('[data-stat="exp"]').className = `stat ${e >= 0 ? 'good' : 'bad'}`;
      set('streak', `${Math.round(streakChance(100, v.k, 1 - v.wr / 100) * 100)}%`);
    });
  },

  review(root, a, { progress, moduleId }) {
    const key = `${moduleId}-trades`;
    const saved = progress.state.guesses[key] || '';
    root.innerHTML = card('Review your paper trades',
      `<label class="field">Your results in R, one per trade, separated by commas (e.g. 2, -1, -1, 1.5)<textarea data-in="rs" rows="3" placeholder="2, -1, -1, 1.5, ...">${esc(saved)}</textarea></label>`
      + (a.example ? `<button type="button" class="btn ghost try-example">Try the example trades</button>` : '')
      + `<div class="stats">${stat('Trades', 'n')}${stat('Win rate', 'wr')}${stat('Expectancy', 'exp', 'good')}</div>`
      + `<div class="stats">${stat('Average win', 'aw')}${stat('Average loss', 'al')}${stat('Biggest drawdown', 'dd', 'warm')}${stat('Longest losing run', 'run')}</div><div data-chart></div>`,
      'Saved with your account. Expectancy is your average result per trade in R. Twenty trades is a small sample: treat the numbers as clues, not proof.');
    let t, example = false;
    const btn = root.querySelector('.try-example');
    if (btn) btn.addEventListener('click', () => {
      const ta = root.querySelector('textarea');
      ta.value = a.example; example = true;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    root.querySelector('textarea').addEventListener('keydown', () => { example = false; });
    wire(root, {}, (v, set) => {
      const rs = String(v.rs).split(/[\s,;]+/).map(s => parseFloat(s.replace('−', '-'))).filter(Number.isFinite);
      clearTimeout(t);
      if (!example) t = setTimeout(() => progress.saveGuess(key, v.rs), 800);
      if (!rs.length) { ['n', 'wr', 'exp', 'aw', 'al', 'dd', 'run'].forEach(id => set(id, '—')); root.querySelector('[data-chart]').innerHTML = ''; return; }
      const s = tradeStats(rs);
      set('n', `${s.n}`); set('wr', `${Math.round(s.winRate * 100)}%`); set('exp', `${s.expectancy >= 0 ? '+' : ''}${s.expectancy.toFixed(2)}R`);
      set('aw', `${s.avgWin.toFixed(2)}R`); set('al', `${s.avgLoss.toFixed(2)}R`); set('dd', `${s.maxDd.toFixed(1)}R`); set('run', `${s.longest}`);
      root.querySelector('[data-stat="exp"]').className = `stat ${s.expectancy >= 0 ? 'good' : 'bad'}`;
      root.querySelector('[data-chart]').innerHTML = lineChart({
        label: `Running total ${s.total.toFixed(1)}R after ${s.n} trades`, yMin: Math.min(0, ...s.curve.map(p => p[1])),
        series: [{ name: 'Running total (R)', tone: 'a', points: s.curve }], yFmt: x => `${x.toFixed(0)}R`, xFmt: x => `${x}`,
      });
    });
  },
};
