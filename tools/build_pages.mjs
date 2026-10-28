// Builds a plain, readable page for every lesson (m/<id>/index.html), a lesson list (m/index.html)
// and sitemap.xml, so search engines can find each lesson. The interactive course stays at #/m/<id>.
// Run after changing any lesson, figure or course.json: node tools/build_pages.mjs
// (node tests/run.js fails if the pages are out of date.)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SITE = 'https://ivorfergusson-tech.github.io/compound/';
const ROOT = new URL('../', import.meta.url);
const MARKED_URL = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js'; // same version as js/lesson.js
const BLOCK = /^:::([a-z0-9]+)[ \t]*(.*)\r?\n([\s\S]*?)^:::[ \t]*$/gm;
const CALLOUT_TITLES = { idea: 'The idea in one sentence', note: 'Note', warn: 'Watch out', paper: 'Paper trading only' };
const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230E7C6B'/%3E%3Ctext x='16' y='23' font-size='20' font-family='Arial' font-weight='700' fill='white' text-anchor='middle'%3E£%3C/text%3E%3C/svg%3E";

const read = p => readFileSync(new URL(p, ROOT), 'utf8');
const json = p => JSON.parse(read(p));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// marked is fetched once from the CDN and kept in .tmp/, so the site and this script use the same file.
async function loadMarked() {
  const local = new URL('.tmp/marked-12.0.2.esm.js', ROOT);
  if (!existsSync(local)) {
    const r = await fetch(MARKED_URL);
    if (!r.ok) throw new Error(`Couldn't fetch marked: ${r.status}`);
    mkdirSync(new URL('.tmp/', ROOT), { recursive: true });
    writeFileSync(local, await r.text());
  }
  return (await import(local.href)).marked;
}

function inline(md, figures, glossary) {
  return md
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, key, text) => {
      const g = glossary[key.trim().toLowerCase()];
      return text || (g ? g.term.toLowerCase() : key);
    })
    .replace(/\{\{fig:(\w+)(\+?)\}\}/g, (m, key, long) => {
      const f = figures.figures[key];
      if (!f) throw new Error(`missing figure ${key}`);
      return `<strong>${esc(f.display)}</strong>${long ? ` <span class="fig-asof">(${esc(f.asOf)})</span>` : ''}`;
    });
}

// Text blocks (callouts, reveals) are kept; interactive ones become a pointer to the course.
function staticBlock(name, arg, body, ctx) {
  const { marked, figures, glossary, href } = ctx;
  if (name === 'callout') {
    const kind = arg || 'note';
    return `<aside class="callout callout-${esc(kind)}"><span class="eyebrow">${CALLOUT_TITLES[kind] || esc(kind)}</span>${marked.parse(inline(body, figures, glossary))}</aside>`;
  }
  if (name === 'reveal') return `<details class="reveal"><summary>${esc(arg)}</summary><div>${marked.parse(inline(body, figures, glossary))}</div></details>`;
  if (name === 'calc' || name === 'chart') return `<p class="static-interactive"><a href="${href}">Try the ${name === 'calc' ? 'calculator' : 'chart'} in the interactive lesson →</a></p>`;
  return ''; // check, guess, myanswer: only make sense in the course
}

function lessonPage(item, ctx) {
  const { course, figures, glossary, marked, quiz } = ctx;
  const md = read(`content/modules/${item.id}.md`);
  const href = `../../#/m/${item.id}`;
  let blocks = 0;
  const body = md.replace(BLOCK, (m, name, arg, inner) => { blocks++; return `\n\n${staticBlock(name, arg.trim(), inner, { ...ctx, href })}\n\n`; });
  const parts = inline(body, figures, glossary).split(/^## +(.+)$/m);
  const sections = [];
  if (parts[0].trim()) sections.push(`<section class="lesson-section">${marked.parse(parts[0])}</section>`);
  for (let i = 1; i < parts.length; i += 2) sections.push(`<section class="lesson-section"><h2>${esc(parts[i].trim())}</h2>${marked.parse(parts[i + 1] || '')}</section>`);

  // same reading-time rule as js/app.js
  const minutes = Math.max(5, Math.round(md.split(/\s+/).length / 200) + (quiz ? 10 : 0) + blocks);
  const strand = course.strands[item.strand];
  const used = [...md.matchAll(/\{\{fig:(\w+)/g)].map(m => figures.figures[m[1]].checked).sort();
  const pages = course.items.filter(i => i.kind !== 'checkpoint' && course.ready.includes(i.id));
  const idx = pages.indexOf(item);
  const link = (it, dir) => it ? `<a class="nav-${dir}" href="../${it.id}/"><span class="muted">${dir === 'prev' ? '← Previous' : 'Next →'}</span><span>${esc(it.short || it.title)}</span></a>` : '<span></span>';
  const label = item.kind === 'intro' ? 'Introduction' : `Module ${item.num}`;
  const title = item.kind === 'intro' ? 'Introduction to Compound' : `${item.title}`;
  const description = `${item.summary} ${label} of Compound, a free UK finance course with quizzes and calculators.`;

  return pageShell({
    title: `${title} · Compound`, description, path: `m/${item.id}/`, up: '../../',
    main: `<article class="lesson">
      <header class="lesson-head">
        <span class="pill${strand ? ` strand-pill-${item.strand}` : ''}">${strand ? `${strand.emoji} ${esc(strand.name)} · ${esc(item.level)}` : 'Start here'}</span>
        <h1>${esc(item.title)}</h1>
        <p class="muted">${label} of 32 · about ${minutes} minutes${used.length ? ` · figures checked ${esc(niceDate(used[0]))}` : ''}</p>
        ${item.strand === 'trading' ? `<aside class="callout callout-paper"><span class="eyebrow">Paper trading only</span><p>Education only, not financial advice. Practise with pretend money; most people who trade with real money lose it.</p></aside>` : ''}
        <aside class="callout"><span class="eyebrow">Reading version</span><p>This is the text of the lesson. The interactive version adds quick checks, calculators${quiz ? ', the module quiz' : ''} and XP, and saves your progress.</p><a class="btn" href="${href}">Open the interactive lesson</a></aside>
      </header>
      ${sections.join('\n')}
      <section class="card">
        <h2>${quiz ? 'Take the quiz' : 'Start the course'}</h2>
        <p>${quiz ? `Pass the ${label.toLowerCase()} quiz to unlock the next module. ` : ''}Modules unlock one at a time as you go. It's free, and you don't need an account.</p>
        <a class="btn" href="${href}">Open the interactive lesson</a>
      </section>
      <nav class="prev-next">${link(pages[idx - 1], 'prev')}${link(pages[idx + 1], 'next')}</nav>
    </article>`,
  });
}

function listPage({ course }) {
  const pages = course.items.filter(i => i.kind !== 'checkpoint' && course.ready.includes(i.id));
  const groups = Object.entries(course.strands).map(([k, s]) => {
    const mine = pages.filter(i => i.strand === k);
    return `<section class="card"><h2>${s.emoji} ${esc(s.name)}</h2><p class="muted">${esc(s.blurb)}</p><ol class="lesson-list">${mine.map(i => `<li value="${i.num}"><a href="${i.id}/">${esc(i.title)}</a> <span class="muted small">${esc(i.level)}</span></li>`).join('')}</ol></section>`;
  }).join('\n');
  return pageShell({
    title: 'All lessons · Compound', path: 'm/', up: '../',
    description: 'Every lesson in Compound, a free UK finance course: money, investing, trading and the finance industry, from beginner to advanced.',
    main: `<h1>All lessons</h1>
      <p>32 modules in four strands, plus an <a href="00/">introduction</a>. These are the reading versions. For quizzes, calculators, XP and the leaderboard, <a href="../">open the course</a>.</p>
      ${groups}`,
  });
}

function pageShell({ title, description, path, up, main }) {
  const url = SITE + path;
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Compound">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}img/share.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="en_GB">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#0E7C6B">
  <link rel="icon" href="${FAVICON}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap">
  <link rel="stylesheet" href="${up}css/app.css">
  <script>var t='dark';try{if(localStorage.getItem('compound.theme')==='light')t='light';}catch(e){}document.documentElement.dataset.theme=t;</script>
</head>
<body>
  <header class="top">
    <a class="brand" href="${up}"><span class="logo" aria-hidden="true">£</span><span>Compound</span></a>
    <nav class="top-nav static-nav" aria-label="Main"><a href="${up}m/">All lessons</a><a href="${up}#/glossary">Glossary</a></nav>
  </header>
  <main class="page">
    ${main}
  </main>
  <footer class="foot">
    <p><strong>Education only, not financial advice.</strong> Trading in this course is paper only.</p>
    <p>UK rules (England, Wales and Northern Ireland; Scotland flagged where income tax differs). Every changing figure shows when it was checked.</p>
    <p>Made by Ivor Fergusson · <a href="${up}#/about">About and sources</a> · <a href="${up}privacy.html">Privacy</a></p>
  </footer>
</body>
</html>
`;
}

function niceDate(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function sitemap(course) {
  const pages = course.items.filter(i => i.kind !== 'checkpoint' && course.ready.includes(i.id));
  const urls = ['', 'm/', ...pages.map(i => `m/${i.id}/`), 'privacy.html'];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}\n</urlset>\n`;
}

// Every generated file, as { path: contents }.
export async function build() {
  const marked = await loadMarked();
  const course = json('content/course.json'), figures = json('content/figures.json'), glossary = json('content/glossary.json');
  const out = { 'm/index.html': listPage({ course }), 'sitemap.xml': sitemap(course) };
  for (const item of course.items) {
    if (item.kind === 'checkpoint' || !course.ready.includes(item.id)) continue;
    const quizFile = new URL(`content/quizzes/${item.id}.json`, ROOT);
    const quiz = existsSync(quizFile);
    out[`m/${item.id}/index.html`] = lessonPage(item, { course, figures, glossary, marked, quiz });
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = await build();
  let changed = 0;
  for (const [p, text] of Object.entries(files)) {
    const url = new URL(p, ROOT);
    if (existsSync(url) && readFileSync(url, 'utf8').replace(/\r\n/g, '\n') === text.replace(/\r\n/g, '\n')) continue;
    mkdirSync(new URL('./', url), { recursive: true });
    writeFileSync(url, text);
    changed++;
  }
  console.log(`${Object.keys(files).length} files, ${changed} changed`);
}
