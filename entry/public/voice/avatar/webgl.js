// WebGL renderer for the Mgadi voice companion: a friendly head-and-shoulders character built only from smooth-lit ellipsoids.
// No library, no external model file, no network. Everything here is original geometry written for Mgadi (see VOICE-AVATAR.md).
//
// Why this and not a downloaded model: a rigged human GLB with face blendshapes needs a renderer library (hundreds of KB), a
// licence that allows redistribution and a model whose provenance we can prove. None was available to verify offline, so
// nothing was downloaded. The `createWebglAvatar` / `createLiteAvatar` pair share one small interface, so a licensed model can
// replace this file later without touching the dock, the controller or the tests.
//
// Performance: one 24x16 sphere mesh (or a 14x9 one on slow devices), about 70 draw calls per frame, no textures, 30 fps cap.
// A governor measures real frame spacing and steps down (20 fps with the small mesh, then still frames) on slow phones.
import { createPoseModel } from './pose.js';

const VERT = `
attribute vec3 aPos;
uniform vec3 uRadius; uniform vec3 uCenter; uniform vec2 uRot;
uniform mat4 uGroup; uniform mat4 uVP;
varying vec3 vN;
void main() {
  vec3 p = aPos * uRadius;
  vec3 n = normalize(aPos / uRadius);
  p.xy = vec2(uRot.x * p.x - uRot.y * p.y, uRot.y * p.x + uRot.x * p.y);
  n.xy = vec2(uRot.x * n.x - uRot.y * n.y, uRot.y * n.x + uRot.x * n.y);
  vec4 w = uGroup * vec4(p + uCenter, 1.0);
  vN = normalize(mat3(uGroup) * n);
  gl_Position = uVP * w;
}`;
const FRAG = `
precision mediump float;
uniform vec3 uColor; uniform float uSpec;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  vec3 L = normalize(vec3(-0.45, 0.62, 0.78));
  float wrap = clamp((dot(n, L) + 0.4) / 1.4, 0.0, 1.0);
  float rim = pow(1.0 - max(n.z, 0.0), 2.6) * 0.20;
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, H), 0.0), 30.0) * uSpec;
  vec3 c = uColor * (0.36 + 0.80 * wrap) + uColor * rim * 1.3 + vec3(spec);
  gl_FragColor = vec4(c, 1.0);
}`;

// ---- tiny column-major matrix helpers
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };
const translate = (x, y, z) => { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m; };
const rotX = (a) => { const m = identity(); const c = Math.cos(a); const s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; };
const rotY = (a) => { const m = identity(); const c = Math.cos(a); const s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; };
const rotZ = (a) => { const m = identity(); const c = Math.cos(a); const s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; };
const perspective = (fovy, aspect, near, far) => { const f = 1 / Math.tan(fovy / 2); const m = new Array(16).fill(0); m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far); return m; };

// ---- the character. Units are roughly metres/3: the head is about 0.9 tall. Colours are sRGB 0..1.
const SKIN = [0.69, 0.46, 0.32]; const SKIN_SHADE = [0.62, 0.40, 0.28]; const HAIR = [0.14, 0.12, 0.11];
const SHIRT = [0.17, 0.36, 0.30]; const LIP = [0.56, 0.30, 0.26];
const SCLERA = [0.92, 0.89, 0.84]; const IRIS = [0.25, 0.15, 0.10]; const MOUTH_IN = [0.20, 0.07, 0.07]; const TEETH = [0.95, 0.93, 0.88];
const HEAD = [0, 0.36, 0];
const SKULL_R = [0.35, 0.475, 0.335];
const PIVOT = [0, -0.2, -0.02];
const lerp = (a, b, t) => a + (b - a) * t;
const surface = (x, y, c, r) => { const k = 1 - ((x - c[0]) / r[0]) ** 2 - ((y - c[1]) / r[1]) ** 2; return k > 0 ? c[2] + r[2] * Math.sqrt(k) : -Infinity; };
// Depth of the face at (x, y), relative to the head centre.
const faceZ = (x, y) => surface(x, y, [0, 0, 0], SKULL_R);

// Fills `out` with parts. Each part: head(boolean), c, r, rot, color, spec. Reused every frame, so no garbage is created.
export function buildParts(pose, out = []) {
  let n = 0;
  const add = (head, c, r, color, spec = 0, rot = 0) => {
    const part = out[n] ?? (out[n] = { head: true, c: [0, 0, 0], r: [0, 0, 0], color: SKIN, spec: 0, rot: 0 });
    part.head = head; part.c[0] = c[0]; part.c[1] = c[1]; part.c[2] = c[2]; part.r[0] = r[0]; part.r[1] = r[1]; part.r[2] = r[2];
    part.color = color; part.spec = spec; part.rot = rot; n += 1;
  };
  const H = (c) => [HEAD[0] + c[0], HEAD[1] + c[1], HEAD[2] + c[2]];
  // body (does not turn with the head)
  add(false, [0, -0.17, -0.02], [0.155, 0.17, 0.145], SKIN);
  add(false, [0, -0.80, 0], [0.78, 0.50, 0.36], SHIRT);
  for (const s of [-1, 1]) add(false, [s * 0.58, -0.58, 0], [0.30, 0.22, 0.30], SHIRT);
  // head
  add(true, H([0, 0, 0]), SKULL_R, SKIN, 0.06);
  for (const s of [-1, 1]) add(true, H([s * 0.352, -0.02, 0]), [0.05, 0.095, 0.045], SKIN);
  add(true, H([0, 0.26, -0.07]), [0.375, 0.285, 0.36], HAIR, 0.18);
  add(true, H([0, 0.32, -0.06]), [0.35, 0.22, 0.335], HAIR, 0.18);
  // nose
  add(true, H([0, -0.075, faceZ(0, -0.075) + 0.004]), [0.04, 0.068, 0.045], SKIN_SHADE, 0.05);
  add(true, H([0, -0.12, faceZ(0, -0.12) + 0.03]), [0.034, 0.028, 0.03], SKIN_SHADE, 0.08);
  // eyes and lids
  const ex = 0.132; const ey = 0.02; const closure = 1 - Math.min(1, Math.max(0, pose.eyeOpen));
  for (const s of [-1, 1]) {
    const x = s * ex; const zf = faceZ(x, ey);
    const gx = pose.gazeX * 0.022; const gy = pose.gazeY * 0.015;
    add(true, H([x, ey, zf - 0.012]), [0.058, 0.044, 0.036], SCLERA, 0.1);
    add(true, H([x + gx, ey + gy, zf + 0.008]), [0.036, 0.036, 0.02], IRIS, 0.2);
    add(true, H([x + gx, ey + gy, zf + 0.018]), [0.017, 0.017, 0.012], [0.03, 0.02, 0.02], 0);
    add(true, H([x + gx + 0.011, ey + gy + 0.012, zf + 0.026]), [0.0075, 0.0075, 0.005], [1, 1, 1], 1);
    // The lid rests inside the head when the eye is open and slides forward and down to close it.
    add(true, H([x, lerp(ey + 0.068, ey - 0.002, closure), lerp(zf - 0.07, zf - 0.004, closure)]), [0.066, 0.058, 0.042], SKIN, 0.04);
    const brow = s < 0 ? pose.browL : pose.browR;
    const by = ey + 0.098 + brow * 0.034;
    add(true, H([x, by, faceZ(x, by) + 0.012]), [0.066, 0.016, 0.02], HAIR, 0.1, -s * (0.12 - brow * 0.1));
  }
  // mouth: a chain of small ellipsoids that curves with the smile and separates as it opens
  const open = Math.min(1, Math.max(0, pose.mouth)); const smile = Math.min(1, Math.max(0, pose.smile));
  const my = -0.225; const half = 0.08;
  const upper = []; const lower = [];
  for (let i = 0; i <= 4; i += 1) {
    const x = lerp(-half, half, i / 4); const u = x / half;
    const base = my + smile * 0.03 * u * u;
    upper.push([x, base + 0.006 + open * 0.012]);
    lower.push([x, base - 0.006 - open * 0.045 * (1 - 0.35 * u * u)]);
  }
  const lipChain = (points, thickness) => {
    for (let i = 0; i < points.length - 1; i += 1) {
      const [x0, y0] = points[i]; const [x1, y1] = points[i + 1];
      const mx = (x0 + x1) / 2; const my2 = (y0 + y1) / 2; const length = Math.hypot(x1 - x0, y1 - y0);
      const edge = 1 - 0.35 * (mx / half) ** 2;
      add(true, H([mx, my2, faceZ(mx, my2) - 0.002]), [length * 0.92, thickness * edge, 0.016], LIP, 0.0, Math.atan2(y1 - y0, x1 - x0));
    }
  };
  lipChain(upper, 0.0115); lipChain(lower, 0.0135);
  if (open > 0.04) {
    const z = faceZ(0, my) + 0.004; const cy = my - open * 0.016;
    add(true, H([0, cy, z]), [0.072 * (0.55 + 0.45 * open), Math.max(0.003, open * 0.03), 0.018], MOUTH_IN, 0);
    if (open > 0.25) add(true, H([0, my + 0.005 + open * 0.012 - 0.01, z + 0.006]), [0.05 * (0.7 + 0.3 * open), 0.0065, 0.01], TEETH, 0.15);
  }
  return out.slice(0, n);
}

function sphereMesh(segments, rings) {
  const positions = []; const indices = [];
  for (let i = 0; i <= rings; i += 1) {
    const t = (Math.PI * i) / rings;
    for (let j = 0; j <= segments; j += 1) { const p = (2 * Math.PI * j) / segments; positions.push(Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p)); }
  }
  for (let i = 0; i < rings; i += 1) for (let j = 0; j < segments; j += 1) { const a = i * (segments + 1) + j; const b = a + segments + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
  return { positions: new Float32Array(positions), indices: new Uint16Array(indices) };
}

// Frame pacing tiers. `maxGap` is the average time between drawn frames that is too slow for this tier.
const TIERS = [
  { name: 'full', fps: 30, mesh: [24, 16], maxGap: 52 },
  { name: 'reduced', fps: 20, mesh: [14, 9], maxGap: 85 },
  { name: 'still', fps: 0, mesh: [14, 9], maxGap: Infinity },
];

export function createWebglAvatar(canvas, {
  model = createPoseModel(), now = () => globalThis.performance.now(), raf = (fn) => globalThis.requestAnimationFrame(fn), caf = (id) => globalThis.cancelAnimationFrame(id),
  onFallback = () => {}, reducedMotion = false, forceTier = null, doc = globalThis.document,
} = {}) {
  let gl = null;
  try { gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'low-power' }); } catch { gl = null; }
  if (!gl) return null;
  const compile = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null; };
  const vs = compile(gl.VERTEX_SHADER, VERT); const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!vs || !fs) return null;
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const loc = (name) => gl.getUniformLocation(program, name);
  const U = { radius: loc('uRadius'), center: loc('uCenter'), rot: loc('uRot'), group: loc('uGroup'), vp: loc('uVP'), color: loc('uColor'), spec: loc('uSpec') };
  const aPos = gl.getAttribLocation(program, 'aPos');

  const meshes = new Map();
  const meshFor = (tier) => {
    const key = tier.mesh.join('x');
    if (!meshes.has(key)) {
      const data = sphereMesh(...tier.mesh);
      const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);
      const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
      meshes.set(key, { vbo, ibo, count: data.indices.length });
    }
    return meshes.get(key);
  };

  gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0);
  let tierIndex = forceTier ?? 0; let reduced = Boolean(reducedMotion); let running = false; let frameId = 0; let lastDrawn = -Infinity;
  let destroyed = false; let lost = false; let renders = 0; let lastRenderMs = 0; let lastStep = null;
  const gaps = []; const parts = [];
  model.setReducedMotion(reduced);

  const view = () => {
    const aspect = canvas.width / canvas.height;
    return mul(perspective((24 * Math.PI) / 180, aspect, 0.1, 30), translate(0, -0.30, -4.5));
  };

  function draw() {
    if (destroyed || lost) return;
    const started = now();
    const pose = model.pose;
    const mesh = meshFor(TIERS[tierIndex]);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(U.vp, false, view());
    const breath = pose.breath * 0.006; const lean = pose.lean;
    const body = translate(0, breath * 0.6, lean * 0.02);
    let headGroup = translate(PIVOT[0], PIVOT[1] + breath, PIVOT[2] + lean * 0.07);
    headGroup = mul(headGroup, mul(rotY(pose.yaw), mul(rotX(pose.pitch + lean * 0.03), rotZ(pose.roll))));
    headGroup = mul(headGroup, translate(-PIVOT[0], -PIVOT[1], -PIVOT[2]));
    let current = null;
    for (const part of buildParts(pose, parts)) {
      const group = part.head ? headGroup : body;
      if (group !== current) { gl.uniformMatrix4fv(U.group, false, group); current = group; }
      gl.uniform3fv(U.radius, part.r); gl.uniform3fv(U.center, part.c);
      gl.uniform2f(U.rot, Math.cos(part.rot), Math.sin(part.rot));
      gl.uniform3fv(U.color, part.color); gl.uniform1f(U.spec, part.spec);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }
    renders += 1; lastRenderMs = now() - started;
  }

  function governor(t) {
    if (lastDrawn > -Infinity) gaps.push(t - lastDrawn);
    if (gaps.length > 40) gaps.shift();
    if (forceTier !== null || gaps.length < 30) return;
    const average = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
    if (average > TIERS[tierIndex].maxGap && tierIndex < TIERS.length - 1) { tierIndex += 1; gaps.length = 0; onFallback({ type: 'tier', tier: TIERS[tierIndex].name }); }
  }

  function frame(t) {
    frameId = 0;
    if (!running || destroyed) return;
    const tier = TIERS[tierIndex];
    if (tier.fps === 0) { running = false; model.settle(); draw(); return; }
    if (doc?.hidden) { frameId = raf(frame); return; }
    if (t - lastDrawn >= 1000 / tier.fps - 2) {
      const dt = lastStep === null ? 16 : t - lastStep; lastStep = t;
      model.step(dt); governor(t); draw(); lastDrawn = t;
    }
    if (running) frameId = raf(frame);
  }

  const onLost = (event) => { event.preventDefault?.(); lost = true; running = false; if (frameId) caf(frameId); onFallback({ type: 'context-lost' }); };
  canvas.addEventListener?.('webglcontextlost', onLost);

  const api = {
    renderer: 'webgl',
    play() { if (reduced || destroyed || lost || running) return; running = true; lastStep = null; frameId = raf(frame); },
    pause() { running = false; if (frameId) { caf(frameId); frameId = 0; } },
    setMood(mood) { model.setMood(mood); if (!running) { model.settle(); draw(); } },
    // Loudness of the ASSISTANT's audio only.
    setLevel(level) { model.setLevel(level); },
    setApproximate(on) { model.setApproximate(on); },
    setReducedMotion(on) { reduced = Boolean(on); model.setReducedMotion(reduced); if (reduced) { api.pause(); model.settle(); draw(); } },
    renderOnce() { model.step(16); draw(); },
    // Renders now and returns the pixels (RGBA, bottom row first). For tests.
    snapshot() { draw(); const pixels = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return pixels; },
    getStats() { return { renderer: 'webgl', tier: TIERS[tierIndex].name, renders, lastRenderMs, running, reducedMotion: reduced, levelsSeen: model.levelsSeen, pose: { ...model.pose } }; },
    model,
    destroy() { destroyed = true; running = false; if (frameId) caf(frameId); canvas.removeEventListener?.('webglcontextlost', onLost); try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ } },
  };
  model.settle(); draw();
  return api;
}
