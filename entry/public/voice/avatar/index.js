// Picks the best companion renderer that works on this device and falls back without the person noticing:
//   WebGL (smooth 3D)  ->  lite 2D drawing  ->  nothing (the dock's text status carries the information).
// The result always has the same methods, so the rest of the app never needs to know which one it got.
//
// `host` is a container element. This module creates and owns the <canvas> inside it (a canvas that has handed out a WebGL context
// can never hand out a 2D one, so a lost GL context means a fresh canvas). The host, not the canvas, carries the accessible name.
import { createPoseModel } from './pose.js';
import { createWebglAvatar } from './webgl.js';
import { createLiteAvatar } from './lite.js';

export const CANVAS_WIDTH = 440;
export const CANVAS_HEIGHT = 518;

// A weak phone starts on the lite renderer: 2 or fewer CPU cores, or 2 GB of memory or less (navigator.deviceMemory is rounded by the
// browser and absent in some, in which case only the core count is used). Everything else tries WebGL first, and the governor in
// webgl.js still steps down if frames come too slowly.
export function isLowEndDevice(nav = globalThis.navigator) {
  const cores = Number(nav?.hardwareConcurrency); const memory = Number(nav?.deviceMemory);
  return (Number.isFinite(cores) && cores > 0 && cores <= 2) || (Number.isFinite(memory) && memory > 0 && memory <= 2);
}

// `prefer: 'lite'` forces the fallback (low-data mode, tests). Anything else tries WebGL first, unless the device is clearly weak.
export function createCompanion(host, { prefer = 'auto', reducedMotion = false, onChange = () => {}, doc = host.ownerDocument, ...rest } = {}) {
  const model = createPoseModel({ reducedMotion });
  let active = null; let canvas = null;
  const freshCanvas = () => {
    canvas?.remove();
    canvas = doc.createElement('canvas'); canvas.width = CANVAS_WIDTH; canvas.height = CANVAS_HEIGHT; canvas.setAttribute('aria-hidden', 'true');
    host.append(canvas);
    return canvas;
  };
  const useLite = () => createLiteAvatar(freshCanvas(), { model, reducedMotion, ...rest });
  const handleFallback = (event) => {
    if (event.type === 'context-lost') {
      const wasRunning = active?.getStats().running;
      active?.destroy(); active = useLite(); if (wasRunning) active.play();
      onChange({ renderer: active.renderer, reason: 'context-lost' });
    } else onChange({ renderer: 'webgl', reason: event.type, tier: event.tier });
  };
  if (prefer !== 'lite' && !(prefer === 'auto' && isLowEndDevice())) active = createWebglAvatar(freshCanvas(), { model, reducedMotion, onFallback: handleFallback, ...rest });
  if (!active) active = useLite();
  // Delegating wrapper, so the object the app holds stays valid after a renderer swap.
  return {
    get renderer() { return active.renderer; },
    get canvas() { return canvas; },
    play: () => active.play(), pause: () => active.pause(),
    setMood: (m) => active.setMood(m), setLevel: (l) => active.setLevel(l), setApproximate: (a) => active.setApproximate(a),
    setReducedMotion: (r) => active.setReducedMotion(r), renderOnce: () => active.renderOnce(), snapshot: () => active.snapshot(),
    getStats: () => active.getStats(), destroy: () => active.destroy(), model,
  };
}
export { createPoseModel };
