// Accounts, sync and the leaderboard (Supabase). Without keys in js/config.js everything stays local.
// Progress always lives in this browser first; when signed in it is merged with the account and pushed back.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { mergeStates, emptyState } from './progress.js';
import { nicknameProblem } from './nickname.js';
import { esc } from './util.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
let sb = null, session = null, progress = null, notify = () => {};
let nickname = null, rank = null, syncing = null, pushTimer = null, authError = null, admin = false;

export const enabled = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const signedIn = () => Boolean(session);
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
    if (h.has('access_token')) await sb.auth.setSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token') });
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (returned) history.replaceState(null, '', location.pathname + '#/account');
    sb.auth.onAuthStateChange((event, s) => {
      session = s;
      if (event === 'SIGNED_IN') setTimeout(syncNow, 0);
    });
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
        await push();
        await refreshRank();
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
  const [profile, reads, attempts, srs, notes, guesses, days] = await Promise.all([
    sel('profiles'), sel('module_reads'), sel('attempts'), sel('srs'), sel('notes'), sel('guesses'), sel('active_days'),
  ]);
  nickname = profile[0]?.nickname || null;
  const s = emptyState();
  s.nickname = nickname;
  for (const r of reads) s.read[r.item_id] = r.read_at;
  s.attempts = attempts.map(a => ({
    uid: a.id, at: a.at, day: a.day, kind: a.kind, id: a.item_id, auto: a.auto, claimed: a.claimed, outOf: a.out_of,
    passed: a.passed, autoPassed: a.auto_passed, missed: a.missed, wrong: a.wrong, right: a.right,
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
    })), { onConflict: 'id', ignoreDuplicates: true }),
    up('srs', Object.entries(st.srs).map(([qid, s]) => ({ user_id: uid, qid, box: s.box, due: s.due, module: s.module ?? null, misses: s.misses || 0, at: s.at || new Date().toISOString() }))),
    up('notes', Object.entries(st.notes).map(([item_id, n]) => ({ user_id: uid, item_id, text: n.text, updated_at: n.at }))),
    up('guesses', Object.entries(st.guesses).map(([key, value]) => ({ user_id: uid, key, value: String(value) }))),
    up('active_days', st.days.map(day => ({ user_id: uid, day }))),
  ]);
}

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
    return err + `<h2>Make a free account</h2>
      <p>Keep your progress on any device and join the leaderboard. Everything you've done in this browser moves across.</p>
      <button type="button" class="btn wide google">Continue with Google</button>
      <p class="muted center">or</p>
      <form class="magic"><label class="field">Email<input type="email" name="email" autocomplete="email" required></label>
      <button class="btn ghost wide">Email me a sign-in link</button></form>
      <p class="small muted">No password needed. Open the link on this device. We only use your email to sign you in.</p>
      <p class="auth-msg" aria-live="polite"></p>`;
  }
  return `<h2>${nickname ? esc(nickname) : 'Pick a nickname'}</h2>
    <p class="small muted">Signed in as ${esc(session.user.email || 'you')}. Other users can't see this.</p>
    <form class="nick" id="nickform"><label class="field">${nickname ? 'Change your nickname' : 'Nickname for the leaderboard'}
      <input name="nick" maxlength="20" value="${esc(nickname || '')}" required autocomplete="off"></label>
      <p class="small muted">3 to 20 letters, numbers, spaces, - or _. Shown publicly with your level and XP; don't use your real name.</p>
    </form>
    <p class="auth-msg" aria-live="polite"></p>
    <div class="row-between account-actions">
      <button form="nickform" class="btn">${nickname ? 'Save nickname' : 'Join the leaderboard'}</button>
      <button type="button" class="btn ghost signout">Sign out</button>
    </div>`;
}

export function wireAuthPanel(box, rerender, onSaved = rerender) {
  if (!sb) return;
  const msg = text => { const m = box.querySelector('.auth-msg'); if (m) m.textContent = text; };
  const back = location.origin + location.pathname;
  box.querySelector('.google')?.addEventListener('click', () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back } }));
  box.querySelector('.magic')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: back } });
    msg(error ? `Couldn't send the link: ${error.message}` : `Check ${email} for your sign-in link.`);
  });
  box.querySelector('.nick')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = e.target.nick.value.trim();
    const problem = nicknameProblem(name);
    if (problem) return msg(problem);
    const { error } = await sb.from('profiles').upsert({ user_id: session.user.id, nickname: name, updated_at: new Date().toISOString() });
    if (error) return msg(error.code === '23505' ? 'Someone already has that nickname. Try another.' : error.code === '23514' ? "That nickname isn't allowed. Try another." : `Couldn't save: ${error.message}`);
    nickname = name;
    progress.setNickname(name);
    await refreshRank();
    notify();
    onSaved(name);
  });
  box.querySelector('.signout')?.addEventListener('click', async () => {
    await push().catch(() => {});
    await sb.auth.signOut();
    if (admin) return location.reload(); // back to this browser's own saved progress
    session = null; nickname = null; rank = null;
    progress.replace(emptyState()); // don't leave notes on a shared device
    notify();
    rerender();
  });
}

// ---------- your data ----------
export async function exportAll(state) {
  const out = { exported: new Date().toISOString(), course: 'Compound', thisBrowser: state };
  if (sb && session) {
    const uid = session.user.id;
    out.account = { email: session.user.email, userId: uid };
    for (const t of ['profiles', 'module_reads', 'attempts', 'srs', 'notes', 'guesses', 'active_days']) {
      const { data } = await sb.from(t).select('*').eq('user_id', uid);
      out.account[t] = data;
    }
  }
  return out;
}

export async function deleteAccount() {
  if (!sb || !session) return;
  const { error } = await sb.rpc('delete_my_account');
  if (error) throw error;
  await sb.auth.signOut().catch(() => {});
  session = null; nickname = null; rank = null;
}
