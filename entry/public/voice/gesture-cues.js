// Illustrative keyword-to-motion cues, NEVER SASL translation or safety instructions.
// Local matching only; no transcripts are transmitted, stored or logged by this module.
export const GESTURE_CUES = Object.freeze([
  { key: 'stop', label: 'STOP', examples: 'stop, wait, pause', pattern: /\b(?:stop|pause|wait|freeze|hold on|cancel(?: the)? payment|do not pay|don't pay)\b/gi },
  { key: 'call', label: 'CALL', examples: 'call, phone, dial', pattern: /\b(?:call|calling|called|phone|telephone|dial|ring|fraud line|contact the bank|contact my bank)\b/gi },
  { key: 'save', label: 'KEEP', examples: 'save, keep, evidence', pattern: /\b(?:save|keep|preserve|evidence|screenshot|receipt|invoice|proof of payment|document(?:s|ation)?)\b/gi },
  { key: 'help', label: 'HELP', examples: 'help, support, urgent', pattern: /\b(?:help|assist(?:ance)?|support|emergency|urgent)\b/gi },
  { key: 'check', label: 'CHECK', examples: 'check, verify, confirm', pattern: /\b(?:check|verify|verification|confirm|validate|double.check|bank details)\b/gi },
  { key: 'protect', label: 'PROTECT', examples: 'protect, safe, secure', pattern: /\b(?:protect|protection|secure|security|privacy|safe|password|otp|pin)\b/gi },
]);

// Pick the most recently spoken recognized keyword in a streaming caption.
// Bound the scan even if a provider sends unusually long text.
export function recognizeGesture(text) {
  const input = String(text ?? '').slice(-4000);
  let best = null;
  for (const cue of GESTURE_CUES) {
    cue.pattern.lastIndex = 0;
    for (const match of input.matchAll(cue.pattern)) {
      if (!best || match.index > best.offset) best = { key: cue.key, label: cue.label, offset: match.index, word: match[0] };
    }
  }
  return best;
}

// Stable signature prevents reanimating every time a streaming transcript adds a word.
// The message id is provided by the caller and never leaves the browser.
export function cueSignature(messageKey, match) {
  return match ? `${String(messageKey)}:${match.offset}:${match.key}` : null;
}
