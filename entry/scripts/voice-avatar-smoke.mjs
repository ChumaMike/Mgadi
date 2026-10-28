// Browser tests for the voice companion: the real WebGL renderer, its fallbacks, the nine states, assistant-audio lip movement, reduced
// motion, the performance governor, the floating layout at phone, tablet and desktop sizes, the on-screen keyboard, and the emergency
// buttons. Uses the labelled SIMULATION adapter, so nothing here contacts a provider or uses a microphone.
//   MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs [MGADI_SHOTS_DIR=/where/to/save/screenshots] node scripts/voice-avatar-smoke.mjs
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';

let chromium;
try { ({ chromium } = await import(process.env.MGADI_PLAYWRIGHT ?? 'playwright')); }
catch { console.log('SKIPPED: Playwright is not installed (set MGADI_PLAYWRIGHT). Nothing was tested.'); process.exit(0); }

const shotsDir = process.env.MGADI_SHOTS_DIR || '';
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const app = createApp({ env: { MGADI_VOICE_MODE: 'mock' } });
app.listen(0, '127.0.0.1'); await once(app, 'listening');
const base = `http://127.0.0.1:${app.address().port}`;
const browser = await chromium.launch();
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`); };
const shot = async (page, name) => { if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${name}.png`) }); };

const open = async ({ width = 390, height = 844, query = 'mockvoice=fast', reducedMotion = false, init = null } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage(); page.errors = [];
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  if (init) await page.addInitScript(init);
  page.on('pageerror', (e) => page.errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(`${base}/?${query}`); await page.waitForSelector('h1'); return page;
};
const begin = async (page) => { await page.locator('.incident-choices button:has-text("Money or a payment problem")').click(); await page.getByRole('button', { name: 'Tell Mgadi by text', exact: true }).click(); await page.locator('.incident-choices button:has-text("I paid after")').click(); await page.waitForSelector('text=Step 1 of'); };
const launch = async (page) => { await page.click('.voice-launch'); await page.waitForSelector('.voice-panel:not([hidden])'); };
const talk = async (page) => { await page.check('#voice-consent-check'); await page.click('.vp-start'); await page.waitForSelector('.vp-status:has-text("Connected")'); };
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' }; }, sel);
const hit = (a, b) => a && b && a.visible && b.visible && !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
// Wait until the scripted conversation has finished and the state has been "Listening" for a moment.
const steady = async (page) => { let last = ''; let since = Date.now(); for (let i = 0; i < 120; i += 1) { const now = await page.locator('.vp-activity').innerText(); if (now !== last) { last = now; since = Date.now(); } if (now === 'Listening' && Date.now() - since > 1500) return; await page.waitForTimeout(100); } };
const controls = (page) => page.evaluate(() => [...document.querySelectorAll('.vp-controls button, .vp-btnrow button, #emergency-button, .vp-status, .vp-chat')].filter((b) => !b.closest('[hidden]') && b.offsetWidth > 0).map((b) => {
  let r = b.getBoundingClientRect();
  // The chat scrolls inside the panel body, so only the part of it that is actually visible counts.
  if (b.classList.contains('vp-chat')) { const body = document.querySelector('.vp-body').getBoundingClientRect(); const top = Math.max(r.top, body.top); const bottom = Math.min(r.bottom, body.bottom); r = { x: r.x, y: top, width: r.width, height: Math.max(0, bottom - top) }; }
  return { n: b.classList.contains('vp-chat') ? 'vp-chat' : (b.textContent || b.className).trim().slice(0, 30), x: r.x, y: r.y, w: r.width, h: r.height, visible: r.height > 0 };
}));

try {
  // ---- 1. The renderer: real WebGL, and what it draws
  let page = await open();
  await begin(page); await launch(page); await talk(page);
  await page.waitForTimeout(800);
  check('the companion uses the WebGL renderer in this browser', (await page.locator('.avatar-dock').getAttribute('data-renderer')) === 'webgl', await page.locator('.avatar-dock').getAttribute('data-renderer'));
  check('the dock exposes its state and size as attributes for the rest of the app', ['data-state', 'data-size', 'data-renderer'].every((a) => page.locator('.avatar-dock').getAttribute(a)));
  const figure = await (await page.locator('.avatar-figure').screenshot()).toString('base64');
  check('the canvas really draws a character (not blank)', figure.length > 4000, String(figure.length));
  check('the canvas itself is hidden from assistive technology; the figure carries one accessible name', (await page.locator('.avatar-figure canvas').getAttribute('aria-hidden')) === 'true' && (await page.locator('.avatar-figure').getAttribute('role')) === 'img');

  // ---- 2. The nine states, driven through the real dock in the page
  const states = await page.evaluate(async () => {
    const { createAvatarDock } = await import('/voice/avatar-dock.js');
    const { createCompanion } = await import('/voice/avatar/index.js');
    const dock = createAvatarDock({ createCompanion }); dock.setActive(true);
    const out = {};
    for (const state of ['idle', 'connecting', 'listening', 'thinking', 'speaking', 'muted', 'reconnecting', 'failed', 'ended']) {
      dock.setState({ uiState: state, muted: state === 'muted' });
      out[state] = { label: dock.root.querySelector('[role=img]').getAttribute('aria-label'), attr: dock.root.dataset.state, badge: dock.root.querySelector('.avatar-badge').hidden ? '' : dock.root.querySelector('.avatar-badge').textContent, running: dock.getStats().running };
    }
    dock.setState({ uiState: 'speaking', muted: true }); out.speakingMuted = { badge: dock.root.querySelector('.avatar-badge').textContent, label: dock.root.querySelector('[role=img]').getAttribute('aria-label') };
    dock.setActive(false); out.afterEnd = { hidden: dock.root.hidden, state: dock.root.dataset.state };
    dock.destroy(); return out;
  });
  check('each of the nine states has its own spoken name', ['idle', 'connecting', 'listening', 'thinking', 'speaking', 'muted', 'reconnecting', 'failed', 'ended'].every((s) => states[s].label.includes(s === 'muted' ? 'muted, so Mgadi cannot hear you' : s === 'failed' ? 'not connected' : s === 'ended' ? 'call ended' : s === 'idle' ? 'resting' : s)), JSON.stringify(states));
  check('every label says it is a visual companion and not a sign language translation', Object.values(states).filter((v) => v.label).every((v) => v.label.includes('not a sign language translation')));
  check('muted shows the "Mic muted" badge, also while the assistant is speaking', states.muted.badge === 'Mic muted' && states.speakingMuted.badge === 'Mic muted' && states.speakingMuted.label.includes('speaking'), JSON.stringify([states.muted, states.speakingMuted]));
  check('connection problems are shown on the avatar, not hidden', states.connecting.badge === 'Connecting' && states.reconnecting.badge === 'Reconnecting' && states.failed.badge === 'Not connected');
  check('when the call is over the avatar is hidden and returns to resting', states.afterEnd.hidden === true && states.afterEnd.state === 'idle');

  // ---- 3. Distinct faces per state and lip movement that follows the ASSISTANT's audio level (pixels, not just numbers)
  const faces = await page.evaluate(async () => {
    const { createCompanion } = await import('/voice/avatar/index.js');
    const host = document.createElement('div'); document.body.append(host);
    const a = createCompanion(host); a.pause();
    const draw = (mood, level = 0) => { a.setMood(mood); a.model.setReducedMotion(false); a.model.settle(); for (let i = 0; i < 80; i += 1) { a.setLevel(level); a.model.step(16); } return a.snapshot(); };
    const W = a.canvas.width; const H = a.canvas.height;
    const hash = (px) => { let h = 0; for (let i = 0; i < px.length; i += 97) h = (h * 31 + px[i]) | 0; return h; };
    // Pixel difference inside the lower-middle of the face (the mouth) between two frames.
    const mouthDiff = (p, q) => { let n = 0; const x0 = Math.floor(W * 0.38); const x1 = Math.floor(W * 0.62); const y0 = Math.floor(H * 0.38); const y1 = Math.floor(H * 0.52); for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) { const i = (y * W + x) * 4; if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 60) n += 1; } return n; };
    const frames = { idle: draw('idle'), listening: draw('listening'), thinking: draw('thinking'), muted: draw('muted'), speakingQuiet: draw('speaking', 0), speakingLoud: draw('speaking', 0.2), speakingMid: draw('speaking', 0.05) };
    const hashes = Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, hash(v)]));
    const out = { hashes, loudVsQuiet: mouthDiff(frames.speakingLoud, frames.speakingQuiet), midVsQuiet: mouthDiff(frames.speakingMid, frames.speakingQuiet), quietVsIdle: mouthDiff(frames.speakingQuiet, frames.idle), renderer: a.renderer };
    // Speaking state but silent audio: the mouth value must be closed. (The only audio the dock is ever given is the assistant's.)
    draw('speaking', 0); out.silentMouth = a.getStats().pose.mouth;
    draw('speaking', 0.2); out.loudMouth = a.getStats().pose.mouth;
    a.destroy(); host.remove(); return out;
  });
  check('listening, thinking, muted and speaking each look different from resting and from each other', new Set([faces.hashes.idle, faces.hashes.listening, faces.hashes.thinking, faces.hashes.muted, faces.hashes.speakingLoud]).size === 5, JSON.stringify(faces.hashes));
  check('the mouth opens with the assistant\'s audio level: loud differs from silent in the mouth region', faces.loudVsQuiet > 120, String(faces.loudVsQuiet));
  check('a medium level opens it less than a loud one (it follows the level, it is not on/off)', faces.midVsQuiet > 20 && faces.midVsQuiet < faces.loudVsQuiet, JSON.stringify(faces));
  check('speaking with silent audio keeps the mouth closed; loud audio opens it', faces.silentMouth < 0.05 && faces.loudMouth > 0.8, JSON.stringify({ silent: faces.silentMouth, loud: faces.loudMouth }));

  // ---- 4. Fallbacks: no WebGL, lost GPU context, no canvas at all
  const fallbacks = await page.evaluate(async () => {
    const { createCompanion } = await import('/voice/avatar/index.js');
    const out = {};
    const mk = (opts) => { const host = document.createElement('div'); document.body.append(host); const a = createCompanion(host, opts); return { a, host }; };
    // (a) forced lite, and it still reacts to level
    { const { a, host } = mk({ prefer: 'lite' }); a.pause(); const W = a.canvas.width; const H = a.canvas.height;
      const frame = (level) => { a.setMood('speaking'); a.model.setReducedMotion(false); a.model.settle(); for (let i = 0; i < 80; i += 1) { a.setLevel(level); a.model.step(16); } return a.snapshot(); };
      const q = frame(0); const l = frame(0.2); let diff = 0; for (let i = 0; i < q.length; i += 4) if (Math.abs(q[i] - l[i]) + Math.abs(q[i + 1] - l[i + 1]) > 40) diff += 1;
      let drawn = 0; for (let i = 3; i < q.length; i += 4) if (q[i] > 0) drawn += 1;
      out.lite = { renderer: a.renderer, diff, drawn, total: W * H }; a.destroy(); host.remove(); }
    // (b) WebGL refused by the browser: falls back by itself
    { const real = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl' || type === 'experimental-webgl' ? null : real.call(this, type, ...rest); };
      const { a, host } = mk({}); out.noWebgl = { renderer: a.renderer }; a.setMood('listening'); a.setLevel(0.1); a.renderOnce(); a.destroy(); host.remove(); HTMLCanvasElement.prototype.getContext = real; }
    // (c) no canvas context of any kind: nothing throws, the API still answers
    { const real = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = () => null; let threw = false; let renderer = '';
      try { const { a, host } = mk({}); renderer = a.renderer; a.play(); a.setMood('speaking'); a.setLevel(0.2); a.renderOnce(); a.snapshot(); a.getStats(); a.pause(); a.destroy(); host.remove(); } catch { threw = true; }
      HTMLCanvasElement.prototype.getContext = real; out.nothing = { renderer, threw }; }
    // (d) the GPU context is lost while running: the same object keeps working on the lite renderer
    { const { a, host } = mk({}); const first = a.renderer; a.play(); a.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      out.lost = { first, after: a.renderer, hasCanvas: Boolean(a.canvas), canvases: host.querySelectorAll('canvas').length }; a.setMood('speaking'); a.setLevel(0.1); a.renderOnce(); a.destroy(); host.remove(); }
    return out;
  });
  check('lite renderer draws a character and its mouth follows the assistant level', fallbacks.lite.renderer === 'lite' && fallbacks.lite.drawn > fallbacks.lite.total * 0.15 && fallbacks.lite.diff > 80, JSON.stringify(fallbacks.lite));
  check('when the browser refuses WebGL the companion falls back to the lite renderer by itself', fallbacks.noWebgl.renderer === 'lite', JSON.stringify(fallbacks.noWebgl));
  check('with no canvas support at all nothing throws and the API still answers (renderer "none")', fallbacks.nothing.threw === false && fallbacks.nothing.renderer === 'none', JSON.stringify(fallbacks.nothing));
  check('a lost GPU context switches to lite on the same object, with exactly one canvas left', fallbacks.lost.first === 'webgl' && fallbacks.lost.after === 'lite' && fallbacks.lost.canvases === 1, JSON.stringify(fallbacks.lost));
  page = await open({ query: 'mockvoice=fast&avatar=lite' }); await begin(page); await launch(page); await talk(page); await page.waitForTimeout(500);
  check('?avatar=lite runs the whole call experience on the lite renderer', (await page.locator('.avatar-dock').getAttribute('data-renderer')) === 'lite');

  // ---- 5. The performance governor steps down on a slow device (fake clock and frame callback, no real waiting)
  const governor = await page.evaluate(async () => {
    const { createWebglAvatar } = await import('/voice/avatar/webgl.js');
    const canvas = document.createElement('canvas'); canvas.width = 220; canvas.height = 260; document.body.append(canvas);
    let t = 0; let pending = null; const events = [];
    const a = createWebglAvatar(canvas, { now: () => t, raf: (fn) => { pending = fn; return 1; }, caf: () => { pending = null; }, onFallback: (e) => events.push(e), doc: { hidden: false } });
    a.play();
    const frames = (gap, count) => { for (let i = 0; i < count; i += 1) { t += gap; const fn = pending; pending = null; if (!fn) break; fn(t); } };
    frames(33, 80); const healthy = a.getStats().tier;     // a good phone: 30 fps, stays on the full tier
    frames(70, 80); const slow = a.getStats().tier;         // ~14 fps: drops to the reduced tier
    frames(130, 80); const verySlow = a.getStats().tier;    // ~7 fps: stops animating and shows still frames
    const renders = a.getStats().renders; frames(130, 20); const stoppedRendering = a.getStats().renders === renders && !a.getStats().running;
    a.destroy(); canvas.remove();
    return { healthy, slow, verySlow, events: events.map((e) => e.tier), stoppedRendering };
  });
  check('a healthy device stays on the full tier', governor.healthy === 'full', JSON.stringify(governor));
  check('a slow device steps down to 20 fps with the small mesh', governor.slow === 'reduced', JSON.stringify(governor));
  check('a very slow device stops animating and shows still frames, and stops rendering', governor.verySlow === 'still' && governor.stoppedRendering, JSON.stringify(governor));
  check('each step down is reported', governor.events.join() === 'reduced,still', JSON.stringify(governor.events));

  // ---- 6. Reduced motion stops all rendering work, not just the picture
  page = await open({ reducedMotion: true }); await begin(page); await launch(page); await talk(page); await page.waitForTimeout(1500);
  const rm = await page.evaluate(() => ({ attr: document.documentElement.dataset.voiceState }));
  check('reduced motion: the dock is active and showing a still face', rm.attr !== 'idle' && (await rect(page, '.avatar-dock')).visible);
  const frames1 = await page.evaluate(async () => { const { createAvatarDock } = await import('/voice/avatar-dock.js'); const { createCompanion } = await import('/voice/avatar/index.js'); const d = createAvatarDock({ createCompanion }); d.setActive(true); d.setState({ uiState: 'listening', muted: false }); const r1 = d.getStats().renders; await new Promise((r) => setTimeout(r, 1200)); const s = d.getStats(); d.destroy(); return { moved: s.renders - r1, running: s.running, reduced: s.reducedMotion }; });
  check('reduced motion: zero frames are drawn over 1.2 seconds and the loop is not running', frames1.moved === 0 && frames1.running === false && frames1.reduced === true, JSON.stringify(frames1));
  page = await open(); await begin(page); await launch(page); await talk(page); await page.waitForTimeout(600);
  const animated = await page.evaluate(async () => { const { createAvatarDock } = await import('/voice/avatar-dock.js'); const { createCompanion } = await import('/voice/avatar/index.js'); const d = createAvatarDock({ createCompanion }); d.setActive(true); d.setState({ uiState: 'listening', muted: false }); const r1 = d.getStats().renders; await new Promise((r) => setTimeout(r, 1200)); const s = d.getStats(); d.destroy(); return { moved: s.renders - r1, running: s.running }; });
  check('with motion allowed it draws about 30 frames a second, not more than 40', animated.moved >= 15 && animated.moved <= 48 && animated.running === true, JSON.stringify(animated));

  // ---- 7. The state contract for the rest of the app
  page = await open({ query: 'mockvoice=fast' });
  await page.addInitScript(() => {}); await begin(page); await launch(page);
  await page.evaluate(() => { window.__voiceEvents = []; document.addEventListener('mgadi:voice-state', (e) => window.__voiceEvents.push(e.detail)); });
  await talk(page); await page.waitForSelector('.msg-assistant'); await page.waitForSelector('.msg-user'); await steady(page);
  await page.click('.vp-controls button:has-text("Mute")'); await page.waitForTimeout(300); await page.click('.vp-controls button:has-text("Unmute")');
  await page.click('.vp-controls button:has-text("End call")'); await page.waitForSelector('.vp-status:has-text("ended")');
  const events = await page.evaluate(() => window.__voiceEvents);
  const seq = events.map((e) => e.uiState).filter((s, i, a) => a[i - 1] !== s);
  check('mgadi:voice-state fires on every change with a uiState that is one of the nine', events.length >= 4 && events.every((e) => ['idle', 'connecting', 'listening', 'thinking', 'speaking', 'muted', 'reconnecting', 'failed', 'ended'].includes(e.uiState)), JSON.stringify(seq));
  check('the events cover connecting, a live state, muted and ended in a sensible order', seq[0] === 'connecting' && seq.includes('muted') && seq.at(-1) === 'ended', JSON.stringify(seq));
  check('html[data-voice-state] ends as "ended" and the event carries no transcript text', (await page.evaluate(() => document.documentElement.dataset.voiceState)) === 'ended' && !JSON.stringify(events).includes('supplier'));

  // ---- 8. Layout at every required size: floating avatar clear of the controls, emergency buttons usable, transcript readable
  const sizes = [[320, 568], [360, 740], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800]];
  for (const [w, h] of sizes) {
    page = await open({ width: w, height: h }); await begin(page); await launch(page);
    if (w <= 430) await shot(page, `${w}x${h}-1-idle`);
    await page.check('#voice-consent-check'); await page.click('.vp-start');
    if (w === 390) { await page.waitForSelector('.vp-status:has-text("Connecting")', { timeout: 3000 }).then(() => shot(page, `${w}x${h}-2-connecting`)).catch(() => {}); }
    await page.waitForSelector('.vp-status:has-text("Connected")'); await page.waitForSelector('.msg-user', { timeout: 15_000 });
    await page.waitForTimeout(500);
    const av = await rect(page, '.avatar-dock'); const all = await controls(page);
    check(`${w}x${h}: the avatar floats inside the screen and overlaps no control, bank button or the conversation header`, av.visible && av.x >= 0 && av.y >= 0 && av.x + av.w <= w && av.y + av.h <= h && all.filter((c) => c.n !== 'vp-status').every((c) => !hit(av, c)), JSON.stringify({ av, all: all.filter((c) => hit(av, c)) }));
    const chat = all.find((c) => c.n === 'vp-chat'); const need = h <= 640 ? 100 : 150;
    check(`${w}x${h}: the visible conversation is at least ${need} px tall and the page does not scroll sideways`, chat.h >= need && !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), JSON.stringify(chat));
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.vp-controls button, .vp-btnrow button, .vp-status, .vp-activity, .vp-mic')].filter((b) => !b.closest('[hidden]') && b.offsetWidth > 0 && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()));
    check(`${w}x${h}: no button or status text is clipped`, clipped.length === 0, JSON.stringify(clipped));
    const bank = await page.evaluate(() => [...document.querySelectorAll('.vp-bank')].map((b) => { const r = b.getBoundingClientRect(); return { name: b.textContent.trim(), w: r.width, h: r.height, tab: b.tabIndex }; }));
    check(`${w}x${h}: the workspace Bank fraud line button are on screen, named, keyboard reachable and at least 44 px tall`, bank.length === 1 && bank.every((b) => b.name === 'Bank fraud line' && b.h >= 44 && b.tab >= 0), JSON.stringify(bank));
    let clickable = true; for (const sel of ['.vp-bank', '.vp-controls button:has-text("Mute")', '.vp-controls button:has-text("End call")', '.vp-controls button:has-text("Use text guidance")']) { try { await page.click(sel, { trial: true, timeout: 2500 }); } catch { clickable = false; } }
    check(`${w}x${h}: nothing covers either bank button, Mute, End call or Use text guidance (real click actionability)`, clickable);
    if (w === 390 || w === 320) { await shot(page, `${w}x${h}-3-listening-or-speaking`); await page.click('.avatar-btn[aria-label*="larger"]'); await page.waitForTimeout(350); await shot(page, `${w}x${h}-4-expanded`);
      const ex = await rect(page, '.avatar-dock'); const ec = await controls(page); check(`${w}x${h}: the expanded avatar still overlaps no control or the visible conversation`, ec.filter((c) => c.n !== 'vp-status').every((c) => !hit(ex, c)), JSON.stringify({ ex, hits: ec.filter((c) => hit(ex, c)) }));
      await page.click('.avatar-btn[aria-label*="smaller"]'); await page.click('.vp-controls button:has-text("Mute")'); await page.waitForTimeout(300); await shot(page, `${w}x${h}-5-muted`); }
    if (w === 768) { await shot(page, `${w}x${h}-tablet`); }
    if (w === 1280) { await shot(page, `${w}x${h}-desktop`); }
    check(`${w}x${h}: no page errors and no CSP violations`, page.errors.length === 0 && (await page.evaluate(() => window.__csp)).length === 0, JSON.stringify([page.errors, await page.evaluate(() => window.__csp)]));
  }
  // speaking frame for the screenshots
  page = await open({ width: 390, height: 844 }); await begin(page); await launch(page); await talk(page);
  await page.waitForFunction(() => document.documentElement.dataset.voiceState === 'speaking', null, { timeout: 8000 }).catch(() => {}); await shot(page, '390x844-3b-speaking');
  check('the avatar was captured while speaking', (await page.evaluate(() => document.documentElement.dataset.voiceState)) === 'speaking');
  // thinking: the simulation leaves a real-time pause after the person's turn
  page = await open({ width: 390, height: 844, query: 'mockvoice=' }); await begin(page); await launch(page); await talk(page);
  await page.waitForFunction(() => document.documentElement.dataset.voiceState === 'thinking', null, { timeout: 25_000 }).catch(() => {});
  check('thinking appears after the person finishes a turn and before the assistant answers (inferred from captions)', (await page.evaluate(() => document.documentElement.dataset.voiceState)) === 'thinking');
  await shot(page, '390x844-3c-thinking');
  // connecting and reconnecting, at real speed (the fast simulation connects in 60 ms)
  page = await open({ width: 390, height: 844, query: 'mockvoice=slowconnect' }); await begin(page); await launch(page); await page.check('#voice-consent-check'); await page.click('.vp-start');
  await page.waitForSelector('.vp-status:has-text("Connecting")'); await page.waitForTimeout(300);
  const connecting = await page.evaluate(() => ({ badge: document.querySelector('.avatar-badge').textContent, state: document.documentElement.dataset.voiceState, bank: !document.querySelector('.vp-bank').disabled, avatar: !document.querySelector('.avatar-dock').hidden }));
  await shot(page, '390x844-2-connecting');
  check('connecting: the avatar is visible with a "Connecting" badge and the bank button is already usable', connecting.badge === 'Connecting' && connecting.state === 'connecting' && connecting.bank && connecting.avatar, JSON.stringify(connecting));
  page = await open({ width: 390, height: 844, query: 'mockvoice=drop' }); await begin(page); await launch(page); await talk(page);
  await page.waitForSelector('.vp-status:has-text("Reconnecting")', { timeout: 12_000 }); await page.waitForTimeout(200); await shot(page, '390x844-2b-reconnecting');
  check('reconnecting: state, badge and status all say so, and the conversation so far stays on screen', (await page.locator('.avatar-badge').innerText()) === 'Reconnecting' && (await page.evaluate(() => document.documentElement.dataset.voiceState)) === 'reconnecting' && (await page.locator('.vp-chat .msg').count()) >= 2);
  // error state
  page = await open({ width: 390, height: 844, query: 'mockvoice=fast,fail-mic' }); await begin(page); await launch(page); await page.check('#voice-consent-check'); await page.click('.vp-start'); await page.waitForSelector('.vp-status:has-text("connect")');
  await shot(page, '390x844-6-error');
  check('error: safe, plain message, the avatar is gone, "Try again" and text guidance are offered, bank button still there', (await page.locator('.avatar-dock').isHidden()) && (await page.locator('.vp-avail').innerText()).includes('bank fraud line') && await page.locator('.vp-bank').isVisible() && (await page.evaluate(() => document.documentElement.dataset.voiceState)) === 'failed');

  // ---- 9. On-screen keyboard: the panel lifts above it and the avatar steps aside
  page = await open({ init: () => { const vv = new EventTarget(); Object.assign(vv, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1 }); Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true }); window.__vv = vv; } });
  await begin(page); await launch(page); await talk(page); await page.waitForTimeout(400);
  const before = await rect(page, '.voice-panel'); const avBefore = await rect(page, '.avatar-dock');
  await page.evaluate(() => { window.__vv.height = innerHeight - 300; window.__vv.dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(200);
  const after = await rect(page, '.voice-panel'); const avAfter = await rect(page, '.avatar-dock');
  check('keyboard open: html[data-keyboard] is "open" and --kb-inset is 300px', (await page.evaluate(() => [document.documentElement.dataset.keyboard, getComputedStyle(document.documentElement).getPropertyValue('--kb-inset').trim()])).join() === 'open,300px');
  check('keyboard open: the panel lifts so its bottom edge sits above the keyboard', Math.abs((before.y + before.h) - (after.y + after.h) - 300) <= 2 && after.y + after.h <= 844 - 300 + 2, JSON.stringify({ before, after }));
  check('keyboard open: the avatar steps out of the way', avBefore.visible && !avAfter.visible);
  check('keyboard open: the Bank fraud line buttons stay on screen above the keyboard', await page.evaluate(() => [...document.querySelectorAll('.vp-bank')].every((b) => b.getBoundingClientRect().bottom <= innerHeight - 300 + 1)));
  await page.evaluate(() => { window.__vv.height = innerHeight; window.__vv.dispatchEvent(new Event('resize')); }); await page.waitForTimeout(200);
  check('keyboard closed: panel and avatar return', (await rect(page, '.avatar-dock')).visible && Math.abs((await rect(page, '.voice-panel')).y - before.y) <= 2);

  // ---- 10. Hiding and restoring the avatar, and the legal/safety wording
  page = await open(); await begin(page); await launch(page); await talk(page);
  await page.click('.avatar-btn[aria-label*="Hide"]'); check('the avatar can be hidden, and the call carries on', (await page.locator('.avatar-dock').isHidden()) && (await page.locator('.vp-status').innerText()) === 'Connected');
  check('hiding returns the controls\' gutter (nothing reserved for an invisible avatar)', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--avatar-w').trim())) === '0px');
  await page.getByRole('button', { name: 'Show 3D', exact: true }).click(); check('and it can be restored', await page.locator('.avatar-dock').isVisible());
  check('the avatar never claims to sign: no SASL wording except the disclaimer', !/sign(ing)? language|SASL/.test((await page.locator('.avatar-dock').innerText()).replace(/Visual companion, not a sign language translator/, '')));
  const touch = await page.evaluate(() => [...document.querySelectorAll('.avatar-btn')].map((b) => { const r = b.getBoundingClientRect(); const after = getComputedStyle(b, '::after'); return { w: r.width + 14, h: r.height + 14, inset: after.top }; }));
  check('the small avatar buttons have a 44 px touch area (30 px button plus a 7 px pad on each side)', touch.every((t) => t.w >= 44 && t.h >= 44 && t.inset === '-7px'), JSON.stringify(touch));
} finally { await browser.close(); app.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} avatar and layout browser checks passed.`);
process.exit(failed.length ? 1 : 0);
