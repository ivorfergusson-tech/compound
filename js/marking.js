// Keyword marking for "explain" answers, and number parsing.
// Pure functions (no DOM), so tests/run.js can check them in Node.

const NEGATIONS = new Set(['not', 'no', 'never', 'dont', 'doesnt', 'isnt', 'wont', 'cant', 'without']);

export function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9£%.\s-]/g, ' ')
    .replace(/(\D)\.|\.(\D)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stem(word) {
  for (const end of ['ing', 'ed', 'es', 's']) {
    if (word.length - end.length >= 4 && word.endsWith(end)) return word.slice(0, -end.length);
  }
  return word;
}

export function tokens(text) {
  return normalise(text).split(' ').filter(Boolean);
}

// Damerau-Levenshtein (optimal string alignment) distance.
export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Typo allowance grows with word length; short words must match exactly.
export function wordMatches(answerWord, phraseWord) {
  const a = stem(answerWord), p = stem(phraseWord);
  if (a === p) return true;
  if (/\d/.test(p)) return false;
  const allowed = w => (w.length >= 8 ? 2 : w.length >= 5 ? 1 : 0);
  return (allowed(p) > 0 && editDistance(a, p) <= allowed(p))
    || (allowed(phraseWord) > 0 && editDistance(answerWord, phraseWord) <= allowed(phraseWord));
}

export function containsPhrase(answerTokens, phrase) {
  const p = tokens(phrase);
  if (!p.length) return false;
  for (let i = 0; i + p.length <= answerTokens.length; i++) {
    if (p.every((w, k) => wordMatches(answerTokens[i + k], w))) {
      const before = answerTokens.slice(Math.max(0, i - 2), i);
      if (!before.some(w => NEGATIONS.has(w))) return true;
    }
  }
  return false;
}

// ideas: [{ label, any: [phrases] }] -> { marks, outOf, found: [{label, hit, matched}] }
export function markExplain(answer, ideas) {
  const t = tokens(answer);
  const found = ideas.map(idea => {
    const matched = idea.any.find(phrase => containsPhrase(t, phrase));
    return { label: idea.label, hit: Boolean(matched), matched: matched || null };
  });
  const marks = found.filter(f => f.hit).length;
  return { marks, outOf: ideas.length, found };
}

// "£926.10", "926.1", "1,234", "−3.4%", "about 9 years" -> number, or NaN.
export function parseNumber(input) {
  const s = String(input ?? '').replace(/[−–—]/g, '-').replace(/,/g, '');
  const m = s.match(/-?\s*\d*\.?\d+/);
  return m ? parseFloat(m[0].replace(/\s/g, '')) : NaN;
}
