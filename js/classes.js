// Classes: students join with a code, teachers run classes and see a roster. All data goes through the
// database functions in supabase/schema.sql, which check who is asking; nothing here is trusted by the server.
import { esc } from './util.js';
import { workList, drawWork } from './assign.js';

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm';
export const CONSENT = 'Your teacher will see your real name, your scores, time spent and work you hand in.';

const PROBLEMS = {
  CN101: 'This class is closed to new students. Ask your teacher.',
  CN102: 'This class is full. Ask your teacher.',
  CN103: "This is your own class. Teachers don't join their own classes.",
  CN104: 'Enter your real name, using letters only.',
  CN105: "That code doesn't match a class. Check it with your teacher.",
  CN106: 'You need to agree before you can join.',
  CN107: "You've reached the limit of 30 classes.",
  CN108: 'Pick a nickname on your account page first.',
  CN201: 'This attempt has closed.',
  CN202: "Those items couldn't be set. Check them and try again.",
  CN203: 'This class has reached its limit of 500 pieces of work.',
  CN204: "This work hasn't been handed in yet.",
  CN205: 'That mark is out of range.',
  CN206: "You've used all your attempts.",
  CN207: 'One of your answers is too long.',
  CN208: "You've reached the limit of 2000 questions.",
};
export const problemFor = e => PROBLEMS[e?.code] || (e?.code === '42501' ? "You don't have access to that." : "That didn't work. Try again.");
export const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
export const validCode = s => /^[A-HJ-NP-Z2-9]{6}$/.test(s);

export const date = iso => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const say = (root, text) => { const m = root.querySelector('.auth-msg'); if (m) m.textContent = text; };

// Destructive buttons ask once, on the button itself.
export function twoStep(btn, label, action) {
  const first = btn.textContent;
  btn.addEventListener('click', async () => {
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = label;
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = first; } }, 5000);
      return;
    }
    btn.disabled = true;
    await action();
  });
}

export function gate({ shell, sync }, title) {
  if (!sync.enabled() || !sync.available()) {
    shell(`<section class="card"><h1>${esc(title)}</h1><p>Accounts aren't available right now. Try again soon.</p></section>`, { title });
    return false;
  }
  if (!sync.signedIn() || !sync.hasNickname()) {
    const signedIn = sync.signedIn();
    shell(`<section class="card"><h1>${esc(title)}</h1><p>${signedIn ? 'Pick a nickname first.' : 'You need a free account for this.'}</p>
      <a class="btn" href="#/account">${signedIn ? 'Pick a nickname' : 'Make an account or sign in'}</a></section>`, { title });
    return false;
  }
  return true;
}

const courseName = (registry, id) => registry.courses.find(c => c.id === id)?.title || id;

// ---------- students ----------
export async function viewClasses(ctx) {
  const { shell, app, sync, registry } = ctx;
  if (!gate(ctx, 'Your classes')) return;
  const [mine, work] = await Promise.all([sync.rpc('my_classes'), sync.rpc('my_assignments')]);
  shell(`<h1>Your classes</h1>
    ${workList(work)}
    <section class="card"><h2>Join a class</h2>
      <form class="join-code"><label class="field">Class code<input name="code" maxlength="6" autocomplete="off" autocapitalize="characters" required></label>
      <button class="btn wide">Continue</button></form><p class="auth-msg" role="status" aria-live="polite"></p></section>
    ${mine.length ? mine.map(c => `<section class="card" data-id="${esc(c.id)}"><h2>${esc(c.name)}</h2>
      <p class="muted small">${esc(c.teacher)} · ${esc(courseName(registry, c.course))}${c.year_group ? ` · ${esc(c.year_group)}` : ''}</p>
      <p class="small">Your teacher sees you as ${esc(c.real_name)}. Joined ${esc(date(c.joined_at))}.</p>
      <div class="row-between account-actions">
        ${c.leaderboard_on ? `<a class="btn ghost" href="#/classes/${esc(c.id)}">Class leaderboard</a>` : '<span></span>'}
        <button type="button" class="btn ghost leave">Leave class</button></div></section>`).join('')
    : '<p class="muted">You\'re not in a class yet.</p>'}
    <p class="small muted">Are you a teacher? <a href="#/teach">Set up your classes</a>.</p>`, { title: 'Your classes' });
  app.querySelector('.join-code').addEventListener('submit', e => {
    e.preventDefault();
    const code = cleanCode(e.target.code.value);
    if (!validCode(code)) return say(app, 'Class codes have 6 letters and numbers.');
    location.hash = `#/join/${code}`;
  });
  app.querySelectorAll('.leave').forEach(b => twoStep(b, 'Sure? Leave', async () => {
    await sync.rpc('leave_class', { p_class: b.closest('[data-id]').dataset.id });
    await sync.refreshPlans();
    viewClasses(ctx);
  }));
}

// The consent screen, reached from a code, a link or a QR code.
export async function viewJoin(ctx, raw) {
  const { shell, app, sync, registry } = ctx;
  if (!gate(ctx, 'Join a class')) return;
  const code = cleanCode(raw);
  const found = validCode(code) ? (await sync.rpc('class_preview', { p_code: code }))[0] : null;
  if (!found) {
    return shell(`<section class="card"><h1>Class not found</h1><p>${esc(PROBLEMS.CN105)}</p><a class="btn" href="#/classes">Back</a></section>`, { title: 'Join a class' });
  }
  if (found.already) return void (location.hash = '#/classes');
  if (!found.joining_open) {
    return shell(`<section class="card"><h1>${esc(found.name)}</h1><p>${esc(PROBLEMS.CN101)}</p><a class="btn" href="#/classes">Back</a></section>`, { title: 'Join a class' });
  }
  shell(`<section class="card join-card"><span class="eyebrow">Join a class</span><h1>${esc(found.name)}</h1>
    <p class="muted">${esc(found.teacher)}${found.school ? `, ${esc(found.school)}` : ''} · ${esc(courseName(registry, found.course))}</p>
    <p class="consent"><strong>${esc(CONSENT)}</strong></p>
    <form class="join-form"><label class="field">Your real name<input name="real" maxlength="60" autocomplete="name" required></label>
      <p class="small muted">Only your teacher sees this. Other students see your nickname.</p>
      <label class="check"><input type="checkbox" name="ok"> I understand and agree</label>
      <button class="btn wide">Join class</button></form>
    <p class="small muted">You can leave at any time. Your teacher keeps your past marks, but sees nothing new.</p>
    <p class="auth-msg" role="status" aria-live="polite"></p></section>`, { title: 'Join a class' });
  app.querySelector('.join-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (f.real.value.trim().length < 2) return say(app, PROBLEMS.CN104);
    if (!f.ok.checked) return say(app, PROBLEMS.CN106);
    try {
      await sync.rpc('join_class', { p_code: code, p_real_name: f.real.value.trim(), p_consent: true });
      await sync.refreshPlans();
      location.hash = '#/classes';
    } catch (err) { say(app, problemFor(err)); }
  });
}

export async function viewClassBoard(ctx, id) {
  const { shell, sync } = ctx;
  if (!gate(ctx, 'Class leaderboard')) return;
  let rows;
  try { rows = await sync.rpc('class_leaderboard', { p_class: id }); } catch {
    return shell('<section class="card"><h1>Class leaderboard</h1><p>This leaderboard isn\'t available.</p><a class="btn" href="#/classes">Back</a></section>', { title: 'Class leaderboard' });
  }
  shell(`<h1>Class leaderboard</h1><p class="muted">XP from this class's course since you joined.</p>
    <ol class="lb-list">${rows.map(r => `<li class="${r.is_me ? 'me' : ''}"><span>${esc(r.pos)}</span><span>${esc(r.nickname)}</span><strong>${esc(r.xp)} XP</strong></li>`).join('')}</ol>
    <a class="btn ghost" href="#/classes">Back</a>`, { title: 'Class leaderboard' });
}

// ---------- teachers ----------
export async function viewTeach(ctx) {
  const { shell, app, sync, registry } = ctx;
  if (!sync.signedIn()) {
    return shell(`<section class="card"><h1>For teachers</h1><p>Sign in or make a free account to set up your classes.</p><a class="btn" href="#/account">Make an account or sign in</a></section>`, { title: 'For teachers' });
  }
  const me = await sync.teacher();
  if (!me) {
    shell(`<section class="card"><h1>Set up your teacher account</h1>
      <p>Tools work straight away. School and college email addresses are verified automatically. We check any others by hand, and until then each class is limited to 35 students.</p>
      <form class="teacher-form"><label class="field">Name your students will see<input name="name" maxlength="60" placeholder="Ms Tan" required></label>
        <label class="field">School or college (optional)<input name="school" maxlength="100"></label>
        <label class="check"><input type="checkbox" name="ok"> I'm a teacher</label>
        <button class="btn wide">Set up</button></form>
      <p class="auth-msg" role="status" aria-live="polite"></p></section>`, { title: 'For teachers' });
    app.querySelector('.teacher-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      if (f.name.value.trim().length < 2) return say(app, 'Enter the name your students will see.');
      if (!f.ok.checked) return say(app, 'Tick the box to confirm that you\'re a teacher.');
      try { await sync.rpc('become_teacher', { p_name: f.name.value.trim(), p_school: f.school.value.trim() || null }); viewTeach(ctx); } catch (err) { say(app, problemFor(err)); }
    });
    return;
  }
  const list = await sync.rpc('teacher_classes');
  const live = registry.courses.filter(c => c.live);
  shell(`<h1>Your classes</h1>
    ${me.status === 'verified' ? '' : '<p class="card small">Your account is waiting to be verified. Until then, each class is limited to 35 students.</p>'}
    ${list.map(c => `<a class="card class-link" href="#/teach/${esc(c.id)}"><strong>${esc(c.name)}</strong>
      <span class="muted small">${esc(courseName(registry, c.course))}${c.year_group ? ` · ${esc(c.year_group)}` : ''} · ${esc(c.students)} ${Number(c.students) === 1 ? 'student' : 'students'}</span></a>`).join('')}
    <section class="card"><h2>New class</h2><form class="new-class">
      <label class="field">Class name<input name="name" maxlength="60" placeholder="13A Economics" required></label>
      <label class="field">Course<select name="course">${live.map(c => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</select></label>
      <label class="field">Year group (optional)<input name="year" maxlength="20" placeholder="Year 13"></label>
      <button class="btn wide">Create class</button></form><p class="auth-msg" role="status" aria-live="polite"></p></section>`, { title: 'Your classes' });
  app.querySelector('.new-class').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (!f.name.value.trim()) return say(app, 'Give the class a name.');
    try {
      const id = await sync.rpc('create_class', { p_name: f.name.value.trim(), p_course: f.course.value, p_year: f.year.value.trim() || null });
      location.hash = `#/teach/${id}`;
    } catch (err) { say(app, problemFor(err)); }
  });
}

// Topics the plan can move: those with lessons. Exam technique guides are always open, so they aren't listed.
export function planTopics(course) {
  const has = new Set(course.items.filter(i => i.kind === 'module').map(i => i.strand));
  return Object.entries(course.strands).filter(([k]) => has.has(k)).map(([k, v]) => ({ id: k, name: v.name }));
}

// The teacher's lesson order. A class with no plan follows the course's own order.
async function drawPlan(ctx, box, id, courseId) {
  const { sync, loadCourse } = ctx;
  const course = await loadCourse(courseId);
  if (!course) return;
  const topics = planTopics(course);
  const saved = (await sync.rpc('class_plan', { p_class: id }))[0];
  const named = saved?.unit_order;
  let order = named ? [...named.filter(k => topics.some(t => t.id === k)), ...topics.map(t => t.id).filter(k => !named.includes(k))] : topics.map(t => t.id);
  let held = new Set(saved?.held_units || []);
  const name = k => topics.find(t => t.id === k).name;
  const draw = () => {
    box.innerHTML = `<h2>Lesson order</h2>
      <p class="small muted">${named ? 'Your students follow this order. Lessons unlock one by one inside a topic, and a topic opens once you release it. Work already passed stays open.' : 'Your students are following the course order, one lesson at a time. Change the order or hold topics back, then save.'}</p>
      <ol class="plan-list">${order.map((k, i) => `<li data-k="${esc(k)}"><span>${esc(name(k))}</span>
        <span class="plan-tools"><button type="button" class="btn ghost up" aria-label="Move ${esc(name(k))} up"${i ? '' : ' disabled'}>↑</button>
        <button type="button" class="btn ghost down" aria-label="Move ${esc(name(k))} down"${i < order.length - 1 ? '' : ' disabled'}>↓</button>
        <label class="check"><input type="checkbox" class="rel"${held.has(k) ? '' : ' checked'}> Released</label></span></li>`).join('')}</ol>
      <div class="row-between account-actions"><button type="button" class="btn save-plan">Save order</button>
      ${named ? '<button type="button" class="btn ghost clear-plan">Use the course order</button>' : '<span></span>'}</div>
      <p class="auth-msg" role="status" aria-live="polite"></p>`;
    const move = (k, by) => { const i = order.indexOf(k); order.splice(i, 1); order.splice(i + by, 0, k); draw(); };
    box.querySelectorAll('.up').forEach(b => b.addEventListener('click', () => move(b.closest('li').dataset.k, -1)));
    box.querySelectorAll('.down').forEach(b => b.addEventListener('click', () => move(b.closest('li').dataset.k, 1)));
    box.querySelectorAll('.rel').forEach(b => b.addEventListener('change', () => { const k = b.closest('li').dataset.k; if (b.checked) held.delete(k); else held.add(k); }));
    box.querySelector('.save-plan').addEventListener('click', async () => {
      try {
        await sync.rpc('set_class_plan', { p_class: id, p_order: order, p_held: [...held] });
        drawPlan(ctx, box, id, courseId);
      } catch (err) { say(box, problemFor(err)); }
    });
    box.querySelector('.clear-plan')?.addEventListener('click', async () => {
      await sync.rpc('set_class_plan', { p_class: id, p_order: null, p_held: null });
      drawPlan(ctx, box, id, courseId);
    });
  };
  draw();
}

async function drawQr(box, url) {
  try {
    const { default: qrcode } = await import(QR_LIB);
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
    box.querySelector('svg')?.setAttribute('role', 'img');
    box.querySelector('svg')?.setAttribute('aria-label', 'QR code for the join link');
  } catch { box.textContent = ''; } // the code and the link still work
}

export async function viewTeachClass(ctx, id) {
  const { shell, app, sync, registry } = ctx;
  if (!sync.signedIn()) return viewTeach(ctx);
  const c = (await sync.rpc('teacher_classes')).find(x => x.id === id);
  if (!c) return shell('<section class="card"><h1>Class not found</h1><a class="btn" href="#/teach">Back</a></section>', { title: 'Class' });
  const [me, roster] = await Promise.all([sync.teacher(), sync.rpc('class_roster', { p_class: id })]);
  const link = `${location.origin}${location.pathname}#/join/${c.join_code}`;
  const active = roster.filter(r => !r.left_at), past = roster.filter(r => r.left_at);
  const row = r => `<tr data-user="${esc(r.user_id)}"><td>${esc(r.real_name)}</td><td>${esc(r.nickname || '')}</td><td>${esc(r.passed)}</td><td>${esc(date(r.last_active)) || '–'}</td>
    <td class="actions">${r.left_at ? `Left ${esc(date(r.left_at))}` : `${me?.status === 'verified' ? '<button type="button" class="linkish reset">Reset nickname</button> ' : ''}<button type="button" class="linkish remove">Remove</button>`}</td></tr>`;
  shell(`<a class="small" href="#/teach">← Your classes</a><h1>${esc(c.name)}</h1>
    <p class="muted">${esc(courseName(registry, c.course))}${c.year_group ? ` · ${esc(c.year_group)}` : ''}</p>
    <section class="card"><h2>Join this class</h2>
      <p class="join-big" aria-label="Join code">${esc(c.join_code)}</p>
      <div class="qr"></div>
      <p class="small"><a href="${esc(link)}">${esc(link)}</a></p>
      <div class="row-between account-actions">
        <button type="button" class="btn ghost renew">New code</button>
        <button type="button" class="btn ghost toggle-join">${c.joining_open ? 'Close joining' : 'Open joining'}</button></div>
      ${c.joining_open ? '' : '<p class="small muted">Joining is closed.</p>'}</section>
    <section class="card"><h2>Students (${active.length})</h2>
      ${roster.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Students in this class"><table class="roster">
        <thead><tr><th scope="col">Name</th><th scope="col">Nickname</th><th scope="col">Lessons passed (auto-marked)</th><th scope="col">Last active</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
        <tbody>${active.map(row).join('')}${past.map(row).join('')}</tbody></table></div>
        <p class="small muted">Work counts from the day a student joined. Quizzes are marked in the student's browser, so treat these as a guide, not an assessment. Real names are only shown to you.</p>` : '<p class="muted">Nobody has joined yet. Share the code, the link or the QR code.</p>'}
      <p class="auth-msg" role="status" aria-live="polite"></p></section>
    <section class="card" id="work"></section>
    <section class="card" id="plan"></section>
    <section class="card"><h2>Settings</h2>
      <label class="check"><input type="checkbox" class="lb-on"${c.leaderboard_on ? ' checked' : ''}> Class leaderboard (students see nicknames and XP)</label>
      <a class="btn ghost" href="#/classes/${esc(id)}">See the class leaderboard</a>
      <div class="account-actions"><button type="button" class="btn ghost delete-class">Delete class</button></div></section>`, { title: c.name, wide: true });
  drawQr(app.querySelector('.qr'), link);
  drawWork(ctx, app.querySelector('#work'), id);
  drawPlan(ctx, app.querySelector('#plan'), id, c.course);
  const update = (open, lb) => sync.rpc('update_class', { p_class: id, p_name: c.name, p_joining_open: open, p_leaderboard_on: lb });
  app.querySelector('.toggle-join').addEventListener('click', async () => { await update(!c.joining_open, c.leaderboard_on); viewTeachClass(ctx, id); });
  app.querySelector('.lb-on').addEventListener('change', async e => { await update(c.joining_open, e.target.checked); viewTeachClass(ctx, id); });
  twoStep(app.querySelector('.renew'), 'Sure? The old code stops working', async () => { await sync.rpc('renew_join_code', { p_class: id }); viewTeachClass(ctx, id); });
  twoStep(app.querySelector('.delete-class'), 'Sure? This can\'t be undone', async () => { await sync.rpc('delete_class', { p_class: id }); location.hash = '#/teach'; });
  app.querySelectorAll('.remove').forEach(b => twoStep(b, 'Sure? Remove', async () => {
    await sync.rpc('remove_from_class', { p_class: id, p_user: b.closest('tr').dataset.user });
    viewTeachClass(ctx, id);
  }));
  app.querySelectorAll('.reset').forEach(b => twoStep(b, 'Sure? Reset', async () => {
    await sync.rpc('reset_nickname', { p_class: id, p_user: b.closest('tr').dataset.user });
    viewTeachClass(ctx, id);
  }));
}
