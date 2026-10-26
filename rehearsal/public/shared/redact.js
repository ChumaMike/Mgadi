// PRACTICE BUILD, NOT THE ENTRY.
// Redaction runs on the phone before anything is sent, and again on the server.
// Order matters: links and emails first (they contain digits and dots), then
// rand amounts, then phone numbers, then any long run of digits.

const RULES = [
  { tag: 'LINK', re: /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi },
  { tag: 'EMAIL', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { tag: 'AMOUNT', re: /\bR ?\d+(?:[.,]\d+)? ?k\b|\bR ?\d{1,3}(?:[  .,]\d{3})+(?:[.,]\d{2})?\b|\bR ?\d+(?:[.,]\d{2})?\b|\b\d+(?:[.,]\d+)? ?k\b/gi },
  { tag: 'PHONE', re: /(?:\+27|\b0)(?:[\s-]?\d){9}\b/g },
  { tag: 'NUMBER', re: /\b\d(?:[\s-]?\d){5,}\b/g },
];

export const MAX_INPUT_CHARS = 2000;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// names: words the owner typed into "names to hide" (supplier, staff, clients).
export function redact(input, { names = [] } = {}) {
  let text = String(input ?? '').slice(0, MAX_INPUT_CHARS);
  // Drop control characters except newline and tab.
  text = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  const counts = {};

  for (const { tag, re } of RULES) {
    text = text.replace(re, () => {
      counts[tag] = (counts[tag] || 0) + 1;
      return `[${tag}]`;
    });
  }

  const cleanNames = names.map((n) => String(n).trim()).filter((n) => n.length >= 2);
  for (const name of cleanNames) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'giu');
    text = text.replace(re, () => {
      counts.NAME = (counts.NAME || 0) + 1;
      return '[NAME]';
    });
  }

  return { text, counts };
}
