// Read aloud with the browser's own speech (Web Speech API): free, nothing leaves the device.
// Reads one block at a time so the current section can be highlighted, paused and stopped.
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function voice() {
  const vs = speechSynthesis.getVoices();
  return vs.find(v => v.lang === 'en-GB' && /natural|neural|google/i.test(v.name)) || vs.find(v => v.lang === 'en-GB') || vs.find(v => /^en/.test(v.lang)) || null;
}

let queue = [], onEnd = null, current = null;

// parts: [{ text, el? }]. Returns controls; onState(state) gets 'playing' | 'paused' | 'stopped'.
export function speak(parts, { onState = () => {} } = {}) {
  stop();
  queue = parts.filter(p => p.text && p.text.trim());
  onEnd = onState;
  next();
  onState('playing');
}

function next() {
  if (current && current.el) current.el.classList.remove('speaking');
  current = queue.shift();
  if (!current) { const f = onEnd; onEnd = null; if (f) f('stopped'); return; }
  const u = new SpeechSynthesisUtterance(current.text);
  const v = voice();
  if (v) u.voice = v;
  u.lang = v ? v.lang : 'en-GB';
  u.rate = 1;
  u.onend = () => { if (onEnd) next(); };
  if (current.el) { current.el.classList.add('speaking'); current.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  speechSynthesis.speak(u);
}

export function pause() { speechSynthesis.pause(); }
export function resume() { speechSynthesis.resume(); }
export function stop() {
  const f = onEnd;
  onEnd = null;
  queue = [];
  if (current && current.el) current.el.classList.remove('speaking');
  current = null;
  if (canSpeak()) speechSynthesis.cancel();
  if (f) f('stopped');
}

// Plain text of an element, skipping anything marked data-no-speak (buttons, calculators, quizzes).
export function textOf(node) {
  const clone = node.cloneNode(true);
  clone.querySelectorAll('[data-no-speak], button, input, select, textarea, svg, .calc, .question, script, style').forEach(x => x.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}
