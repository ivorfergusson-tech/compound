// Small inline-SVG charts. Colours come from CSS variables (--chart-a, -b, -c, --grid, --muted),
// so they follow light and dark mode.
import { esc } from './util.js';

const W = 340, H = 210, PAD = { l: 54, r: 14, t: 14, b: 30 };

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

// series: [{ name, points: [[x, y]], tone: 'a'|'b'|'c', dashed }]
export function lineChart({ series, yFmt = v => v, xFmt = v => v, label, yMin = 0, xTicks, area }) {
  const xs = series.flatMap(s => s.points.map(p => p[0]));
  const ys = series.flatMap(s => s.points.map(p => p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = yMin, y1 = niceMax(Math.max(...ys));
  const px = x => PAD.l + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const py = y => H - PAD.b - ((y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = y0 + ((y1 - y0) * i) / 4;
    grid += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${py(v)}" y2="${py(v)}" class="ch-grid"/>`
      + `<text x="${PAD.l - 6}" y="${py(v) + 4}" text-anchor="end" class="ch-label">${esc(yFmt(v))}</text>`;
  }
  const ticks = xTicks || [x0, x0 + (x1 - x0) / 2, x1].map(v => Math.round(v));
  for (const t of ticks) grid += `<text x="${px(t)}" y="${H - 8}" text-anchor="middle" class="ch-label">${esc(xFmt(t))}</text>`;

  const lines = series.map(s => {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join('');
    const fill = area && s === series[0]
      ? `<path d="${d}L${px(s.points.at(-1)[0])},${py(y0)}L${px(s.points[0][0])},${py(y0)}Z" class="ch-area-${s.tone}"/>` : '';
    return `${fill}<path d="${d}" class="ch-line ch-${s.tone}${s.dashed ? ' ch-dash' : ''}"/>`;
  }).join('');

  const ends = series.map(s => {
    const [x, y] = s.points.at(-1);
    return `<circle cx="${px(x)}" cy="${py(y)}" r="4" class="ch-dot-${s.tone}"/>`;
  }).join('');

  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${grid}${lines}${ends}</svg>`
    + `<figcaption class="legend">${series.map(s => `<span><i class="key ch-${s.tone}${s.dashed ? ' dash' : ''}"></i>${esc(s.name)}</span>`).join('')}</figcaption></figure>`;
}

export const money0 = v => '£' + Math.round(v).toLocaleString('en-GB');
export const moneyShort = v => (v >= 1000 ? '£' + +(v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : money0(v));
