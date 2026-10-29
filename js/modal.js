// A pop-up dialog: focus moves in and stays in (Tab wraps), Escape and the cross close it when
// dismissible, and focus goes back where it was on close.
import { el } from './util.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function openModal(html, { label = 'Dialog', dismissible = true, onClose = () => {} } = {}) {
  const before = document.activeElement;
  const back = el(`<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-label="${label.replace(/"/g, '&quot;')}">
    ${dismissible ? '<button type="button" class="modal-x" aria-label="Close">×</button>' : ''}<div class="modal-body">${html}</div></div></div>`);
  document.body.append(back);
  document.body.style.overflow = 'hidden';
  const box = back.querySelector('.modal');
  let open = true;
  const close = (why = 'closed') => {
    if (!open) return;
    open = false;
    back.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey, true);
    if (before && before.isConnected) before.focus({ preventScroll: true });
    onClose(why);
  };
  function onKey(e) {
    if (e.key === 'Escape' && dismissible) { e.preventDefault(); close('escape'); }
    if (e.key !== 'Tab') return;
    const items = [...box.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);
  back.querySelector('.modal-x')?.addEventListener('click', () => close('cross'));
  (box.querySelector('h2') || box).setAttribute('tabindex', '-1');
  (box.querySelector('h2') || box).focus({ preventScroll: true });
  return { box: back.querySelector('.modal-body'), close, isOpen: () => open };
}
