// Animation model for the Mgadi voice companion. Pure functions and no DOM, so it is unit tested in Node.
//
// What drives it (and what must never drive it):
//   mood   one of idle | listening | thinking | speaking | muted. Set from the real voice state.
//   level  the loudness (0..~0.3) of the ASSISTANT's audio. Only audio coming from the assistant may be passed to
//          setLevel(). The user's microphone must never reach this module: the mouth moves for what Mgadi says.
//   Retell supplies no phoneme or viseme data (checked against the current SDK and docs, 28 Oct 2026). The mouth therefore
//   follows loudness. That is APPROXIMATE lip movement, not phoneme-level lip-sync, and nothing may claim otherwise.
//
// "thinking" is an inference made by the voice controller (the person finished a turn and nothing has come back yet).
// It is not a provider signal.

export const MOODS = Object.freeze(['idle', 'listening', 'thinking', 'speaking', 'muted']);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Frame-rate independent exponential approach: tau is the time constant in milliseconds.
export const approach = (current, target, dtMs, tauMs) => current + (target - current) * (1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, tauMs)));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Loudness of the assistant's audio -> how far the mouth opens (0 closed .. 1 wide). A small gate ignores line noise.
export const LEVEL_GATE = 0.012;
export const LEVEL_FULL = 0.18;
export const mouthFromLevel = (level) => {
  const value = Number(level);
  if (!Number.isFinite(value)) return 0; // a broken value must never open the mouth
  return Math.pow(clamp((value - LEVEL_GATE) / (LEVEL_FULL - LEVEL_GATE), 0, 1), 0.62);
};

// The resting target of every pose value, per mood. Values are in these units:
//   yaw/pitch/roll radians; lean 0..1; brow -1..1; gaze -1..1; smile 0..1; eyeOpen 0..1; mouth 0..1
const TARGETS = {
  idle:      { roll: 0,     pitch: 0,     lean: 0,   browL: 0,    browR: 0,     gazeX: 0,    gazeY: 0,    smile: 0.38, eyeOpen: 1,    mouth: 0 },
  listening: { roll: 0.055, pitch: -0.02, lean: 0.55, browL: 0.28, browR: 0.28,  gazeX: 0,    gazeY: 0.02, smile: 0.30, eyeOpen: 1,    mouth: 0 },
  thinking:  { roll: -0.06, pitch: 0.035, lean: 0.1, browL: 0.42, browR: -0.05, gazeX: -0.5, gazeY: 0.45, smile: 0.06, eyeOpen: 0.95, mouth: 0.05 },
  speaking:  { roll: 0,     pitch: 0,     lean: 0.15, browL: 0.1,  browR: 0.1,   gazeX: 0,    gazeY: 0,    smile: 0.34, eyeOpen: 1,    mouth: 0 },
  // Muted: Mgadi cannot hear the person. A calm, slightly lowered, non-attentive pose, plus a visible mic-off badge drawn by the dock.
  muted:     { roll: 0,     pitch: 0.03,  lean: 0,   browL: -0.05, browR: -0.05, gazeX: 0,    gazeY: -0.2, smile: 0.2,  eyeOpen: 0.82, mouth: 0 },
};
const TAU = { roll: 320, pitch: 260, lean: 380, browL: 160, browR: 160, gazeX: 120, gazeY: 120, smile: 280, eyeOpen: 90 };
const LEVEL_STALE_MS = 260;

export function createPoseModel({ seed = 7, reducedMotion = false } = {}) {
  const rand = mulberry32(seed);
  let mood = 'idle'; let reduced = reducedMotion;
  let level = 0; let levelAt = -Infinity; let levelsSeen = false; let approximate = false;
  let t = 0;
  let nextBlink = 1800 + rand() * 2500; let blinkStart = -1; let blinkLen = 150; let pendingDouble = false;
  let nextSaccade = 1500 + rand() * 2000; let saccade = { x: 0, y: 0 };
  let nextNod = 3200 + rand() * 2600; let nodStart = -1;
  const pose = { yaw: 0, pitch: 0, roll: 0, lean: 0, breath: 0, browL: 0, browR: 0, gazeX: 0, gazeY: 0, smile: TARGETS.idle.smile, eyeOpen: 1, mouth: 0 };
  // The pose before any idle drift, blinking or loudness is applied: the smoothed "intent" of the current mood.
  const base = { ...pose };

  const blinkAmount = () => {
    if (blinkStart < 0) return 0;
    const p = (t - blinkStart) / blinkLen;
    if (p >= 1) return 0;
    const ease = (x) => x * x * (3 - 2 * x);
    return p < 0.4 ? ease(p / 0.4) : 1 - ease((p - 0.4) / 0.6);
  };

  function step(dtMs) {
    const dt = clamp(Number(dtMs) || 0, 0, 100);
    t += dt;
    const target = TARGETS[mood];
    for (const key of Object.keys(TAU)) base[key] = approach(base[key], target[key], dt, TAU[key]);

    if (reduced) {
      // Reduced motion: the face changes with the state but nothing moves on its own. No drift, blink, breathing or lip flap.
      Object.assign(pose, base, { yaw: 0, breath: 0, mouth: mood === 'speaking' ? 0.34 : target.mouth });
      return pose;
    }

    // Slow, non-repeating drift: two sines with unrelated periods. Speaking adds a little more life.
    const live = mood === 'speaking' ? 1 : 0.6;
    const yaw = (0.035 * Math.sin(t * 0.00041) + 0.018 * Math.sin(t * 0.00113 + 1.3)) * live;
    const pitchDrift = (0.018 * Math.sin(t * 0.00053 + 0.4) + 0.01 * Math.sin(t * 0.00127)) * live;

    if (t >= nextSaccade) { saccade = { x: (rand() - 0.5) * 0.24, y: (rand() - 0.5) * 0.14 }; nextSaccade = t + 1400 + rand() * 2800; }
    if (mood === 'listening' && t >= nextNod) { nodStart = t; nextNod = t + 3400 + rand() * 2800; }
    const nodP = nodStart >= 0 ? (t - nodStart) / 620 : 1;
    const nod = nodP < 1 ? -0.05 * Math.sin(Math.PI * nodP) : 0;

    if (t >= nextBlink && blinkStart < 0) { blinkStart = t; blinkLen = 130 + rand() * 50; pendingDouble = rand() < 0.14; }
    if (blinkStart >= 0 && t - blinkStart >= blinkLen) {
      blinkStart = -1;
      nextBlink = pendingDouble ? t + 140 : t + 2300 + rand() * 3900;
      pendingDouble = false;
    }

    // Mouth: follows the assistant's audio loudness. If no level has arrived for a moment, the audio is silent: close.
    let mouthTarget = TARGETS[mood].mouth;
    if (mood === 'speaking') {
      const fresh = t - levelAt < LEVEL_STALE_MS;
      if (levelsSeen) mouthTarget = fresh ? mouthFromLevel(level) : 0;
      else if (approximate) mouthTarget = 0.18 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.0265)) * (0.65 + 0.35 * Math.sin(t * 0.0081 + 0.7));
    }
    const rising = mouthTarget > pose.mouth;

    pose.yaw = yaw;
    pose.pitch = base.pitch + pitchDrift + nod;
    pose.roll = base.roll + 0.012 * Math.sin(t * 0.00069 + 2.1);
    pose.lean = base.lean;
    pose.breath = Math.sin((t / 4300) * Math.PI * 2);
    // Eyebrows lift a little on louder syllables, so speech has some emphasis without any gesture.
    const emphasis = mood === 'speaking' ? clamp(pose.mouth, 0, 1) * 0.22 : 0;
    pose.browL = base.browL + emphasis; pose.browR = base.browR + emphasis;
    pose.gazeX = base.gazeX + (mood === 'thinking' ? 0 : saccade.x); pose.gazeY = base.gazeY + (mood === 'thinking' ? 0 : saccade.y);
    pose.smile = base.smile;
    pose.eyeOpen = clamp(base.eyeOpen * (1 - blinkAmount()), 0, 1);
    pose.mouth = approach(pose.mouth, mouthTarget, dt, rising ? 45 : 110);
    return pose;
  }

  return {
    step,
    get pose() { return pose; },
    get mood() { return mood; },
    get levelsSeen() { return levelsSeen; },
    setMood(next) { mood = MOODS.includes(next) ? next : 'idle'; if (mood !== 'listening') nodStart = -1; },
    // `value` must be the loudness of audio coming FROM THE ASSISTANT. Anything else is a bug.
    setLevel(value) { const v = Number(value); if (Number.isFinite(v) && v >= 0) { level = v; levelAt = t; levelsSeen = true; } },
    // Speaking is known (from captions) but no audio loudness is available: a gentle, clearly approximate flap.
    setApproximate(on) { approximate = Boolean(on); },
    setReducedMotion(on) { reduced = Boolean(on); },
    // Jump straight to the target of the current mood (used for a still frame under reduced motion and in tests).
    settle() { const target = TARGETS[mood]; for (const key of Object.keys(TAU)) base[key] = target[key]; step(0); return pose; },
  };
}
