// Turns a lesson's Markdown into sections, then fills in its blocks
// (quick checks, calculators, charts, guesses, callouts, reveals). Format: CLAUDE.md.
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js';
import { esc, niceDate } from './util.js';
import { calculators, charts } from './calculators.js';
import { questionCard } from './quizui.js';
import { instantiate } from './quiz.js';

const BLOCK = /^:::([a-z0-9]+)[ \t]*(.*)\r?\n([\s\S]*?)^:::[ \t]*$/gm;

function inline(md, { figures, glossary }) {
  return md
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, key, text) => {
      const k = key.trim().toLowerCase();
      const g = glossary[k];
      return `<button type="button" class="term" data-term="${esc(k)}">${esc(text || (g ? g.term.toLowerCase() : key))}</button>`;
    })
    .replace(/\{\{fig:(\w+)(\+?)\}\}/g, (m, key, long) => {
      const f = figures.figures[key];
      if (!f) return `[missing figure ${esc(key)}]`;
      const asOf = long ? ` <span class="fig-asof">(${esc(f.asOf)})</span>` : '';
      return `<span class="fig"><strong>${esc(f.display)}</strong>${asOf}<button type="button" class="fig-chip" data-fig="${esc(key)}" aria-label="Where this figure comes from">checked ${esc(niceDate(f.checked).replace(/ \d{4}$/, ''))}</button></span>`;
    });
}

export function parseLesson(md, ctx) {
  const blocks = [];
  const body = md.replace(BLOCK, (m, name, arg, inner) => {
    blocks.push({ name, arg: arg.trim(), body: inner });
    return `\n\n<div class="blk" data-blk="${blocks.length - 1}"></div>\n\n`;
  });
  const parts = inline(body, ctx).split(/^## +(.+)$/m);
  const sections = [];
  if (parts[0].trim()) sections.push({ title: null, html: marked.parse(parts[0]) });
  for (let i = 1; i < parts.length; i += 2) sections.push({ title: parts[i].trim(), html: marked.parse(parts[i + 1] || '') });
  return { sections, blocks };
}

function splitArg(arg) {
  const m = arg.match(/^(\S+)\s*(\{.*\})?$/);
  return m ? { name: m[1], args: m[2] ? JSON.parse(m[2]) : {} } : { name: arg, args: {} };
}

export function hydrateBlocks(root, blocks, ctx) {
  for (const holder of root.querySelectorAll('[data-blk]')) {
    const b = blocks[+holder.dataset.blk];
    try {
      mountBlock(holder, b, ctx);
    } catch (e) {
      console.error('block failed', b, e);
      holder.innerHTML = `<p class="muted">This part didn't load.</p>`;
    }
  }
}

function mountBlock(holder, b, ctx) {
  switch (b.name) {
    case 'check': {
      const q = instantiate(JSON.parse(b.body));
      holder.replaceWith(questionCard(q, { label: 'Quick check · not scored' }));
      break;
    }
    case 'calc': {
      const { name, args } = splitArg(b.arg);
      calculators[name](holder, args, ctx);
      break;
    }
    case 'chart': {
      const { name, args } = splitArg(b.arg);
      charts[name](holder, args, ctx);
      break;
    }
    case 'guess': guessBlock(holder, JSON.parse(b.arg || '{}'), ctx); break;
    case 'myanswer': { // shows something the learner wrote earlier: :::myanswer 00-guess
      const saved = ctx.progress.state.guesses[b.arg];
      holder.outerHTML = `<aside class="callout"><span class="eyebrow">What you wrote before</span>`
        + (saved ? `<p class="pre">${esc(saved)}</p>` : `<p class="muted">${marked.parseInline(inline(b.body.trim() || 'You didn\'t write an answer then. Write one now below.', ctx))}</p>`) + '</aside>';
      break;
    }
    case 'callout': {
      const kind = b.arg || 'note';
      const titles = { idea: 'The idea in one sentence', note: 'Note', warn: 'Watch out', paper: 'Paper trading only' };
      holder.outerHTML = `<aside class="callout callout-${esc(kind)}"><span class="eyebrow">${titles[kind] || esc(kind)}</span>${marked.parse(inline(b.body, ctx))}</aside>`;
      break;
    }
    case 'reveal':
      holder.outerHTML = `<details class="reveal"><summary>${esc(b.arg)}</summary><div>${marked.parse(inline(b.body, ctx))}</div></details>`;
      break;
    default:
      holder.innerHTML = '';
  }
}

function guessBlock(holder, a, { progress, moduleId }) {
  const key = a.id || `${moduleId}-guess`;
  const saved = progress.state.guesses[key];
  if (a.kind === 'text') {
    holder.outerHTML = `<div class="card guess"><p class="q">${esc(a.prompt)}</p>`
      + `<textarea data-guess="${esc(key)}" rows="4" aria-label="Your answer">${esc(saved || '')}</textarea><span class="saved-note" aria-live="polite"></span></div>`;
    const ta = document.querySelector(`[data-guess="${CSS.escape(key)}"]`);
    let t;
    ta.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { progress.saveGuess(key, ta.value); ta.nextElementSibling.textContent = 'Saved'; }, 600);
    });
    return;
  }
  const render = () => {
    const g = progress.state.guesses[key];
    holder.innerHTML = `<div class="card guess"><p class="q">${esc(a.prompt)}</p>`
      + (g != null
        ? `<p class="guess-locked">Your guess: <strong>${esc(a.unit === '£' ? '£' + g : g)}</strong>. Check it against the worked example.</p>`
        : `<form class="row"><label class="input-unit">${a.unit === '£' ? '<span>£</span>' : ''}<input inputmode="decimal" aria-label="Your guess" required></label><button class="btn">Lock it in</button></form>`)
      + '</div>';
    const form = holder.querySelector('form');
    if (form) form.addEventListener('submit', e => {
      e.preventDefault();
      progress.saveGuess(key, form.querySelector('input').value.trim());
      render();
    });
  };
  render();
}
