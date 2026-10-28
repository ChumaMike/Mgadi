// Floating companion for the voice conversation. It sits in a bottom corner, can be made larger or smaller, hidden and restored,
// and follows the real voice state. It is a visual companion for the conversation, NOT a sign language translator, and says so.
//
// Layout is driven by html[data-avatar="min|max|off"] so voice.css can keep it clear of the bank button and the call controls, and by
// html[data-keyboard="open"] (see viewport.js), which makes it step aside while the on-screen keyboard is up.
//
// Inputs, all from the voice controller:
//   setState({ uiState, muted })  uiState is one of the nine voice states (idle, connecting, listening, thinking, speaking, muted,
//                                 reconnecting, failed, ended).
//   setLevel(level)               loudness of the ASSISTANT's audio. Never the person's microphone.
// Each state has its own spoken name, so a screen reader hears the truth (for example "muted, so Mgadi cannot hear you").
const NAMES = {
  idle: 'resting', connecting: 'connecting', reconnecting: 'reconnecting, the connection dropped', listening: 'listening',
  thinking: 'thinking', speaking: 'speaking', muted: 'muted, so Mgadi cannot hear you', failed: 'not connected', ended: 'call ended',
};
// The drawn look. Only five faces exist; connection problems and endings use the resting one.
const POSE = { idle: 'idle', connecting: 'idle', reconnecting: 'idle', failed: 'idle', ended: 'idle', listening: 'listening', thinking: 'thinking', speaking: 'speaking', muted: 'muted' };
const BADGES = { muted: 'Mic muted', connecting: 'Connecting', reconnecting: 'Reconnecting', failed: 'Not connected' };

export function createAvatarDock({ createCompanion, doc = document, win = window, prefer = 'auto' }) {
  const root = doc.createElement('div'); root.className = 'avatar-dock'; root.hidden = true; root.lang = 'en'; // these labels are English only for now, so a screen reader in another language must not mispronounce them
  root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Mgadi avatar controls');
  const figure = doc.createElement('div'); figure.className = 'avatar-figure'; figure.setAttribute('role', 'img');
  const badge = doc.createElement('span'); badge.className = 'avatar-badge'; badge.hidden = true; badge.setAttribute('aria-hidden', 'true');
  const caption = doc.createElement('span'); caption.className = 'avatar-caption'; caption.textContent = 'Visual companion, not a sign language translator'; caption.setAttribute('aria-hidden', 'true');
  const toggle = doc.createElement('button'); toggle.type = 'button'; toggle.className = 'avatar-btn avatar-size';
  const hide = doc.createElement('button'); hide.type = 'button'; hide.className = 'avatar-btn avatar-hide'; hide.textContent = '×'; hide.setAttribute('aria-label', 'Hide the avatar');
  root.append(figure, badge, caption, toggle, hide); doc.body.append(root);

  let avatar = null; let uiState = 'idle'; let muted = false; let size = 'min'; let hidden = false; let active = false; let renderer = 'none';
  const reducedMotion = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || doc.documentElement.dataset.reducedMotion === 'true';
  const lowData = () => doc.documentElement.dataset.textOnly === 'true';

  function describe() {
    figure.setAttribute('aria-label', `Mgadi avatar, ${NAMES[uiState]}. A visual companion only, not a sign language translation.`);
    toggle.textContent = size === 'max' ? '−' : '+';
    toggle.setAttribute('aria-label', size === 'max' ? 'Make the avatar smaller' : 'Make the avatar larger');
    toggle.setAttribute('aria-expanded', String(size === 'max'));
    root.dataset.state = uiState; root.dataset.size = size; root.dataset.renderer = renderer;
    // The mic-off badge is shown whenever the microphone is muted, even while the assistant is speaking.
    const text = muted && active ? BADGES.muted : active ? BADGES[uiState] ?? '' : '';
    badge.hidden = !text; badge.textContent = text; badge.dataset.kind = muted ? 'muted' : uiState;
  }
  function layout() {
    const visible = active && !hidden && !lowData();
    root.hidden = !visible;
    doc.documentElement.dataset.avatar = visible ? size : 'off';
    if (visible && !avatar) {
      avatar = createCompanion(figure, { prefer, reducedMotion: reducedMotion(), onChange: (change) => { renderer = change.renderer; describe(); } });
      renderer = avatar.renderer;
    }
    if (!avatar) return;
    avatar.setReducedMotion(reducedMotion());
    avatar.setMood(POSE[uiState]);
    // Under reduced motion the face changes with the state but never animates. When the avatar is hidden or the call is not live, nothing runs.
    if (visible && !reducedMotion()) avatar.play(); else avatar.pause();
    describe();
  }
  const observer = new win.MutationObserver(layout);
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion', 'data-text-only'] });
  const motionQuery = win.matchMedia?.('(prefers-reduced-motion: reduce)'); motionQuery?.addEventListener?.('change', layout);
  toggle.addEventListener('click', () => { size = size === 'max' ? 'min' : 'max'; layout(); });
  hide.addEventListener('click', () => { hidden = true; layout(); api.onHidden?.(); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && size === 'max') { size = 'min'; layout(); e.stopPropagation(); } });
  describe();

  const api = {
    root, onHidden: null,
    // Shown only while a voice conversation is in progress.
    setActive(on) { active = Boolean(on); if (!active) { uiState = 'idle'; muted = false; } layout(); },
    setState(next) {
      const state = NAMES[next?.uiState] ? next.uiState : 'idle';
      muted = Boolean(next?.muted); uiState = state; layout();
    },
    // Kept for older callers: a single mood name.
    setMood(next) { api.setState({ uiState: NAMES[next] ? next : 'idle', muted: next === 'muted' }); },
    // Loudness of the ASSISTANT's audio only. Called about once per animation frame, so it does no layout.
    setLevel(level) { avatar?.setLevel(level); },
    // Only used by the explicitly labelled offline animation preview; never substitutes for real voice audio.
    setApproximate(on) { avatar?.setApproximate(Boolean(on)); },
    show() { hidden = false; layout(); }, isHidden: () => hidden, getMood: () => uiState, getSize: () => size,
    getRenderer: () => renderer, getStats: () => avatar?.getStats() ?? null,
    destroy() { observer.disconnect(); motionQuery?.removeEventListener?.('change', layout); avatar?.destroy(); root.remove(); },
  };
  return api;
}
