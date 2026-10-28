import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPoseModel, mouthFromLevel, approach, mulberry32, MOODS, LEVEL_GATE } from '../public/voice/avatar/pose.js';

const same = (a, b, message) => { for (const key of Object.keys(a)) assert.ok(Math.abs(a[key] - b[key]) < 1e-6, `${message}: ${key} ${a[key]} -> ${b[key]}`); };
const run = (model, ms, step = 16, level = null) => { for (let t = 0; t < ms; t += step) { if (level !== null) model.setLevel(level); model.step(step); } return model.pose; };

test('moods: exactly idle, listening, thinking, speaking, muted; anything else becomes idle', () => {
  assert.deepEqual([...MOODS], ['idle', 'listening', 'thinking', 'speaking', 'muted']);
  const m = createPoseModel(); m.setMood('dancing'); assert.equal(m.mood, 'idle'); m.setMood('speaking'); assert.equal(m.mood, 'speaking');
});

test('state transitions move the face smoothly to a distinct pose for each state', () => {
  const m = createPoseModel({ seed: 3 });
  const poses = {};
  for (const mood of ['idle', 'listening', 'thinking', 'muted']) { m.setMood(mood); run(m, 2500); poses[mood] = { ...m.pose }; }
  assert.ok(poses.listening.lean > poses.idle.lean + 0.3, 'listening leans in');
  assert.ok(poses.listening.browL > poses.idle.browL + 0.15, 'listening raises the brows a little');
  assert.ok(poses.thinking.gazeX < -0.3 && poses.thinking.gazeY > 0.3, 'thinking glances up and away');
  assert.ok(poses.thinking.browL - poses.thinking.browR > 0.3, 'thinking raises one brow');
  assert.ok(poses.muted.gazeY < poses.idle.gazeY && poses.muted.eyeOpen < 0.9 || poses.muted.eyeOpen < 1, 'muted looks slightly away and lowered');
  assert.ok(Math.abs(poses.muted.lean) < 0.05, 'muted does not lean in as if listening');
  // smooth, not a jump: one 16 ms frame after a change moves only a fraction of the way
  const j = createPoseModel({ seed: 3 }); j.setMood('listening'); j.step(16);
  assert.ok(j.pose.lean > 0 && j.pose.lean < 0.1, `one frame moved lean to ${j.pose.lean}`);
});

test('the mouth follows the loudness of the assistant: closed when silent, wider when louder, never below the gate', () => {
  assert.equal(mouthFromLevel(0), 0); assert.equal(mouthFromLevel(0.01), 0, 'line noise below the gate (0.012) does not move the mouth'); assert.equal(LEVEL_GATE, 0.012);
  const quiet = mouthFromLevel(0.03); const mid = mouthFromLevel(0.08); const loud = mouthFromLevel(0.2);
  assert.ok(quiet > 0 && quiet < mid && mid < loud && loud === 1, JSON.stringify({ quiet, mid, loud }));
  assert.equal(mouthFromLevel(NaN), 0); assert.equal(mouthFromLevel(-1), 0); assert.equal(mouthFromLevel(99), 1);

  const m = createPoseModel({ seed: 1 }); m.setMood('speaking');
  run(m, 800, 16, 0.2); const open = m.pose.mouth;
  run(m, 800, 16, 0.0); const closed = m.pose.mouth;
  assert.ok(open > 0.8 && closed < 0.1, `open ${open}, closed ${closed}`);
  run(m, 800, 16, 0.06); const middle = m.pose.mouth;
  assert.ok(middle > closed && middle < open, `a quieter voice opens the mouth less (${middle})`);
});

test('the mouth closes when the audio goes quiet even if the last level was loud (stale levels do not keep it open)', () => {
  const m = createPoseModel({ seed: 2 }); m.setMood('speaking');
  m.setLevel(0.2); run(m, 300);
  assert.ok(m.pose.mouth > 0.5);
  run(m, 900); // no new level arrives
  assert.ok(m.pose.mouth < 0.1, `mouth still ${m.pose.mouth}`);
});

test('levels are ignored unless the state is speaking: a level never opens the mouth while listening, thinking or muted', () => {
  for (const mood of ['idle', 'listening', 'thinking', 'muted']) {
    const m = createPoseModel({ seed: 5 }); m.setMood(mood); run(m, 1500, 16, 0.3);
    assert.ok(m.pose.mouth < 0.1, `${mood}: mouth ${m.pose.mouth}`);
  }
});

test('with no audio levels at all, speaking uses only a clearly approximate flap, and only when asked to', () => {
  const none = createPoseModel({ seed: 4 }); none.setMood('speaking'); run(none, 1500);
  assert.ok(none.pose.mouth < 0.05, 'no level and no approximation flag: the mouth stays closed rather than invent movement');
  const flap = createPoseModel({ seed: 4 }); flap.setMood('speaking'); flap.setApproximate(true);
  const values = []; for (let i = 0; i < 100; i += 1) { flap.step(16); values.push(flap.pose.mouth); }
  assert.ok(Math.max(...values) > 0.25 && Math.max(...values) - Math.min(...values) > 0.15, 'it does move');
  flap.setLevel(0); for (let i = 0; i < 60; i += 1) flap.step(16);
  assert.ok(flap.pose.mouth < 0.05, 'real audio levels take over from the approximation as soon as they exist');
});

test('blinking: roughly every 2 to 6 seconds, each blink short and complete, never frozen shut', () => {
  const m = createPoseModel({ seed: 11 }); m.setMood('idle');
  let blinks = 0; let closed = false; let minOpen = 1; let longest = 0; let current = 0;
  for (let t = 0; t < 60_000; t += 16) {
    m.step(16); const open = m.pose.eyeOpen; minOpen = Math.min(minOpen, open);
    if (open < 0.5) { current += 16; if (!closed) { blinks += 1; closed = true; } } else { longest = Math.max(longest, current); current = 0; closed = false; }
  }
  assert.ok(blinks >= 8 && blinks <= 30, `${blinks} blinks in a minute`);
  assert.ok(minOpen < 0.1, 'the eyes really close');
  assert.ok(longest <= 160, `the longest closure was ${longest} ms`);
});

test('head movement and breathing are small, and never exceed natural limits', () => {
  const m = createPoseModel({ seed: 9 }); m.setMood('speaking');
  let maxYaw = 0; let maxPitch = 0; let maxRoll = 0; let breathLow = 1; let breathHigh = -1;
  for (let t = 0; t < 120_000; t += 16) { m.setLevel(0.1); m.step(16); const p = m.pose; maxYaw = Math.max(maxYaw, Math.abs(p.yaw)); maxPitch = Math.max(maxPitch, Math.abs(p.pitch)); maxRoll = Math.max(maxRoll, Math.abs(p.roll)); breathLow = Math.min(breathLow, p.breath); breathHigh = Math.max(breathHigh, p.breath); }
  assert.ok(maxYaw < 0.09 && maxPitch < 0.12 && maxRoll < 0.1, JSON.stringify({ maxYaw, maxPitch, maxRoll }));
  assert.ok(maxYaw > 0.01, 'there is some head movement');
  assert.ok(breathLow < -0.9 && breathHigh > 0.9, 'breathing cycles');
});

test('animation is not a short repeating loop: two minutes of idle never repeat a pose exactly', () => {
  const m = createPoseModel({ seed: 21 }); const seen = new Set();
  for (let t = 0; t < 120_000; t += 250) { m.step(250); seen.add(`${m.pose.yaw.toFixed(4)}|${m.pose.pitch.toFixed(4)}`); }
  assert.ok(seen.size > 470, `${seen.size} distinct of 480`);
});

test('the same seed gives the same animation (so tests and screenshots are repeatable) and different seeds differ', () => {
  const a = createPoseModel({ seed: 1 }); const b = createPoseModel({ seed: 1 }); const c = createPoseModel({ seed: 2 });
  const trace = (m) => { const out = []; for (let i = 0; i < 400; i += 1) { m.step(16); out.push(m.pose.eyeOpen.toFixed(3) + m.pose.gazeX.toFixed(3)); } return out.join(); };
  assert.equal(trace(a), trace(b)); assert.notEqual(trace(a), trace(c));
  assert.equal(mulberry32(5)(), mulberry32(5)());
});

test('reduced motion: the face changes with the state but nothing moves on its own', () => {
  const m = createPoseModel({ seed: 6, reducedMotion: true });
  m.setMood('listening'); run(m, 3000);
  run(m, 8000); const first = { ...m.pose };
  run(m, 20_000); // twenty more seconds
  for (const key of Object.keys(first)) assert.ok(Math.abs(m.pose[key] - first[key]) < 1e-6, `${key} moved by itself: ${first[key]} -> ${m.pose[key]}`);
  assert.equal(m.pose.yaw, 0); assert.equal(m.pose.breath, 0); assert.equal(m.pose.eyeOpen, 1);
  m.setMood('speaking'); run(m, 6000, 16, 0.2);
  const speaking1 = { ...m.pose }; run(m, 6000, 16, 0.01);
  same(speaking1, m.pose, 'a still, half-open mouth for speaking: it does not flap with the loudness');
  assert.ok(m.pose.mouth > 0.2 && m.pose.mouth < 0.5);
  m.setMood('idle'); run(m, 2000);
  assert.ok(m.pose.mouth < 0.05, 'and it closes when speaking stops');
});

test('toggling reduced motion at run time takes effect immediately', () => {
  const m = createPoseModel({ seed: 8 }); m.setMood('idle'); run(m, 5000);
  m.setReducedMotion(true); m.settle(); const still = { ...m.pose }; run(m, 10_000); assert.deepEqual({ ...m.pose }, still);
  m.setReducedMotion(false); run(m, 10_000); assert.notDeepEqual({ ...m.pose }, still);
});

test('approach() is frame-rate independent', () => {
  const slow = (() => { let v = 0; for (let i = 0; i < 10; i += 1) v = approach(v, 1, 100, 200); return v; })();
  const fast = (() => { let v = 0; for (let i = 0; i < 100; i += 1) v = approach(v, 1, 10, 200); return v; })();
  assert.ok(Math.abs(slow - fast) < 1e-9, `${slow} vs ${fast}`);
  assert.equal(approach(0, 1, 0, 100), 0); assert.equal(approach(5, 5, 100, 100), 5);
});

test('BOUNDARY: only assistant audio may drive the mouth. The avatar modules take no microphone input, and the SDK analyser listens to the remote track only', () => {
  // 1. Nothing in the avatar code can open a microphone or analyse local audio.
  for (const file of ['pose.js', 'webgl.js', 'lite.js', 'index.js']) {
    const source = fs.readFileSync(new URL(`../public/voice/avatar/${file}`, import.meta.url), 'utf8');
    assert.ok(!/getUserMedia|AudioContext|createMediaStreamSource|MediaRecorder|createAnalyser/.test(source), `${file} must not touch audio capture or analysis`);
  }
  // 2. The only audio analyser the Retell SDK creates is attached to the REMOTE track (assistant), never to the local microphone stream.
  const sdkPath = new URL('../node_modules/retell-client-js-sdk/src/gateway-transport.ts', import.meta.url);
  if (!fs.existsSync(sdkPath)) assert.fail('the Retell SDK source is not installed, so the audio-source guarantee cannot be checked (run npm ci)');
  const sdk = fs.readFileSync(sdkPath, 'utf8');
  const calls = [...sdk.matchAll(/=\s*createGatewayAnalyser\(([^)]*)\)/g)].map((x) => x[1]);
  assert.deepEqual(calls, ['track'], 'exactly one analyser is created');
  const attachRemote = sdk.slice(sdk.indexOf('private attachRemote'));
  assert.ok(attachRemote.includes('createGatewayAnalyser(track)') && sdk.includes('pc.ontrack') && sdk.includes('this.attachRemote(stream, ev.track)'), 'and it is created from the remote track handed to ontrack');
  assert.ok(!/localStream[^;]*createGatewayAnalyser|createGatewayAnalyser\([^)]*localStream/.test(sdk), 'never from the local stream');
});

test('weak devices start on the lite renderer; ordinary ones do not', async () => {
  const { isLowEndDevice } = await import('../public/voice/avatar/index.js');
  assert.equal(isLowEndDevice({ hardwareConcurrency: 2 }), true);
  assert.equal(isLowEndDevice({ hardwareConcurrency: 8, deviceMemory: 2 }), true);
  assert.equal(isLowEndDevice({ hardwareConcurrency: 8, deviceMemory: 1 }), true);
  assert.equal(isLowEndDevice({ hardwareConcurrency: 8, deviceMemory: 4 }), false);
  assert.equal(isLowEndDevice({ hardwareConcurrency: 4 }), false, 'memory unknown: the core count decides');
  assert.equal(isLowEndDevice({}), false); assert.equal(isLowEndDevice(undefined), false); assert.equal(isLowEndDevice({ hardwareConcurrency: 0, deviceMemory: NaN }), false);
});
