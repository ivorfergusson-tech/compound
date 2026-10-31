// Assignments: teachers set work, students do it, the database marks it. All data goes through the functions in
// supabase/schema.sql; the browser never holds the answers to set questions until they're released.
import { esc, el } from './util.js';
import { instantiate } from './quiz.js';
import { answerCard, readResponse } from './quizui.js';
import { gate, problemFor, say, twoStep, date } from './classes.js';

const when = iso => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;

// ---------- pure helpers (tested in tests/run.js and tools/assign_sql_test.mjs) ----------
const KEEP = ['type', 'marks', 'text', 'topic', 'spec', 'options', 'answer', 'unit', 'answerValue', 'tol', 'items', 'shown', 'pairs', 'rightShown', 'ideas'];

// One concrete copy of a bank question, kept by the database with its answer. Numbers and options are randomised
// once here, so everyone in the class gets the same paper.
export function freeze(src) {
  const q = instantiate(src, { randomise: true });
  const out = { correctText: q.correctText, whyText: q.whyText };
  for (const k of KEEP) if (q[k] !== undefined) out[k] = q[k];
  return out;
}

// row needs: attempts, in_progress, first_submitted, lessons_done, lessons_at. a needs: questions, lessons, due_at.
export function statusOf(row, a, now = Date.now()) {
  const sub = Number(a.questions) === 0 || Boolean(row.first_submitted);
  const les = Number(row.lessons_done || 0) >= Number(a.lessons || 0);
  const due = a.due_at ? Date.parse(a.due_at) : null;
  if (sub && les) {
    const at = Math.max(row.first_submitted ? Date.parse(row.first_submitted) : 0, row.lessons_at ? Date.parse(row.lessons_at) : 0);
    const late = due !== null && at > due;
    return { key: late ? 'late' : 'done', label: late ? 'Finished late' : 'Finished', finished: true };
  }
  const overdue = due !== null && now > due;
  if (row.in_progress || row.first_submitted || row.lessons_done > 0) return { key: overdue ? 'overdue' : 'going', label: overdue ? 'Started, overdue' : 'In progress', finished: false };
  return { key: overdue ? 'overdue' : 'todo', label: overdue ? 'Overdue' : 'Not started', finished: false };
}

export function showResponse(item) {
  const r = item.response;
  if (r === null || r === undefined) return 'No answer';
  switch (item.type) {
    case 'mcq': return item.options?.[r] ?? 'No answer';
    case 'tf': return r ? 'True' : 'False';
    case 'order': return Array.isArray(r) ? r.join(' → ') : '';
    case 'match': return Object.entries(r).map(([l, x]) => `${l}: ${x}`).join(' · ');
    default: return String(r);
  }
}

export const clock = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};

// ---------- the list of work on a student's classes page ----------
export function workList(list) {
  if (!list.length) return '';
  return `<section class="card"><h2>Work set</h2><ul class="work-list">${list.map(a => {
    const s = statusOf({ ...a, in_progress: Boolean(a.open_sub), lessons_done: a.lessons.filter(l => l.done).length }, { ...a, lessons: a.lessons.length });
    return `<li><a href="#/work/${esc(a.id)}"><strong>${esc(a.title)}</strong>
      <span class="muted small">${esc(a.class_name)}${a.due_at ? ` · due ${esc(when(a.due_at))}` : ''}</span></a>
      <span class="work-tag s-${esc(s.key)}">${esc(s.label)}</span></li>`;
  }).join('')}</ul></section>`;
}

// ---------- doing the work ----------
const backupKey = id => `compound.work.${id}`;
const readBackup = id => { try { return JSON.parse(localStorage.getItem(backupKey(id))) || {}; } catch { return {}; } };
const writeBackup = (id, v) => { try { if (Object.keys(v).length) localStorage.setItem(backupKey(id), JSON.stringify(v)); else localStorage.removeItem(backupKey(id)); } catch { /* the database still has it */ } };

export async function viewWork(ctx, id) {
  const { shell, app, sync } = ctx;
  if (!gate(ctx, 'Work set')) return;
  const a = (await sync.rpc('my_assignments')).find(x => x.id === id);
  if (!a) return shell('<section class="card"><h1>Work not found</h1><p>This work isn\'t set for you, or it has been taken down.</p><a class="btn" href="#/classes">Back</a></section>', { title: 'Work set' });
  const left = a.max_attempts - Number(a.attempts);
  const hasQs = Number(a.questions) > 0;
  const canStart = hasQs && (a.open_sub || left > 0);
  shell(`<a class="small" href="#/classes">← Your classes</a><h1>${esc(a.title)}</h1>
    <p class="muted">${esc(a.class_name)}${a.due_at ? ` · due ${esc(when(a.due_at))}` : ''}</p>
    ${a.note ? `<p class="card">${esc(a.note)}</p>` : ''}
    ${a.lessons.length ? `<section class="card"><h2>Lessons</h2><ul class="work-list">${a.lessons.map(l => `<li><span>${esc(l.title)}</span><span class="work-tag ${l.done ? 's-done' : 's-todo'}">${l.done ? 'Passed' : 'To do'}</span></li>`).join('')}</ul>
      <p class="small muted">Pass each lesson's quiz. It ticks off here once your progress has synced.</p></section>` : ''}
    ${hasQs ? `<section class="card"><h2>Questions</h2>
      <p>${esc(plural(a.questions, 'question'))}, ${esc(plural(a.out_of, 'mark'))}. ${esc(plural(a.max_attempts, 'attempt'))} allowed${a.attempts ? `, ${esc(a.attempts)} used` : ''}.</p>
      ${a.minutes ? `<p><strong>Timed: ${esc(plural(a.minutes, 'minute'))}.</strong> The clock starts when you press Start and keeps running if you leave the page.</p>` : ''}
      <div class="row-between account-actions">
        ${canStart ? `<button type="button" class="btn start">${a.open_sub ? 'Carry on' : a.attempts ? 'Try again' : 'Start'}</button>` : '<span></span>'}
        ${a.best_sub ? `<a class="btn ghost" href="#/work/${esc(id)}/r/${esc(a.best_sub)}">Your best: ${esc(a.best_marks)}/${esc(a.out_of)}</a>` : ''}</div>
      <p class="auth-msg" role="status" aria-live="polite"></p></section>` : ''}`, { title: a.title });
  app.querySelector('.start')?.addEventListener('click', async e => {
    e.target.disabled = true;
    try { doWork(ctx, a, await sync.rpc('start_attempt', { p_assignment: id })); } catch (err) { e.target.disabled = false; say(app, problemFor(err)); }
  });
}

function doWork(ctx, a, sub) {
  const { shell, app, sync, onLeave } = ctx;
  const local = readBackup(sub.id);
  shell(`<div class="work-bar"><strong>${esc(a.title)}</strong>
      ${sub.deadline ? '<span class="work-clock" role="timer"></span>' : ''}<span class="small muted work-saved" role="status" aria-live="polite">Saved</span></div>
    <div class="work-qs"></div>
    <section class="card"><p class="work-count"></p><button type="button" class="btn wide hand-in">Hand in</button><p class="auth-msg" role="alert"></p></section>`, { title: a.title });
  const box = app.querySelector('.work-qs');
  const cards = sub.items.map((q, i) => {
    const key = String(q.position);
    const card = answerCard(q, { number: i + 1, initial: key in local ? local[key] : sub.answers[key] });
    box.append(card);
    return { key, q, card, base: JSON.stringify(readResponse(card, q)) };
  });
  const dirty = { ...local };
  let timer = null, closed = false, saving = false, handedIn = false;
  const saved = app.querySelector('.work-saved');
  // An order question always has a list in it, so it only counts once it has been moved.
  const answered = c => { const r = readResponse(c.card, c.q); return r !== null && !(c.q.type === 'order' && JSON.stringify(r) === JSON.stringify(c.q.shown)); };
  const count = () => { app.querySelector('.work-count').textContent = `${cards.filter(answered).length} of ${cards.length} answered`; };

  const collect = () => {
    for (const c of cards) {
      const now = JSON.stringify(readResponse(c.card, c.q));
      if (now !== c.base) { dirty[c.key] = JSON.parse(now); c.base = now; }
    }
    writeBackup(sub.id, dirty);
  };
  const showResult = () => { closed = true; location.hash = `#/work/${a.id}/r/${sub.id}`; };
  const save = async () => {
    if (saving || closed) return;
    collect();
    if (!Object.keys(dirty).length) return;
    saving = true;
    const sending = { ...dirty };
    try {
      const r = await sync.rpc('save_answers', { p_sub: sub.id, p_answers: sending });
      for (const k of Object.keys(sending)) if (JSON.stringify(dirty[k]) === JSON.stringify(sending[k])) delete dirty[k];
      writeBackup(sub.id, dirty);
      saved.textContent = 'Saved';
      if (r.closed) showResult();
    } catch {
      saved.textContent = 'Not saved yet. Your answers are on this device and will be sent when you reconnect.';
    }
    saving = false;
  };
  const changed = () => { count(); saved.textContent = 'Saving…'; clearTimeout(timer); timer = setTimeout(save, 1500); };
  box.addEventListener('input', changed);
  box.addEventListener('change', changed);
  box.addEventListener('click', e => { if (e.target.closest('button')) changed(); });
  box.addEventListener('pointerup', changed);
  count();

  const handIn = async () => {
    if (handedIn) return;
    handedIn = true;
    clearTimeout(timer);
    collect();
    try {
      await sync.rpc('submit_attempt', { p_sub: sub.id, p_answers: dirty });
      writeBackup(sub.id, {});
      showResult();
    } catch (err) {
      handedIn = false;
      say(app, err?.code ? problemFor(err) : "That didn't send. Your answers are safe on this device. Check your connection and try again.");
      const b = app.querySelector('.hand-in');
      b.disabled = false;
    }
  };
  twoStep(app.querySelector('.hand-in'), 'Sure? Hand in now', handIn);

  const retry = setInterval(save, 15000);
  window.addEventListener('online', save);
  let tick = null;
  if (sub.deadline) {
    const skew = Date.parse(sub.now) - Date.now(); // trust the server's clock, not the device's
    const face = app.querySelector('.work-clock');
    let warned = 0;
    const beat = () => {
      const left = Date.parse(sub.deadline) - (Date.now() + skew);
      face.textContent = clock(left);
      if (left <= 300000 && warned < 1) { warned = 1; saved.textContent = '5 minutes left.'; }
      if (left <= 60000 && warned < 2) { warned = 2; saved.textContent = '1 minute left.'; face.classList.add('urgent'); }
      if (left <= 0) { clearInterval(tick); handIn(); }
    };
    beat();
    tick = setInterval(beat, 1000);
  }
  onLeave(() => {
    clearInterval(retry); clearInterval(tick); clearTimeout(timer);
    window.removeEventListener('online', save);
    if (!closed) save();
  });
}

export async function viewResult(ctx, id, subId) {
  const { shell, sync } = ctx;
  if (!gate(ctx, 'Your work')) return;
  let r;
  try { r = await sync.rpc('my_result', { p_sub: subId }); } catch {
    return shell('<section class="card"><h1>Work not found</h1><a class="btn" href="#/classes">Back</a></section>', { title: 'Your work' });
  }
  shell(`<a class="small" href="#/work/${esc(id)}">← ${esc(r.title)}</a><h1>${esc(r.title)}</h1>
    <section class="card"><p class="join-big">${esc(r.marks)}/${esc(r.out_of)}</p><p class="muted small">Handed in ${esc(when(r.submitted_at))}. Marked by Compound; your teacher can change any mark.</p>
    ${r.released ? '' : `<p class="small">${r.due_at ? `Right answers appear after the due date, ${esc(when(r.due_at))}.` : 'Right answers appear when you\'ve used all your attempts.'}</p>`}</section>
    ${r.items.map((q, i) => `<section class="card question"><span class="eyebrow">Question ${i + 1} · ${esc(q.got ?? 0)}/${esc(q.marks)}</span>
      <p class="q">${esc(q.text)}</p><p><strong>Your answer:</strong> ${esc(showResponse(q))}</p>
      ${q.correct ? `<p><strong>Answer:</strong> ${esc(q.correct)}</p>` : ''}${q.why ? `<p class="muted">${esc(q.why)}</p>` : ''}
      ${q.teacher_note ? `<p><strong>Your teacher:</strong> ${esc(q.teacher_note)}</p>` : ''}</section>`).join('')}`, { title: r.title });
}

// ---------- teachers ----------
export async function drawWork({ sync }, box, classId) {
  const list = await sync.rpc('class_assignments', { p_class: classId });
  box.innerHTML = `<div class="row-between"><h2>Work set</h2><a class="btn" href="#/teach/${esc(classId)}/set">Set work</a></div>
    ${list.length ? `<ul class="work-list">${list.map(a => `<li><a href="#/teach/${esc(classId)}/a/${esc(a.id)}"><strong>${esc(a.title)}</strong>
      <span class="muted small">${a.due_at ? `Due ${esc(when(a.due_at))}` : 'No due date'}${Date.parse(a.open_at) > Date.now() ? ` · opens ${esc(when(a.open_at))}` : ''} · ${esc(a.submitted)} handed in</span></a></li>`).join('')}</ul>` : '<p class="muted">Nothing set yet.</p>'}`;
}

const localInput = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export async function viewSetWork(ctx, classId) {
  const { shell, app, sync, registry, loadCourse, loadQuiz } = ctx;
  if (!sync.signedIn()) return void (location.hash = '#/teach');
  const c = (await sync.rpc('teacher_classes')).find(x => x.id === classId);
  if (!c) return shell('<section class="card"><h1>Class not found</h1><a class="btn" href="#/teach">Back</a></section>', { title: 'Set work' });
  const course = await loadCourse(c.course);
  const lessons = course.items.filter(i => i.kind === 'module' && course.ready.includes(i.id));
  const strands = [...new Set(lessons.map(l => l.strand))];
  const chosen = new Map(); // key -> { kind, id, title or src }
  shell(`<a class="small" href="#/teach/${esc(classId)}">← ${esc(c.name)}</a><h1>Set work</h1>
    <form class="set-form">
      <section class="card">
        <label class="field">Title<input name="title" maxlength="80" required></label>
        <label class="field">Note to students (optional)<textarea name="note" rows="2" maxlength="1000"></textarea></label>
        <div class="set-row"><label class="field">Opens<input type="datetime-local" name="open" value="${esc(localInput(new Date()))}"></label>
          <label class="field">Due (optional)<input type="datetime-local" name="due"></label></div>
        <div class="set-row"><label class="field">Attempts allowed<input type="number" name="attempts" min="1" max="10" value="1"></label>
          <label class="field">Time limit in minutes (optional)<input type="number" name="minutes" min="1" max="300"></label></div>
      </section>
      <section class="card"><h2>Choose work</h2>
        <p class="small muted">Set whole lessons, questions from the bank, or both. Questions are frozen as you set them and marked on our server.</p>
        <label class="field">Topic<select class="topic"><option value="">Choose a topic</option>${strands.map(s => `<option value="${esc(s)}">${esc(course.strands[s]?.name || s)}</option>`).join('')}</select></label>
        <div class="picker"></div>
      </section>
      <section class="card"><p class="set-total">Nothing chosen yet.</p><button class="btn wide">Set this work</button><p class="auth-msg" role="alert"></p></section>
    </form>`, { title: 'Set work', wide: true });
  const picker = app.querySelector('.picker');
  const total = () => {
    const qs = [...chosen.values()].filter(x => x.kind === 'question');
    const marks = qs.reduce((n, x) => n + x.marks, 0);
    app.querySelector('.set-total').textContent = chosen.size ? `${plural(qs.length, 'question')} (${plural(marks, 'mark')}), ${plural(chosen.size - qs.length, 'lesson')}.` : 'Nothing chosen yet.';
  };
  const drawTopic = async strand => {
    picker.innerHTML = '';
    for (const l of lessons.filter(x => x.strand === strand)) {
      const key = course.legacyIds ? l.id : `${course.id}:${l.id}`;
      const quiz = await loadQuiz(c.course, l.id);
      const rows = (quiz?.questions || []).map(src => {
        const q = instantiate(src);
        return { src, q, key: `q:${src.id}` };
      });
      const row = el(`<details class="pick"><summary>${esc(l.title)}</summary>
        <label class="check"><input type="checkbox" data-k="l:${esc(key)}"${chosen.has(`l:${key}`) ? ' checked' : ''}> Set this lesson</label>
        ${rows.map(r => `<label class="check"><input type="checkbox" data-k="${esc(r.key)}"${chosen.has(r.key) ? ' checked' : ''}> <span>${esc(r.q.text)} <span class="muted small">(${esc(plural(r.q.marks, 'mark'))})</span></span></label>`).join('')}</details>`);
      row.addEventListener('change', e => {
        const k = e.target.dataset.k;
        const r = rows.find(x => x.key === k);
        if (!e.target.checked) chosen.delete(k);
        else if (r) chosen.set(k, { kind: 'question', id: r.src.id, src: r.src, marks: r.q.marks });
        else chosen.set(k, { kind: 'lesson', id: key, title: l.title });
        total();
      });
      picker.append(row);
    }
  };
  app.querySelector('.topic').addEventListener('change', e => (e.target.value ? drawTopic(e.target.value) : void (picker.innerHTML = '')));
  app.querySelector('.set-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (!f.title.value.trim()) return say(app, 'Give the work a title.');
    if (!chosen.size) return say(app, 'Choose at least one lesson or question.');
    const open = f.open.value ? new Date(f.open.value) : new Date();
    const due = f.due.value ? new Date(f.due.value) : null;
    if (due && due <= open) return say(app, 'The due date must be after the opening date.');
    const items = [...chosen.values()].map(x => (x.kind === 'lesson' ? x : { kind: 'question', id: x.id, q: freeze(x.src) }));
    try {
      const id = await sync.rpc('create_assignment', { p_class: classId, p_title: f.title.value.trim(), p_note: f.note.value, p_open: open.toISOString(),
        p_due: due?.toISOString() || null, p_attempts: Number(f.attempts.value) || 1, p_minutes: Number(f.minutes.value) || null, p_items: items });
      location.hash = `#/teach/${classId}/a/${id}`;
    } catch (err) { say(app, problemFor(err)); }
  });
}

export async function viewAssignment(ctx, classId, id) {
  const { shell, app, sync } = ctx;
  if (!sync.signedIn()) return void (location.hash = '#/teach');
  let a, rows;
  try {
    a = (await sync.rpc('class_assignments', { p_class: classId })).find(x => x.id === id);
    if (a) rows = await sync.rpc('assignment_overview', { p_assignment: id });
  } catch { a = null; }
  if (!a) return shell('<section class="card"><h1>Work not found</h1><a class="btn" href="#/teach">Back</a></section>', { title: 'Work set' });
  const now = rows.filter(r => !r.left_at);
  const seen = rows.map(r => ({ r, s: statusOf(r, a) }));
  const waiting = seen.filter(x => !x.r.left_at && !x.s.finished);
  shell(`<a class="small" href="#/teach/${esc(classId)}">← Back to the class</a><h1>${esc(a.title)}</h1>
    <p class="muted">${a.due_at ? `Due ${esc(when(a.due_at))}` : 'No due date'} · ${esc(plural(a.questions, 'question'))}, ${esc(plural(a.out_of, 'mark'))}${Number(a.lessons) ? `, ${esc(plural(a.lessons, 'lesson'))}` : ''} · ${esc(plural(a.max_attempts, 'attempt'))}${a.minutes ? ` · ${esc(a.minutes)} minutes` : ''}</p>
    <section class="card"><h2>${esc(now.length - waiting.length)} of ${esc(now.length)} finished</h2>
      ${waiting.length ? `<p class="small"><strong>Not finished:</strong> ${waiting.map(x => esc(x.r.real_name)).join(', ')}</p>` : ''}
      <div class="table-scroll" tabindex="0" role="region" aria-label="Student progress"><table class="roster">
      <thead><tr><th scope="col">Name</th><th scope="col">Status</th><th scope="col">Best mark</th><th scope="col">Attempts</th>${Number(a.lessons) ? '<th scope="col">Lessons</th>' : ''}<th scope="col"><span class="sr">Work</span></th></tr></thead>
      <tbody>${seen.map(({ r, s }) => `<tr><td>${esc(r.real_name)}${r.left_at ? ' <span class="muted small">(left)</span>' : ''}</td><td><span class="work-tag s-${esc(s.key)}">${esc(s.label)}</span>${r.auto_submitted ? ' <span class="muted small">Time ran out</span>' : ''}</td>
        <td>${r.best_sub ? `${esc(r.best_marks)}/${esc(r.out_of)}` : '–'}</td><td>${esc(r.attempts)}</td>${Number(a.lessons) ? `<td>${esc(r.lessons_done)}/${esc(a.lessons)}</td>` : ''}
        <td>${r.best_sub ? `<a href="#/teach/${esc(classId)}/a/${esc(id)}/s/${esc(r.best_sub)}">View</a>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${Number(a.lessons) ? '<p class="small muted">Lessons are marked in the student\'s browser, so treat those as a guide. Questions are marked on our server.</p>' : ''}</section>
    <div class="account-actions"><button type="button" class="btn ghost archive">Take this work down</button></div>`, { title: a.title, wide: true });
  twoStep(app.querySelector('.archive'), 'Sure? Students will no longer see it', async () => {
    await sync.rpc('archive_assignment', { p_assignment: id });
    location.hash = `#/teach/${classId}`;
  });
}

export async function viewSubmission(ctx, classId, id, subId) {
  const { shell, app, sync } = ctx;
  if (!sync.signedIn()) return void (location.hash = '#/teach');
  let d;
  try { d = await sync.rpc('submission_detail', { p_sub: subId }); } catch {
    return shell('<section class="card"><h1>Work not found</h1><a class="btn" href="#/teach">Back</a></section>', { title: 'Marking' });
  }
  shell(`<a class="small" href="#/teach/${esc(classId)}/a/${esc(id)}">← Back to the work</a><h1>Attempt ${esc(d.attempt)}</h1>
    <section class="card"><p class="join-big total">${esc(d.marks)}/${esc(d.out_of)}</p><p class="muted small">Handed in ${esc(when(d.submitted_at))}. Your mark replaces ours.</p></section>
    ${d.items.map((q, i) => `<section class="card" data-pos="${esc(q.position)}"><span class="eyebrow">Question ${i + 1}</span>
      <p class="q">${esc(q.text)}</p><p><strong>Answer given:</strong> ${esc(showResponse(q))}</p>
      <p><strong>Answer:</strong> ${esc(q.correct || '')}</p>${q.why ? `<p class="muted small">${esc(q.why)}</p>` : ''}
      <form class="mark-form"><div class="set-row"><label class="field">Mark out of ${esc(q.marks)}<input type="number" name="mark" min="0" max="${esc(q.marks)}" value="${esc(q.teacher_marks ?? q.auto ?? 0)}"></label>
        <label class="field">Comment (optional)<input name="note" maxlength="500" value="${esc(q.teacher_note || '')}"></label></div>
        <button class="btn ghost">Save mark</button><p class="auth-msg" role="status" aria-live="polite"></p></form></section>`).join('')}`, { title: 'Marking' });
  app.querySelectorAll('.mark-form').forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const total = await sync.rpc('set_answer_mark', { p_sub: subId, p_position: Number(f.closest('[data-pos]').dataset.pos), p_marks: Number(f.mark.value), p_note: f.note.value });
      app.querySelector('.total').textContent = `${total}/${d.out_of}`;
      say(f, 'Saved.');
    } catch (err) { say(f, problemFor(err)); }
  }));
}
