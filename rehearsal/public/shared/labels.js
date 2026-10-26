// PRACTICE BUILD, NOT THE ENTRY.
// The fixed list of incident labels. The AI (and the rule-based fallback) may
// only ever return one of these plus a confidence score. Nothing else is shown.

export const LABELS = Object.freeze([
  'payment_diversion',
  'mailbox_compromise',
  'suspicious_message',
  'not_cyber',
  'unsure',
]);

// Below this, Mgadi asks a clarifying question instead of trusting the label.
export const CONFIDENCE_THRESHOLD = 0.7;

// Accepts only {label, confidence} with a known label and 0 <= confidence <= 1.
// Anything else (extra keys, free text, out-of-range numbers) is discarded.
export function validateTriage(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const keys = Object.keys(obj);
  if (keys.length !== 2 || !keys.includes('label') || !keys.includes('confidence')) return null;
  if (!LABELS.includes(obj.label)) return null;
  const c = obj.confidence;
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) return null;
  return { label: obj.label, confidence: Math.round(c * 100) / 100 };
}

// Where the owner goes next: a playbook, or the clarifying question.
export function route(result) {
  if (!result || result.label === 'unsure' || result.confidence < CONFIDENCE_THRESHOLD) return 'clarify';
  return result.label;
}
