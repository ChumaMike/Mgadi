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
