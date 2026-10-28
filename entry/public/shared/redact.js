// Runs in the browser before a request and again on the server as defence in depth.
export const MAX_INCIDENT_CHARS = 2000;

const patterns = [
  ['LINK', /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi],
  ['EMAIL', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
  ['AMOUNT', /\bR\s?\d+(?:[\s,.]\d{3})*(?:[,.]\d{1,2})?(?:\s?(?:k|m|million|thousand))?\b/gi],
  ['AMOUNT', /\b\d+(?:[.,]\d+)?\s?k\b/gi],
  ['PHONE', /(?:\+27|\b0)(?:[\s-]?\d){9}\b/g],
  ['NUMBER', /\b\d(?:[\s-]?\d){5,}\b/g],
];

// A secret typed right after its own name: "my PIN is 5521", "password: hunter2", "OTP 48 21". The NAME stays (guidance and the
// rules still need to see that a PIN was asked for) and only the value is hidden. The value must contain a digit, so ordinary
// sentences such as "he asked for my PIN and password" are untouched. It runs after the patterns above, so anything they
// already hid keeps the exact same output. Like all hiding in Mgadi it is pattern based and can miss a secret written another way.
const secretAfterName = /\b((?:otp|pin|verification|security|login|sms|one-time)\s+code|pin|otp|cvv|cvc|passcode|password|passwd|pwd)\b(\s*(?:is|was|=|:|-)\s*|\s+)(?=[^\s,;]*\d)[^\s,;]+/gi;

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactIncident(value, names = []) {
  let text = String(value ?? '').slice(0, MAX_INCIDENT_CHARS);
  text = text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  const counts = {};
  for (const [tag, expression] of patterns) {
    text = text.replace(expression, () => {
      counts[tag] = (counts[tag] ?? 0) + 1;
      return `[${tag}]`;
    });
  }
  text = text.replace(secretAfterName, (match, name, joiner) => {
    counts.SECRET = (counts.SECRET ?? 0) + 1;
    return `${name}${joiner}[SECRET]${match.match(/[.!?)]+$/)?.[0] ?? ''}`; // keep the sentence's own full stop
  });
  for (const rawName of names) {
    const name = String(rawName).trim();
    if (name.length < 2) continue;
    const expression = new RegExp(`(?<![\\p{L}\\p{N}])${escaped(name)}(?![\\p{L}\\p{N}])`, 'giu');
    text = text.replace(expression, () => {
      counts.NAME = (counts.NAME ?? 0) + 1;
      return '[NAME]';
    });
  }
  return { text, counts };
}
