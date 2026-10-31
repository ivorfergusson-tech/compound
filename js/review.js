// #/review: question reports for reviewers; teacher approvals and the totals for admins. The database decides who gets
// what, so this page only shows what it's given.
import { esc } from './util.js';
import { date, problemFor, say } from './classes.js';

const REASON = { wrong: 'Wrong answer', typo: 'Typo', unclear: 'Unclear' };
export const pounds = pence => `£${(Number(pence) / 100).toFixed(2)}`;
const fact = (n, label) => `<div><strong>${esc(n)}</strong><span class="small muted">${esc(label)}</span></div>`;

export async function viewReview(ctx) {
  const { shell, app, sync } = ctx;
  const role = sync.signedIn() ? await sync.rpc('review_role').catch(() => null) : null;
  if (!role) return shell('<section class="card"><h1>Not found</h1><a class="btn" href="#/">Home</a></section>', { title: 'Not found' });
  const admin = role === 'admin';
  const [reports, totals, teachers] = await Promise.all([sync.rpc('review_reports'), admin ? sync.rpc('admin_totals') : null, admin ? sync.rpc('pending_teachers') : []]);
  shell(`<h1>Review</h1>
    ${totals ? `<section class="card profile-facts">${fact(totals.teachers, 'teachers')}${fact(totals.classes, 'classes')}${fact(totals.students, 'students in classes')}${fact(totals.work, 'pieces of work')}
      ${fact(totals.handed_in, 'handed in')}${fact(totals.photos, 'photos held')}${fact(totals.ai_marks, 'AI uses this month')}${fact(`${pounds(totals.ai_pence)} of ${pounds(totals.ai_budget)}`, 'AI spend this month, at most')}</section>` : ''}
    ${admin ? `<section class="card"><h2>Teachers to check (${esc(teachers.length)})</h2>${teachers.length ? `<ul class="work-list">${teachers.map(t => `<li data-user="${esc(t.user_id)}"><span><strong>${esc(t.display_name)}</strong>
      <span class="muted small">${esc(t.email)}${t.school ? ` · ${esc(t.school)}` : ''} · ${esc(date(t.created_at))}</span></span><button type="button" class="btn ghost verify">Verify</button></li>`).join('')}</ul>` : '<p class="muted">Nobody is waiting.</p>'}</section>` : ''}
    <section class="card"><h2>Question reports (${esc(reports.length)})</h2>${reports.length ? `<ul class="work-list">${reports.map(r => `<li data-id="${esc(r.id)}"><span><strong>${esc(r.question_id)}</strong>
      <span class="small">${esc(REASON[r.reason])}${Number(r.same) > 1 ? ` · ${esc(r.same)} reports` : ''} · ${esc(date(r.created_at))}</span>${r.note ? `<span class="small muted">${esc(r.note)}</span>` : ''}</span>
      <span class="row-actions"><button type="button" class="btn ghost fix">Fixed</button><button type="button" class="btn ghost reject">No change</button></span></li>`).join('')}</ul>` : '<p class="muted">Nothing to look at.</p>'}<p class="auth-msg" role="status" aria-live="polite"></p></section>`, { title: 'Review', wide: true });
  const act = (sel, fn) => app.querySelectorAll(sel).forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await fn(b.closest('li')); viewReview(ctx); } catch (err) { b.disabled = false; say(app, problemFor(err)); }
  }));
  act('.verify', li => sync.rpc('verify_teacher', { p_user: li.dataset.user }));
  act('.fix', li => sync.rpc('resolve_report', { p_id: li.dataset.id, p_status: 'fixed' }));
  act('.reject', li => sync.rpc('resolve_report', { p_id: li.dataset.id, p_status: 'rejected' }));
}
