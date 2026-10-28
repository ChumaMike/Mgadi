// Lightweight fallback companion: flat 2D drawing, about 25 canvas calls per frame, 12 fps at most, no WebGL.
// Used when WebGL is missing, the GPU context is lost, or the full renderer cannot keep up. It shows the same states
// (listening lean, thinking glance, muted lids, mouth following the ASSISTANT's audio level) in a simpler style.
// If even a 2D canvas is unavailable, createLiteAvatar returns a no-op with renderer "none": the dock's text status still works.
import { createPoseModel } from './pose.js';

const FRAME_MS = 1000 / 12;

export function createLiteAvatar(canvas, {
  model = createPoseModel(), now = () => globalThis.performance.now(), raf = (fn) => globalThis.requestAnimationFrame(fn), caf = (id) => globalThis.cancelAnimationFrame(id),
  reducedMotion = false, doc = globalThis.document,
} = {}) {
  let ctx = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  let reduced = Boolean(reducedMotion); let running = false; let frameId = 0; let lastDrawn = -Infinity; let lastStep = null; let renders = 0; let destroyed = false;
  model.setReducedMotion(reduced);

  function draw() {
    if (!ctx || destroyed) return;
    const w = canvas.width; const h = canvas.height; const p = model.pose;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2 + p.yaw * w * 0.5 + p.roll * 20; const cy = h * 0.42 - p.lean * h * 0.01; const R = w * 0.30;
    // shoulders
    ctx.fillStyle = '#2b5c4d'; ctx.beginPath(); ctx.ellipse(w / 2, h * 1.02, w * 0.46, h * 0.26 + p.breath * 2, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#b07651'; ctx.fillRect(w / 2 - R * 0.28, cy + R * 0.7, R * 0.56, R * 0.7);
    // head and hair
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(p.roll * 1.6);
    ctx.fillStyle = '#b07651'; ctx.beginPath(); ctx.ellipse(0, 0, R * 0.98, R * 1.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#241f1c'; ctx.beginPath(); ctx.ellipse(0, -R * 0.62, R * 1.02, R * 0.72, 0, Math.PI, 0); ctx.fill();
    // eyes (lids close with eyeOpen), brows
    for (const s of [-1, 1]) {
      const ex = s * R * 0.38; const ey = -R * 0.02;
      ctx.fillStyle = '#f5f0e6'; ctx.beginPath(); ctx.ellipse(ex, ey, R * 0.19, R * 0.15 * Math.max(0.06, p.eyeOpen), 0, 0, Math.PI * 2); ctx.fill();
      if (p.eyeOpen > 0.2) { ctx.fillStyle = '#3f2a1c'; ctx.beginPath(); ctx.arc(ex + p.gazeX * R * 0.05, ey + p.gazeY * -R * 0.04, R * 0.09, 0, Math.PI * 2); ctx.fill(); }
      const brow = s < 0 ? p.browL : p.browR;
      ctx.strokeStyle = '#241f1c'; ctx.lineWidth = Math.max(2, R * 0.05); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ex - s * R * 0.17, ey - R * (0.3 + brow * 0.1) + s * R * 0.03); ctx.lineTo(ex + s * R * 0.17, ey - R * (0.3 + brow * 0.1) - s * R * 0.03); ctx.stroke();
    }
    // mouth: a smile line that opens into a dark oval as the assistant's audio gets louder
    const my = R * 0.55; const open = p.mouth;
    ctx.strokeStyle = '#6b2f2a'; ctx.fillStyle = '#3a1313'; ctx.lineWidth = Math.max(2, R * 0.045);
    ctx.beginPath(); ctx.moveTo(-R * 0.3, my - p.smile * R * 0.08); ctx.quadraticCurveTo(0, my + p.smile * R * 0.16 + open * R * 0.3, R * 0.3, my - p.smile * R * 0.08);
    if (open > 0.06) { ctx.quadraticCurveTo(0, my + R * 0.1 + open * R * 0.34, -R * 0.3, my - p.smile * R * 0.08); ctx.fill(); }
    ctx.stroke();
    ctx.restore();
    renders += 1;
  }

  function frame(t) {
    frameId = 0; if (!running || destroyed) return;
    if (doc?.hidden) { frameId = raf(frame); return; }
    if (t - lastDrawn >= FRAME_MS - 2) { const dt = lastStep === null ? 16 : t - lastStep; lastStep = t; model.step(dt); draw(); lastDrawn = t; }
    frameId = raf(frame);
  }

  const api = {
    renderer: ctx ? 'lite' : 'none',
    play() { if (reduced || destroyed || running || !ctx) return; running = true; lastStep = null; frameId = raf(frame); },
    pause() { running = false; if (frameId) { caf(frameId); frameId = 0; } },
    setMood(mood) { model.setMood(mood); if (!running) { model.settle(); draw(); } },
    setLevel(level) { model.setLevel(level); },
    setApproximate(on) { model.setApproximate(on); },
    setReducedMotion(on) { reduced = Boolean(on); model.setReducedMotion(reduced); if (reduced) { api.pause(); model.settle(); draw(); } },
    renderOnce() { model.step(16); draw(); },
    snapshot() { draw(); return ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height).data : new Uint8Array(0); },
    getStats() { return { renderer: api.renderer, tier: 'lite', renders, running, reducedMotion: reduced, levelsSeen: model.levelsSeen, pose: { ...model.pose } }; },
    model,
    destroy() { destroyed = true; running = false; if (frameId) caf(frameId); },
  };
  model.settle(); draw();
  return api;
}
