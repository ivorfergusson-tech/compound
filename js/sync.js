// Accounts, sync and the leaderboard (Supabase). Without keys in js/config.js everything stays local.
// Progress always lives in this browser first; when signed in it is merged with the account and pushed back.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { mergeStates, emptyState, mergePlans } from './progress.js';
import { nicknameProblem, nicknameLock, lockMessage, passwordProblem } from './nickname.js';
import * as display from './display.js';
import * as exams from './exams.js';
import { esc } from './util.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const NO_PROFILE = { nickname: null, changedAt: null, mustChange: false };
let sb = null, session = null, progress = null, notify = () => {};
let profile = { ...NO_PROFILE }, rank = null, syncing = null, pushTimer = null, authError = null, admin = false;
// recovery: signed in from a password reset link, so the account page asks for a new password.
let recovery = false;
// Teachers' plans for the classes this learner is in, by course.
let plans = new Map();
// Where to go back to after leaving the site to sign in (Google, Microsoft, email links).
const RETURN_KEY = 'compound.returnTo';
// Gap between emails (confirm, reset). Supabase → Auth → Rate Limits → "Minimum interval per user" must not be longer.
const LINK_COOLDOWN_MS = 30000;
let cooldownUntil = 0, cooldownTimer = null;

export const enabled = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const signedIn = () => Boolean(session);
export const available = () => Boolean(sb); // accounts loaded and working
export const settled = () => syncing || Promise.resolve(); // the first sync after sign-in (profile, nickname) is done
export const myRank = () => rank;

export async function init(p, onChange) {
  progress = p;
  notify = onChange || notify;
  if (!enabled()) return;
  try {
    const { createClient } = await import(LIB);
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } });
    // Coming back from Google or an email link: details arrive in ?query or #fragment.
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams(location.hash.startsWith('#/') ? '' : location.hash.slice(1));
    const returned = q.has('code') || q.has('error') || h.has('error') || h.has('access_token');
    authError = q.get('error_description') || h.get('error_description') || null;
    recovery = returned && q.has('reset') && !authError;
    sb.auth.onAuthStateChange((event, s) => {
      session = s;
      if (event === 'PASSWORD_RECOVERY') { recovery = true; notify(); }
      if (event === 'SIGNED_IN') setTimeout(syncNow, 0);
    });
    if (h.has('access_token')) await sb.auth.setSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token') });
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (returned) {
      let to = null;
      try { to = sessionStorage.getItem(RETURN_KEY); sessionStorage.removeItem(RETURN_KEY); } catch { /* blocked */ }
      history.replaceState(null, '', location.pathname + (recovery || authError || !to ? '#/account' : to));
    }
    display.onChange(() => pushSettingsSoon());
    exams.onChange(() => pushExams());
    if (session) syncNow();
    else refreshRank();
  } catch (e) {
    console.warn('Accounts unavailable, carrying on locally', e);
    sb = null;
  }
}

// ---------- pull, merge, push ----------
function syncNow() {
  if (!sb || !session) return Promise.resolve();
  if (!syncing) {
    syncing = (async () => {
      try {
        if (await checkAdmin()) return;
        const remote = await pull();
        progress.replace(mergeStates(progress.state, remote));
        // Display settings: the newer copy wins.
        const local = display.get();
        if (remote.display && (remote.display.updatedAt || '') > (local.updatedAt || '')) display.set(display.clean(remote.display), { fromAccount: true });
        else if (local.updatedAt && local.updatedAt !== remote.display?.updatedAt) await pushSettings();
        // Exam dates: the newer copy wins too.
        const mine = exams.get();
        if (remote.exams && (remote.exams.updatedAt || '') > (mine.updatedAt || '')) exams.set(exams.clean(remote.exams), { fromAccount: true });
        else if (mine.updatedAt && mine.updatedAt !== remote.exams?.updatedAt) await pushExams();
        await push();
        await refreshRank();
        await refreshPlans();
      } catch (e) {
        console.warn('Sync failed; progress is safe in this browser and will sync later', e);
      } finally {
        syncing = null;
        notify();
      }
    })();
  }
  return syncing;
}

// Admin accounts preview the course: nothing is pulled, pushed or put on the leaderboard.
async function checkAdmin() {
  if (admin) return true;
  const { data, error } = await sb.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle();
  if (error) console.warn('Admin check failed; carrying on as a normal account', error); // never block a learner's sync
  if (data) { admin = true; progress.preview(); }
  return admin;
}

export function isAdmin() { return admin; }

async function pull() {
  const uid = session.user.id;
  const sel = (t, cols = '*') => sb.from(t).select(cols).eq('user_id', uid).then(r => { if (r.error) throw r.error; return r.data; });
  const [prof, reads, attempts, srs, notes, guesses, days, settings] = await Promise.all([
    sel('profiles'), sel('module_reads'), sel('attempts'), sel('srs'), sel('notes'), sel('guesses'), sel('active_days'),
    sel('settings').catch(() => []), // the table arrives with the P1 schema; don't fail a sync without it
  ]);
  const pr = prof[0];
  profile = pr ? { nickname: pr.nickname, changedAt: pr.nickname_changed_at || null, mustChange: Boolean(pr.nickname_must_change) } : { ...NO_PROFILE };
  const s = emptyState();
  s.nickname = profile.mustChange ? null : profile.nickname;
  s.display = settings[0] ? { ...settings[0].display, updatedAt: settings[0].updated_at } : null;
  s.exams = settings[0] && settings[0].exams && settings[0].exams.updatedAt ? settings[0].exams : null; // arrives with the P2 schema
  for (const r of reads) s.read[r.item_id] = r.read_at;
  s.attempts = attempts.map(a => ({
    uid: a.id, at: a.at, day: a.day, kind: a.kind, id: a.item_id, auto: a.auto, claimed: a.claimed, outOf: a.out_of,
    passed: a.passed, autoPassed: a.auto_passed, missed: a.missed, wrong: a.wrong, right: a.right,
    ...(a.recall_out_of ? { recall: { auto: a.recall_auto, claimed: a.recall_claimed, outOf: a.recall_out_of } } : {}),
  }));
  for (const r of srs) s.srs[r.qid] = { box: r.box, due: r.due, module: r.module, misses: r.misses, at: r.at };
  for (const n of notes) s.notes[n.item_id] = { text: n.text, at: n.updated_at };
  for (const g of guesses) s.guesses[g.key] = g.value;
  s.days = days.map(d => d.day);
  return s;
}

async function push() {
  if (admin) return;
  const uid = session.user.id;
  const st = progress.state;
  const up = async (table, rows, opts) => {
    if (!rows.length) return;
    const { error } = await sb.from(table).upsert(rows, opts);
    if (error) throw error;
  };
  await Promise.all([
    up('module_reads', Object.entries(st.read).map(([item_id, read_at]) => ({ user_id: uid, item_id, read_at }))),
    up('attempts', st.attempts.filter(a => a.uid).map(a => ({
      id: a.uid, user_id: uid, kind: a.kind, item_id: a.id, auto: a.auto, claimed: a.claimed || 0, out_of: a.outOf,
      passed: a.passed, auto_passed: a.autoPassed, missed: a.missed || [], wrong: a.wrong || [], right: a.right || [], day: a.day, at: a.at,
      recall_auto: a.recall?.auto || 0, recall_claimed: a.recall?.claimed || 0, recall_out_of: a.recall?.outOf || 0,
    })), { onConflict: 'id', ignoreDuplicates: true }),
    up('srs', Object.entries(st.srs).map(([qid, s]) => ({ user_id: uid, qid, box: s.box, due: s.due, module: s.module ?? null, misses: s.misses || 0, at: s.at || new Date().toISOString() }))),
    up('notes', Object.entries(st.notes).map(([item_id, n]) => ({ user_id: uid, item_id, text: n.text, updated_at: n.at }))),
    up('guesses', Object.entries(st.guesses).map(([key, value]) => ({ user_id: uid, key, value: String(value) }))),
    up('active_days', st.days.map(day => ({ user_id: uid, day }))),
  ]);
}

async function pushSettings() {
  if (!sb || !session || admin) return;
  const d = display.get();
  const { updatedAt, ...rest } = d;
  const { error } = await sb.from('settings').upsert({ user_id: session.user.id, display: rest, updated_at: updatedAt || new Date().toISOString() });
  if (error) console.warn('Settings not saved to the account; kept in this browser', error);
}
async function pushExams() {
  if (!sb || !session || admin) return;
  const { error } = await sb.from('settings').upsert({ user_id: session.user.id, exams: exams.get() });
  if (error) console.warn('Exam dates not saved to the account; kept in this browser', error);
}
let settingsTimer = null;
function pushSettingsSoon() { clearTimeout(settingsTimer); settingsTimer = setTimeout(pushSettings, 800); }

export function pushSoon() {
  if (!sb || !session || admin) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push().then(refreshRank).then(notify).catch(e => console.warn('Push failed; will retry', e)), 1500);
}

// ---------- leaderboard ----------
async function refreshRank() {
  if (!sb || !session) { rank = null; return; }
  const { data } = await sb.from('leaderboard').select('pos').eq('is_me', true).maybeSingle();
  rank = data ? data.pos : null;
}

export async function leaderboard() {
  if (!sb) return null;
  const { data, error } = await sb.from('leaderboard').select('nickname, level, xp, pos, is_me').order('xp', { ascending: false }).limit(100);
  if (error) { console.warn(error); return null; }
  return data;
}

// ---------- sign-in forms (account page and the sign-up pop-up) ----------
// Email + password with "Forgot password?" by email, plus Google and (once switched on in Supabase) Microsoft.
// Modes: signup, signin, forgot, newpw (after a reset link, or changing it while signed in).
let formSeq = 0;

// Which sign-in buttons to show: read from Supabase's public auth settings, once.
let providersP = null;
export function providers() {
  if (!enabled()) return Promise.resolve({});
  if (!providersP) {
    providersP = fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } })
      .then(r => (r.ok ? r.json() : {})).then(s => s.external || {}).catch(() => ({ google: true }));
  }
  return providersP;
}

const MS_ICON = '<svg viewBox="0 0 21 21" width="18" height="18" aria-hidden="true"><path fill="#F25022" d="M1 1h9v9H1z"/><path fill="#7FBA00" d="M11 1h9v9h-9z"/><path fill="#00A4EF" d="M1 11h9v9H1z"/><path fill="#FFB900" d="M11 11h9v9h-9z"/></svg>';

export async function authForm(mode = 'signup', { lead = '' } = {}) {
  const p = await providers();
  const n = ++formSeq;
  const email = (k = '') => `<label class="field">Email<input type="email" name="email" autocomplete="email" required${k}></label>`;
  const pw = (label, auto) => `<div class="field"><label for="pw${n}">${label}</label><div class="pw-row"><input id="pw${n}" type="password" name="password" autocomplete="${auto}" minlength="8" maxlength="72" required><button type="button" class="btn ghost show-pw" aria-controls="pw${n}" aria-pressed="false">Show</button></div></div>`;
  const social = mode === 'signup' || mode === 'signin'
    ? `${p.google ? '<button type="button" class="btn wide ghost oauth" data-provider="google">Continue with Google</button>' : ''}
       ${p.azure ? `<button type="button" class="btn wide ghost oauth" data-provider="azure">${MS_ICON}&nbsp; Continue with Microsoft</button>` : ''}
       ${p.google || p.azure ? '<p class="muted center">or</p>' : ''}` : '';
  const forms = {
    signup: `<h2>Create an account</h2>${lead}${social}
      <form class="auth-form" novalidate data-mode="signup">${email()}${pw('Password', 'new-password')}
        <p class="small muted">At least 8 characters. We only use your email to sign you in and reset your password.</p>
        <button class="btn wide submit">Create account</button></form>
      <div class="auth-links"><button type="button" class="linkish" data-go="signin">I already have an account</button></div>`,
    signin: `<h2>Sign in</h2>${lead}${social}
      <form class="auth-form" novalidate data-mode="signin">${email()}${pw('Password', 'current-password')}
        <button class="btn wide submit">Sign in</button></form>
      <div class="auth-links"><button type="button" class="linkish" data-go="forgot">Forgot password?</button><button type="button" class="linkish" data-go="signup">Make an account</button></div>
      <p class="small muted">Used an email sign-in link before? Choose "Forgot password?" to set a password.</p>`,
    forgot: `<h2>Reset your password</h2><p>We'll email you a link to set a new password.</p>
      <form class="auth-form" novalidate data-mode="forgot">${email()}<button class="btn wide submit">Email me a reset link</button></form>
      <div class="auth-links"><button type="button" class="linkish" data-go="signin">Back to sign in</button></div>`,
    newpw: `<h2>${recovery ? 'Set a new password' : 'Change your password'}</h2>
      <form class="auth-form" novalidate data-mode="newpw">${pw('New password', 'new-password')}<p class="small muted">At least 8 characters.</p>
        <button class="btn wide submit">Save password</button></form>`,
  };
  return `<div class="auth" data-mode="${mode}">${forms[mode]}<p class="auth-msg" role="status" aria-live="polite"></p></div>`;
}

// Wires an authForm inside box. onSignedIn() runs after a password sign-in (OAuth leaves the page).
export function wireAuthForm(box, { onSignedIn = () => {}, lead = '' } = {}) {
  if (!sb) return;
  const root = box.querySelector('.auth');
  if (!root) return;
  const msg = text => { const m = root.querySelector('.auth-msg'); if (m) m.textContent = text; };
  const back = location.origin + location.pathname;
  root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', async () => {
    const mail = root.querySelector('input[name=email]')?.value || '';
    root.outerHTML = await authForm(b.dataset.go, { lead });
    const fresh = box.querySelector('.auth');
    const input = fresh.querySelector('input[name=email]');
    if (input) input.value = mail;
    wireAuthForm(box, { onSignedIn, lead });
    (fresh.querySelector('input:placeholder-shown, input') || fresh).focus();
  }));
  root.querySelectorAll('.show-pw').forEach(b => b.addEventListener('click', () => {
    const input = root.querySelector(`#${b.getAttribute('aria-controls')}`);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.textContent = show ? 'Hide' : 'Show';
    b.setAttribute('aria-pressed', String(show));
  }));
  root.querySelectorAll('.oauth').forEach(b => b.addEventListener('click', () => {
    try { sessionStorage.setItem(RETURN_KEY, location.hash); } catch { /* blocked */ }
    sb.auth.signInWithOAuth({ provider: b.dataset.provider, options: { redirectTo: back, ...(b.dataset.provider === 'azure' ? { scopes: 'email' } : {}) } });
  }));
  const form = root.querySelector('.auth-form');
  const btn = form.querySelector('.submit');
  const label = btn.textContent;
  const sendsEmail = ['signup', 'forgot'].includes(form.dataset.mode);
  // Emails are rate limited: one request at a time, then a short wait before another.
  const countdown = () => {
    clearInterval(cooldownTimer);
    const tick = () => {
      const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (!btn.isConnected || left <= 0) { clearInterval(cooldownTimer); btn.disabled = false; btn.textContent = label; return; }
      btn.disabled = true;
      btn.textContent = `Try again in ${left}s`;
    };
    tick();
    cooldownTimer = setInterval(tick, 1000);
  };
  if (sendsEmail && Date.now() < cooldownUntil) countdown();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (btn.disabled) return;
    const email = form.email ? form.email.value.trim() : session?.user.email || '';
    const password = form.password ? form.password.value : '';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg('Enter your email address.'); form.email.focus(); return; }
    if (form.password) {
      const problem = form.dataset.mode === 'signin' ? (password ? null : 'Enter your password.') : passwordProblem(password, email);
      if (problem) { msg(problem); form.password.focus(); return; }
    }
    btn.disabled = true;
    btn.textContent = 'One moment…';
    msg('');
    const done = (text, cool = false) => {
      msg(text);
      if (cool) { cooldownUntil = Date.now() + LINK_COOLDOWN_MS; countdown(); } else { btn.disabled = false; btn.textContent = label; }
    };
    const mode = form.dataset.mode;
    try { sessionStorage.setItem(RETURN_KEY, location.hash); } catch { /* blocked */ }
    if (mode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: back } });
      if (error) return done(authProblem(error), error.status === 429);
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) return done('There is already an account with that email. Choose "I already have an account" to sign in.');
      if (data.session) { done(''); return onSignedIn(); }
      return done(`Nearly there. We've sent a link to ${email}: open it to confirm your email, then you're in. Check your spam folder if it doesn't arrive in a minute.`, true);
    }
    if (mode === 'signin') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return done(authProblem(error));
      done('');
      return onSignedIn();
    }
    if (mode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${back}?reset=1` });
      if (error && error.status !== 429) return done(authProblem(error));
      return done(error ? 'Too many tries. Wait for the timer, then try once.' : `If there's an account for ${email}, a reset link is on its way. Open it on this device.`, true);
    }
    if (mode === 'newpw') {
      const { error } = await sb.auth.updateUser({ password });
      if (error) return done(authProblem(error));
      recovery = false;
      form.reset();
      done('Password saved.');
      return onSignedIn();
    }
  });
}

function authProblem(error) {
  const code = error.code || '';
  if (code === 'invalid_credentials' || /invalid login/i.test(error.message)) return 'That email and password don\'t match. Try again, or choose "Forgot password?".';
  if (code === 'email_not_confirmed') return 'Confirm your email first: open the link we sent when you made the account.';
  if (code === 'weak_password') return 'That password is too weak or has appeared in a data leak. Pick a different one.';
  if (code === 'same_password') return 'That is your current password. Pick a new one.';
  if (code === 'user_already_exists') return 'There is already an account with that email. Sign in instead.';
  if (error.status === 429 || /rate limit/i.test(error.message)) return 'Too many tries. Wait a minute, then try once.';
  return `That didn't work: ${error.message}`;
}

// ---------- account panel ----------
export async function authPanel() {
  if (!enabled() || !sb) {
    return `<h2>Account</h2><p>Accounts aren't switched on yet. Your progress is saved in this browser.</p>`;
  }
  if (syncing) await syncing; // just signed in: wait for the profile, or the nickname shows blank
  if (session && admin) {
    return `<h2>Admin preview</h2>
    <p class="small muted">Signed in as ${esc(session.user.email || 'admin')}. Every module and checkpoint is unlocked. Nothing you do here is saved or synced, and this account never appears on the leaderboard.</p>
    <div class="row-between account-actions"><button type="button" class="btn ghost signout">Sign out</button></div>`;
  }
  if (!session) {
    const err = authError ? `<p class="auth-error">Sign-in didn't work: ${esc(authError)}</p>` : '';
    authError = null;
    return err + await authForm('signup', { lead: SIGNUP_LEAD });
  }
  if (recovery) return await authForm('newpw');
  const lock = nicknameLock(profile.changedAt, profile.mustChange);
  const nickname = profile.nickname;
  return `<h2>${profile.mustChange ? 'Pick a new nickname' : nickname ? esc(nickname) : 'Pick a nickname'}</h2>
    <p class="small muted">Signed in as ${esc(session.user.email || 'you')}. Other users can't see this.</p>
    ${profile.mustChange ? '<p class="nick-lock">Your teacher asked you to pick a different nickname. Choose a new one to carry on.</p>' : ''}
    <form class="nick" id="nickform"><label class="field">${nickname ? 'Change your nickname' : 'Nickname for the leaderboard'}
      <input name="nick" maxlength="20" value="${esc(profile.mustChange ? '' : nickname || '')}" required autocomplete="off"${lock.locked ? ' disabled' : ''}></label>
      ${lock.locked ? `<p class="nick-lock">${esc(lockMessage(lock))}</p>` : `<p class="small muted">3 to 20 letters, numbers, spaces, - or _. Shown publicly with your level and XP; don't use your real name.${nickname ? ' After a change it stays for 7 days.' : ''}</p>`}
    </form>
    <p class="auth-msg" role="status" aria-live="polite"></p>
    <div class="row-between account-actions">
      ${lock.locked ? '<span></span>' : `<button form="nickform" class="btn">${nickname && !profile.mustChange ? 'Save nickname' : 'Join the leaderboard'}</button>`}
      <button type="button" class="btn ghost signout">Sign out</button>
    </div>
    <details class="pw-change"><summary>Change password</summary>${await authForm('newpw')}</details>`;
}

export const SIGNUP_LEAD = '<p>Track your progress from the start. Keep it on any device and join the leaderboard. Anything you\'ve done in this browser moves across.</p>';

export function wireAuthPanel(box, rerender, onSaved = rerender) {
  if (!sb) return;
  if (!session) return wireAuthForm(box, { onSignedIn: rerender, lead: SIGNUP_LEAD });
  if (recovery) return wireAuthForm(box, { onSignedIn: rerender });
  const pwBox = box.querySelector('.pw-change');
  if (pwBox) wireAuthForm(pwBox, {});
  const msg = text => { const m = box.querySelector(':scope > .auth-msg'); if (m) m.textContent = text; };
  box.querySelector('.nick')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = e.target.nick.value.trim();
    const problem = nicknameProblem(name);
    if (problem) return msg(problem);
    const { error } = await sb.from('profiles').upsert({ user_id: session.user.id, nickname: name, updated_at: new Date().toISOString() });
    if (error) {
      if (error.code === 'CN001') {
        const until = (error.message.match(/\d{4}-\d{2}-\d{2}T[\d:]+Z/) || [])[0];
        await loadProfile();
        return msg(until ? lockMessage(nicknameLock(new Date(Date.parse(until) - 7 * 864e5).toISOString())) : 'Nicknames can change once every 7 days.');
      }
      return msg(error.code === '23505' ? 'Someone already has that nickname. Try another.' : error.code === '23514' ? "That nickname isn't allowed. Try another." : `Couldn't save: ${error.message}`);
    }
    await loadProfile();
    progress.setNickname(profile.nickname);
    await refreshRank();
    notify();
    onSaved(profile.nickname);
  });
  box.querySelector('.signout')?.addEventListener('click', async () => {
    await push().catch(() => {});
    await sb.auth.signOut();
    if (admin) return location.reload(); // back to this browser's own saved progress
    session = null; profile = { ...NO_PROFILE }; rank = null; recovery = false;
    plans = new Map();
    progress.replace(emptyState()); // don't leave notes on a shared device
    notify();
    rerender();
  });
}

async function loadProfile() {
  const { data } = await sb.from('profiles').select('nickname, nickname_changed_at, nickname_must_change').eq('user_id', session.user.id).maybeSingle();
  profile = data ? { nickname: data.nickname, changedAt: data.nickname_changed_at, mustChange: data.nickname_must_change } : { ...NO_PROFILE };
  return profile;
}

export const planFor = id => plans.get(id) || null;
export const plansKey = () => JSON.stringify([...plans]);

// Plans only shape what a learner sees next, so failing to load one must never get in the way.
export async function refreshPlans() {
  if (!sb || !session || admin) { plans = new Map(); return; }
  const { data, error } = await sb.rpc('my_class_plans');
  if (error) { console.warn('Class plans not loaded', error); return; }
  plans = mergePlans(data || []);
}

// Class and teacher data all goes through database functions, which check who is asking.
export async function rpc(fn, args = {}) {
  if (!sb) throw new Error('Accounts unavailable');
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}

export async function teacher() {
  if (!sb || !session) return null;
  const { data } = await sb.from('teachers').select('display_name, school, status').eq('user_id', session.user.id).maybeSingle();
  return data;
}

// For pages that need an account with a nickname (the A-level courses).
export const hasNickname = () => Boolean(session && profile.nickname && !profile.mustChange);

// ---------- your data ----------
export async function exportAll(state) {
  const out = { exported: new Date().toISOString(), course: 'Compound', thisBrowser: { ...state, display: display.get(), exams: exams.get() } };
  if (sb && session) {
    const uid = session.user.id;
    out.account = { email: session.user.email, userId: uid };
    for (const t of ['profiles', 'module_reads', 'attempts', 'srs', 'notes', 'guesses', 'active_days', 'settings', 'class_members', 'teachers']) {
      const { data } = await sb.from(t).select('*').eq('user_id', uid);
      out.account[t] = data;
    }
    out.account.work = (await sb.rpc('my_work_export')).data;
  }
  return out;
}

export async function deleteAccount() {
  if (!sb || !session) return;
  const { error } = await sb.rpc('delete_my_account');
  if (error) throw error;
  await sb.auth.signOut().catch(() => {});
  session = null; profile = { ...NO_PROFILE }; rank = null;
}
