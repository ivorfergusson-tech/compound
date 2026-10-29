// Display settings: theme, font, letter and line spacing, text size, high contrast.
// Saved in this browser (compound.display) and, when signed in, to the account (sync.js, settings table).
// index.html applies them before the page draws, so there's no flash; keep its inline script in step.
const KEY = 'compound.display';
const THEME_KEY = 'compound.theme'; // read by the reading pages (m/) too

export const OPTIONS = {
  theme: { label: 'Colours', choices: { dark: 'Dark', light: 'Light' } },
  font: { label: 'Font', choices: { standard: 'Standard', lexend: 'Lexend (easy-read)', atkinson: 'Atkinson Hyperlegible' } },
  size: { label: 'Text size', choices: { s: 'Small', m: 'Medium', l: 'Large', xl: 'Extra large' } },
  letters: { label: 'Letter spacing', choices: { normal: 'Normal', wide: 'Wide', wider: 'Wider' } },
  lines: { label: 'Line spacing', choices: { normal: 'Normal', relaxed: 'Relaxed', loose: 'Loose' } },
  contrast: { label: 'Contrast', choices: { normal: 'Normal', high: 'High' } },
};
export const DEFAULTS = { theme: 'dark', font: 'standard', size: 'm', letters: 'normal', lines: 'normal', contrast: 'normal' };
const FONT_CSS = {
  lexend: 'https://fonts.googleapis.com/css2?family=Lexend:wght@400;600;700&display=swap',
  atkinson: 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap',
};

// Only known keys and choices survive (settings also come back from the account).
export function clean(d) {
  const out = { ...DEFAULTS };
  for (const [k, o] of Object.entries(OPTIONS)) if (d && d[k] in o.choices) out[k] = d[k];
  out.updatedAt = (d && typeof d.updatedAt === 'string' && d.updatedAt) || '';
  return out;
}

export function load(storage = globalThis.localStorage) {
  let d = null;
  try { d = JSON.parse(storage.getItem(KEY) || 'null'); } catch { /* blocked or bad data */ }
  if (!d) { try { d = { theme: storage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' }; } catch { d = {}; } }
  return clean(d);
}

export function save(d, storage = globalThis.localStorage) {
  const c = clean(d);
  try { storage.setItem(KEY, JSON.stringify(c)); storage.setItem(THEME_KEY, c.theme); } catch { /* blocked */ }
  return c;
}

// The newer of this browser's settings and the account's.
export function newer(a, b) { return (b && b.updatedAt || '') > (a && a.updatedAt || '') ? clean(b) : clean(a); }

export function apply(d, root = globalThis.document && document.documentElement) {
  if (!root) return;
  const c = clean(d);
  for (const k of Object.keys(OPTIONS)) root.dataset[k] = c[k];
  const href = FONT_CSS[c.font];
  if (href && !document.querySelector(`link[data-font="${c.font}"]`)) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.dataset.font = c.font;
    document.head.append(l);
  }
}

let current = null;
const listeners = new Set();
export function get() { return current || (current = load()); }
export function onChange(fn) { listeners.add(fn); }
// set({ size: 'l' }) from the settings form; set(remote, { fromAccount: true }) when the account's copy is newer.
export function set(patch, { fromAccount = false } = {}) {
  current = save(fromAccount ? patch : { ...get(), ...patch, updatedAt: new Date().toISOString() });
  apply(current);
  if (!fromAccount) for (const fn of listeners) fn(current);
  return current;
}
