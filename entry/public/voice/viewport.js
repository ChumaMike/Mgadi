// Keeps the voice panel and the floating avatar clear of the on-screen keyboard.
//
// On most Android browsers the keyboard overlays the page without resizing the layout viewport, so a `position: fixed` panel at
// `bottom: 0` ends up hidden behind it. The visual viewport reports the real visible area, so the difference is exposed as
// the CSS variable --kb-inset (panel and avatar lift by it) and html[data-keyboard="open"] (the avatar steps aside while typing).
// Where the browser resizes the layout viewport itself (iOS and "resizes-content" Android), the inset works out as 0, which is correct.
const KEYBOARD_MIN_PX = 120; // smaller differences are browser toolbars sliding in and out, not a keyboard

export function computeKeyboardInset({ innerHeight, viewportHeight, viewportTop = 0 }) {
  const inset = Math.round(innerHeight - viewportHeight - viewportTop);
  return inset > KEYBOARD_MIN_PX ? inset : 0;
}

export function watchKeyboard({ win = globalThis.window, doc = globalThis.document } = {}) {
  const vv = win?.visualViewport;
  const root = doc?.documentElement;
  if (!vv || !root) return () => {};
  const update = () => {
    const inset = computeKeyboardInset({ innerHeight: win.innerHeight, viewportHeight: vv.height, viewportTop: vv.offsetTop });
    root.style.setProperty('--kb-inset', `${inset}px`);
    const state = inset > 0 ? 'open' : 'closed';
    if (root.dataset.keyboard !== state) root.dataset.keyboard = state;
  };
  vv.addEventListener('resize', update); vv.addEventListener('scroll', update); win.addEventListener('orientationchange', update);
  update();
  return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); win.removeEventListener('orientationchange', update); root.style.removeProperty('--kb-inset'); delete root.dataset.keyboard; };
}
