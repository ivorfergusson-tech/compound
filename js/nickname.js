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
