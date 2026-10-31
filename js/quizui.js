// Question cards and the quiz runner (module quizzes, recall checks, checkpoints, quick checks).
import { esc, el } from './util.js';
import { mark, score, combineScores } from './quiz.js';
import { canSpeak, speak } from './speech.js';

const TYPE_LABEL = { mcq: 'Pick one', tf: 'True or false', number: 'Number', order: 'Put in order', match: 'Match up', explain: 'Explain', long: 'Written answer' };

function inputFor(q) {
  switch (q.type) {
    case 'mcq':
      return `<div class="options" role="radiogroup">${q.options.map((o, i) => `<button type="button" class="option" role="radio" aria-checked="false" data-v="${i}">${esc(o)}</button>`).join('')}</div>`;
    case 'tf':
      return `<div class="options two" role="radiogroup"><button type="button" class="option" role="radio" aria-checked="false" data-v="true">True</button><button type="button" class="option" role="radio" aria-checked="false" data-v="false">False</button></div>`;
    case 'number':
      return `<label class="input-unit">${q.unit === '£' ? '<span>£</span>' : ''}<input inputmode="decimal" autocomplete="off" aria-label="Your answer"${q.unit && q.unit !== '£' ? ` placeholder="${esc(q.unit)}"` : ''}>${q.unit && q.unit !== '£' ? `<span>${esc(q.unit)}</span>` : ''}</label>`;
    case 'order':
      return `<p class="small muted order-hint">Drag to reorder, or use the arrows.</p><ol class="order">${q.shown.map(it => `<li data-item="${esc(it)}"><span class="grip" aria-hidden="true">⠿</span><span class="order-text">${esc(it)}</span><span class="order-btns"><button type="button" class="icon-btn" data-move="-1" aria-label="Move up">▲</button><button type="button" class="icon-btn" data-move="1" aria-label="Move down">▼</button></span></li>`).join('')}</ol>`;
    case 'match':
      return `<div class="match">${q.pairs.map(([l], i) => `<label class="match-row"><span>${esc(l)}</span><select data-left="${esc(l)}" aria-label="${esc(l)}"><option value="">Choose…</option>${q.rightShown.map(r => `<option>${esc(r)}</option>`).join('')}</select></label>`).join('')}</div>`;
    case 'explain':
      return `<textarea rows="4" aria-label="Your answer" placeholder="Write a sentence or two"></textarea>`;
    case 'long':
      return '<textarea rows="12" aria-label="Your answer"></textarea>';
  }
  return '';
}

export function readResponse(card, q) {
  switch (q.type) {
    case 'mcq': { const s = card.querySelector('.option[aria-checked="true"]'); return s ? +s.dataset.v : null; }
    case 'tf': { const s = card.querySelector('.option[aria-checked="true"]'); return s ? s.dataset.v === 'true' : null; }
    case 'number': { const v = card.querySelector('input').value.trim(); return v || null; }
    case 'order': return [...card.querySelectorAll('.order li')].map(li => li.dataset.item);
    case 'match': {
      const out = {};
      for (const s of card.querySelectorAll('select')) { if (!s.value) return null; out[s.dataset.left] = s.value; }
      return out;
    }
    case 'explain': case 'long': { const v = card.querySelector('textarea').value.trim(); return v || null; }
  }
}

// The clicks and dragging that any answer needs. Nothing moves once a card has the class "marked".
function wireAnswer(card, q) {
  card.addEventListener('click', e => {
    const opt = e.target.closest('.option');
    if (opt && !card.classList.contains('marked')) {
      for (const o of opt.parentElement.children) o.setAttribute('aria-checked', String(o === opt));
    }
    const mv = e.target.closest('[data-move]');
    if (mv && !card.classList.contains('marked')) {
      const li = mv.closest('li');
      flip(li.parentElement, () => {
        if (mv.dataset.move === '-1' && li.previousElementSibling) li.parentElement.insertBefore(li, li.previousElementSibling);
        if (mv.dataset.move === '1' && li.nextElementSibling) li.parentElement.insertBefore(li.nextElementSibling, li);
      });
      mv.focus();
    }
  });
  if (q.type === 'order') makeSortable(card.querySelector('.order'), () => card.classList.contains('marked'));
}

function fillResponse(card, q, value) {
  if (value === null || value === undefined) return;
  switch (q.type) {
    case 'mcq': case 'tf': card.querySelector(`.option[data-v="${value}"]`)?.setAttribute('aria-checked', 'true'); break;
    case 'number': card.querySelector('input').value = value; break;
    case 'explain': case 'long': card.querySelector('textarea').value = value; break;
    case 'order': {
      const list = card.querySelector('.order');
      for (const item of value) { const li = [...list.children].find(x => x.dataset.item === item); if (li) list.append(li); }
      break;
    }
    case 'match': for (const s of card.querySelectorAll('select')) s.value = value[s.dataset.left] ?? ''; break;
  }
}

// One question for set work: no Check button and no answers here, because the database does the marking.
export function answerCard(q, { number, initial } = {}) {
  const card = el(`<div class="card question" data-type="${q.type}">
    <div class="q-head"><span class="eyebrow">Question ${number} · ${TYPE_LABEL[q.type]} · ${q.marks} mark${q.marks > 1 ? 's' : ''}</span></div>
    <p class="q">${esc(q.text)}</p>
    <div class="answer">${inputFor(q)}</div>
  </div>`);
  card.querySelector('textarea')?.setAttribute('maxlength', q.type === 'long' ? '15000' : '2000');
  wireAnswer(card, q);
  fillResponse(card, q, initial);
  return card;
}

// Sends a report. Set by app.js when someone is signed in; the button stays away when it isn't set.
let reporter = null;
export const setReporter = fn => { reporter = fn; };

function reportBox(card, q) {
  const wrap = el(`<details class="report"><summary class="small muted">Report a problem</summary>
    <form><label class="field">What's wrong?<select name="reason"><option value="wrong">Wrong answer</option><option value="typo">Typo</option><option value="unclear">Unclear</option></select></label>
    <label class="field">Anything to add? (optional)<input name="note" maxlength="500"></label><button class="btn ghost">Send</button></form><p class="small report-msg" role="status" aria-live="polite"></p></details>`);
  const msg = wrap.querySelector('.report-msg');
  wrap.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await reporter(q.id || `check: ${q.text.slice(0, 100)}`, e.target.reason.value, e.target.note.value); // quick checks in lessons have no id
      e.target.remove();
      msg.textContent = 'Thanks. We\'ll take a look.';
    } catch (err) { msg.textContent = err?.code === 'CN212' ? 'You\'ve sent a lot of reports today. Try again tomorrow.' : 'That didn\'t send. Try again.'; }
  });
  card.append(wrap);
}

// One question. onResult(result) fires when marked, and again if marks are claimed.
export function questionCard(q, { label, onResult, number } = {}) {
  const card = el(`<div class="card question" data-type="${q.type}">
    <div class="q-head"><span class="eyebrow">${esc(label || `${number ? `Question ${number} · ` : ''}${TYPE_LABEL[q.type]}${q.marks > 1 ? ` · ${q.marks} marks` : ''}`)}</span>${canSpeak() ? '<button type="button" class="icon-btn speak-btn" aria-label="Read the question aloud">🔊</button>' : ''}</div>
    <p class="q">${esc(q.text)}</p>
    <div class="answer">${inputFor(q)}</div>
    <button type="button" class="btn check-btn">Check</button>
    <div class="feedback" aria-live="polite"></div>
  </div>`);

  card.querySelector('.speak-btn')?.addEventListener('click', () => {
    const opts = q.type === 'mcq' ? q.options.map((o, i) => `Option ${i + 1}: ${o}.`).join(' ') : q.type === 'tf' ? 'True or false?' : '';
    speak([{ text: `${q.text} ${opts}` }]);
  });
  wireAnswer(card, q);
  if (reporter) reportBox(card, q);
  const num = card.querySelector('input');
  if (num) num.addEventListener('keydown', e => { if (e.key === 'Enter') card.querySelector('.check-btn').click(); });

  card.querySelector('.check-btn').addEventListener('click', () => {
    const response = readResponse(card, q);
    const fb = card.querySelector('.feedback');
    if (response === null) { fb.innerHTML = `<p class="hint">Answer first, then check.</p>`; return; }
    const m = mark(q, response);
    const result = { qid: q.id, topic: q.topic, module: q.module, marks: m.marks, outOf: m.outOf, correct: m.correct, claimed: 0, response };
    card.classList.add('marked', m.correct ? 'is-right' : m.marks ? 'is-part' : 'is-wrong');
    card.querySelector('.check-btn').remove();
    for (const c of card.querySelectorAll('.answer input, .answer textarea, .answer select, .answer button')) c.disabled = true;
    showOptionMarks(card, q, response);
    fb.innerHTML = feedbackHtml(q, m);
    const claim = fb.querySelector('.claim');
    if (claim) claim.addEventListener('click', () => {
      result.claimed = m.outOf - m.marks;
      claim.replaceWith(el(`<p class="claimed">Claimed ${result.claimed} mark${result.claimed > 1 ? 's' : ''}. They count towards passing, not XP.</p>`));
      onResult && onResult(result);
    });
    onResult && onResult(result);
  });
  return card;
}

// Animates list items from their old to their new positions after `change` moves them in the DOM.
function flip(list, change) {
  const items = [...list.children];
  const before = new Map(items.map(li => [li, li.getBoundingClientRect().top]));
  change();
  for (const li of items) {
    if (li.classList.contains('dragging')) continue;
    const dy = before.get(li) - li.getBoundingClientRect().top;
    if (!dy) continue;
    li.style.transition = 'none';
    li.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => { li.style.transition = 'transform .18s ease'; li.style.transform = ''; });
  }
}

// Drag to reorder (mouse, pen or finger). The grabbed item follows the pointer; the rest slide round it.
function makeSortable(list, locked) {
  let drag = null;
  list.addEventListener('pointerdown', e => {
    const li = e.target.closest('li');
    if (!li || locked() || e.target.closest('button') || e.button > 0) return;
    e.preventDefault();
    li.setPointerCapture(e.pointerId);
    const listTop = list.getBoundingClientRect().top;
    drag = { li, grab: e.clientY - listTop - li.offsetTop };
    li.classList.add('dragging');
    list.classList.add('sorting');
  });
  list.addEventListener('pointermove', e => {
    if (!drag) return;
    const { li, grab } = drag;
    const y = e.clientY - list.getBoundingClientRect().top - grab; // where the item's top should be
    const mid = y + li.offsetHeight / 2;
    const others = [...list.children].filter(x => x !== li);
    const target = others.find(x => mid < x.offsetTop + x.offsetHeight / 2) || null;
    if (target !== li.nextElementSibling) flip(list, () => list.insertBefore(li, target));
    li.style.transform = `translateY(${y - li.offsetTop}px)`;
  });
  const end = () => {
    if (!drag) return;
    const { li } = drag;
    drag = null;
    li.style.transition = 'transform .15s ease';
    li.style.transform = '';
    li.classList.remove('dragging');
    list.classList.remove('sorting');
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
}

function showOptionMarks(card, q, response) {
  if (q.type === 'mcq' || q.type === 'tf') {
    for (const o of card.querySelectorAll('.option')) {
      const v = q.type === 'tf' ? o.dataset.v === 'true' : +o.dataset.v;
      if (v === q.answer) o.classList.add('right');
      else if (v === response) o.classList.add('wrong');
    }
  }
  if (q.type === 'match') {
    for (const s of card.querySelectorAll('select')) {
      const right = q.pairs.find(p => p[0] === s.dataset.left)[1];
      s.closest('.match-row').classList.add(s.value === right ? 'right' : 'wrong');
    }
  }
}

function feedbackHtml(q, m) {
  const verdict = m.correct ? 'Correct' : m.marks ? `${m.marks} of ${m.outOf} marks` : 'Not quite';
  let html = `<p class="verdict">${verdict}</p>`;
  if (q.type === 'explain') {
    html += `<ul class="ideas">${m.detail.map(f => `<li class="${f.hit ? 'hit' : 'miss'}"><span aria-hidden="true">${f.hit ? '✓' : '✗'}</span><span class="sr">${f.hit ? 'Found: ' : 'Missing: '}</span>${esc(f.label)}</li>`).join('')}</ul>`;
    html += `<div class="model"><strong>Model answer</strong><p>${esc(q.model)}</p></div>`;
    if (m.marks < m.outOf) html += `<button type="button" class="btn ghost claim">I had this: claim ${m.outOf - m.marks} mark${m.outOf - m.marks > 1 ? 's' : ''}</button><p class="small muted">Claimed marks count towards passing but don't earn XP.</p>`;
  } else if (!m.correct) {
    html += `<p><strong>Answer:</strong> ${esc(q.correctText)}</p>`;
  }
  if (q.whyText) html += `<p class="why">${esc(q.whyText)}</p>`;
  return html;
}

// Runs a list of questions one at a time, then shows the result.
// opts: { kind, title, passMark, onFinish(summary) -> extra html, onRetry, carry, afterRender(container) }
// carry: an earlier part marked with this one ({ title, auto, claimed, outOf }, e.g. the module's recall
// check). The pass is then worked out from both; summary.part is this quiz's own score.
export function runQuiz(container, questions, opts) {
  const results = new Array(questions.length).fill(null);
  let i = 0;
  const graded = opts.kind !== 'recall';
  container._questions = questions; // read by tests/browser_test.py

  function dots() {
    return `<div class="dots" aria-hidden="true">${questions.map((_, k) => {
      const r = results[k];
      const cls = k === i ? 'now' : !r ? '' : r.correct ? 'right' : r.marks || r.claimed ? 'part' : 'wrong';
      return `<span class="${cls}"></span>`;
    }).join('')}</div>`;
  }

  function show() {
    container.innerHTML = `<div class="quiz-head"><span class="muted">Question ${i + 1} of ${questions.length}${graded ? ` · pass ${Math.round(opts.passMark * 100)}%` : ''}</span>${dots()}</div>`;
    const card = questionCard(questions[i], {
      number: i + 1,
      onResult: r => {
        results[i] = r;
        container.querySelector('.dots').outerHTML = dots();
        if (!card.querySelector('.next-btn')) {
          const last = i === questions.length - 1;
          const next = el(`<button type="button" class="btn next-btn">${last ? 'See my result' : 'Next question'}</button>`);
          next.addEventListener('click', () => {
            card.querySelectorAll('.claim').forEach(b => b.remove());
            if (last) finish(); else { i++; show(); container.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
          });
          card.append(next);
        }
      },
    });
    container.append(card);
  }

  function finish() {
    const part = score(results, opts.passMark);
    const c = opts.carry;
    const s = c ? combineScores([c, part], opts.passMark) : part;
    const pct = Math.round(s.pct * 100);
    const missed = [...new Set(results.filter(r => !r.correct).map(r => r.topic).filter(Boolean))];
    const extra = opts.onFinish({ ...s, part, results, missed }) || '';
    const marks = x => `${x.auto + x.claimed} of ${x.outOf}${x.claimed ? ` (${x.claimed} claimed)` : ''}`;
    const parts = c ? `<ul class="score-parts"><li><span>${esc(c.title)}</span><strong>${marks(c)}</strong></li><li><span>${esc(opts.title)}</span><strong>${marks(part)}</strong></li><li class="total"><span>Together</span><strong>${marks(s)} · ${pct}%</strong></li></ul>` : '';
    const verdict = !graded ? `${s.auto} of ${s.outOf} right`
      : s.passed ? (s.claimed && !s.autoPassed ? 'Passed, with claimed marks' : 'Passed') : `Not yet: you need ${Math.round(opts.passMark * 100)}%`;
    container.innerHTML = `<div class="card result ${graded ? (s.passed ? 'pass' : 'fail') : ''}">
      <span class="eyebrow">${esc(opts.title)}</span>
      ${graded ? `<div class="big-score"><strong>${pct}%</strong><span class="muted">${s.auto + s.claimed} of ${s.outOf}${s.claimed ? ` (${s.claimed} claimed)` : ''}</span></div>
      <div class="pass-bar"><div style="width:${pct}%"></div><i style="left:${opts.passMark * 100}%"></i></div>${parts}` : ''}
      <p class="verdict">${verdict}</p>
      ${missed.length ? `<p class="muted">To go over: ${missed.map(esc).join(' · ')}. ${graded ? 'These come back in your recall checks.' : ''}</p>` : ''}
      ${extra}
      <div class="row">${opts.onRetry ? `<button type="button" class="btn retry">${graded ? 'Retry with new questions' : 'Again'}</button>` : ''}<button type="button" class="btn ghost review">Review answers</button></div>
      <div class="review-list" hidden></div>
    </div>`;
    const retry = container.querySelector('.retry');
    if (retry) retry.addEventListener('click', opts.onRetry);
    if (opts.afterRender) opts.afterRender(container);
    container.querySelector('.review').addEventListener('click', () => {
      const list = container.querySelector('.review-list');
      list.hidden = !list.hidden;
      list.innerHTML = questions.map((q, k) => {
        const r = results[k];
        return `<div class="review-item ${r.correct ? 'right' : 'wrong'}"><p class="q">${k + 1}. ${esc(q.text)}</p>
          <p class="small">Your answer: ${esc(formatResponse(q, r.response))} · ${r.marks}/${r.outOf}${r.claimed ? ` (+${r.claimed} claimed)` : ''}</p>
          <p class="small"><strong>Answer:</strong> ${esc(q.correctText)}</p>${q.whyText ? `<p class="small why">${esc(q.whyText)}</p>` : ''}</div>`;
      }).join('');
    });
  }

  show();
}

function formatResponse(q, r) {
  if (q.type === 'mcq') return q.options[r];
  if (q.type === 'tf') return r ? 'True' : 'False';
  if (q.type === 'order') return r.join(' → ');
  if (q.type === 'match') return Object.entries(r).map(([l, v]) => `${l}: ${v}`).join(' · ');
  return String(r);
}
