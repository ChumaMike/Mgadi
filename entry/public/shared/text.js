// One rule for every piece of text a person (or a link someone sent them) can put in front of another person: remove control
// characters and the direction overrides that can make text DISPLAY as something it is not, drop angle brackets, flatten
// whitespace and cut to a length. The result is only ever inserted with textContent.
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function cleanLine(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(UNSAFE, ' ').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
