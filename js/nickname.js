// Nickname rules. Mirrors public.nickname_ok() in supabase/schema.sql: keep the two in step.
const ANYWHERE = ['fuck', 'shit', 'bitch', 'wank', 'twat', 'pussy', 'slut', 'whore', 'nigg', 'faggot',
  'retard', 'spastic', 'tranny', 'hitler', 'asshole', 'bollock', 'porn', 'jizz', 'dildo', 'bellend', 'paedo', 'pedo'];
const WHOLE_WORD = ['sex', 'cum', 'arse', 'rape', 'dick', 'cock', 'tits', 'paki', 'boob', 'prick', 'minge', 'spaz',
  'penis', 'vagina', 'kike', 'chink', 'nazi', 'fag', 'fags', 'bastard', 'wanker', 'tit', 'nonce', 'cunt', 'cunts', 'cunty'];

// Returns null if fine, else a reason to show.
export function nicknameProblem(n) {
  const name = String(n || '').trim();
  if (name.length < 3 || name.length > 20) return 'Use 3 to 20 characters.';
  if (!/^[A-Za-z0-9_\- ]+$/.test(name)) return 'Use letters, numbers, spaces, - or _ only.';
  const low = [...name.toLowerCase()].map(c => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' })[c] || c).join('');
  const flat = low.replace(/[^a-z]/g, '');
  const words = low.split(/[^a-z]+/);
  if (ANYWHERE.some(w => flat.includes(w)) || WHOLE_WORD.some(w => words.includes(w))) return "That nickname isn't allowed. Try another.";
  return null;
}

// Nicknames lock for 7 days after being set or changed (enforced in SQL by public.nickname_lock()).
export const NICKNAME_LOCK_DAYS = 7;
export function nicknameLock(changedAt, mustChange = false, now = Date.now()) {
  if (mustChange || !changedAt) return { locked: false, daysLeft: 0 };
  const freeAt = Date.parse(changedAt) + NICKNAME_LOCK_DAYS * 864e5;
  if (!(freeAt > now)) return { locked: false, daysLeft: 0 };
  return { locked: true, daysLeft: Math.ceil((freeAt - now) / 864e5), freeAt: new Date(freeAt).toISOString() };
}

export const lockMessage = l => `You can change your nickname in ${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'}.`;

// Passwords: at least 8 characters (Supabase checks too). Returns null if fine, else a reason to show.
export function passwordProblem(pw, email = '') {
  const p = String(pw || '');
  if (p.length < 8) return 'Use at least 8 characters.';
  if (p.length > 72) return 'Use 72 characters or fewer.';
  if (/^(.)\1+$/.test(p) || ['password', 'password1', '12345678', '123456789', 'qwertyuiop', 'iloveyou'].includes(p.toLowerCase())) return 'That password is too easy to guess.';
  if (email && p.toLowerCase() === String(email).toLowerCase()) return "Don't use your email as your password.";
  return null;
}
