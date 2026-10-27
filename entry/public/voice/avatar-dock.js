// Floating avatar for the voice conversation. It reuses the existing original 3D mannequin (accessibility/avatar.js).
// It is a visual companion for the conversation, NOT a sign language translator, and the interface says so.
// Layout is driven by [data-avatar] on <html> so CSS can keep it clear of the bank button and the call controls.
const MOODS = { idle: 'resting', listening: 'listening', speaking: 'speaking' };

export function createAvatarDock({ createAvatar, doc = document, win = window }) {
  const root = doc.createElement('div'); root.className = 'avatar-dock'; root.hidden = true;
  root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Mgadi avatar controls');
  const canvas = doc.createElement('canvas'); canvas.width = 400; canvas.height = 470; canvas.setAttribute('role', 'img');
  const toggle = doc.createElement('button'); toggle.type = 'button'; toggle.className = 'avatar-btn';
  const hide = doc.createElement('button'); hide.type = 'button'; hide.className = 'avatar-btn'; hide.textContent = '×'; hide.setAttribute('aria-label', 'Hide the avatar');
  root.append(canvas, toggle, hide); doc.body.append(root);

  let avatar = null; let mood = 'idle'; let size = 'min'; let hidden = false; let active = false;
  const reducedMotion = () => win.matchMedia?.('(prefers-reduced-motion: reduce)').matches || doc.documentElement.dataset.reducedMotion === 'true';
  const lowData = () => doc.documentElement.dataset.textOnly === 'true';

  function describe() {
    canvas.setAttribute('aria-label', `Mgadi avatar, ${MOODS[mood]}. A visual companion only, not a sign language translation.`);
    toggle.textContent = size === 'max' ? '−' : '+';
    toggle.setAttribute('aria-label', size === 'max' ? 'Make the avatar smaller' : 'Make the avatar larger');
    toggle.setAttribute('aria-expanded', String(size === 'max'));
  }
  function layout() {
    const visible = active && !hidden && !lowData();
    root.hidden = !visible;
    doc.documentElement.dataset.avatar = visible ? size : 'off';
    if (visible && !avatar) { avatar = createAvatar(canvas); }
    if (!avatar) return;
    avatar.setMood(mood);
    // With reduced motion the avatar changes pose when the state changes but never animates.
    if (visible && !reducedMotion()) avatar.play(); else avatar.pause();
  }
  const observer = new win.MutationObserver(layout);
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion', 'data-text-only'] });
  win.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', layout);
  toggle.addEventListener('click', () => { size = size === 'max' ? 'min' : 'max'; describe(); layout(); });
  hide.addEventListener('click', () => { hidden = true; layout(); api.onHidden?.(); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && size === 'max') { size = 'min'; describe(); layout(); e.stopPropagation(); } });
  describe();

  const api = {
    root, onHidden: null,
    // Shown only while a voice conversation is in progress.
    setActive(on) { active = on; if (!on) { mood = 'idle'; describe(); } layout(); },
    setMood(next) { mood = MOODS[next] ? next : 'idle'; describe(); layout(); },
    show() { hidden = false; layout(); }, isHidden: () => hidden, getMood: () => mood, getSize: () => size,
  };
  return api;
}
