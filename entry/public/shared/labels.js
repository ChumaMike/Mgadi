// Mgadi's classifier may only return one of these labels. It never writes advice.
export const LABELS = Object.freeze([
  'payment_diversion',
  'mailbox_compromise',
  'suspicious_message',
  'ransomware_suspected',
  'not_cyber',
  'unsure',
]);

export const CONFIDENCE_THRESHOLD = 0.7;

export function validateTriage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'confidence' || keys[1] !== 'label') return null;
  if (!LABELS.includes(value.label)) return null;
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) return null;
  if (value.confidence < 0 || value.confidence > 1) return null;
  return { label: value.label, confidence: Math.round(value.confidence * 100) / 100 };
}

export function routeTriage(result) {
  if (!result || result.label === 'unsure' || result.confidence < CONFIDENCE_THRESHOLD) return 'clarify';
  return result.label;
}
