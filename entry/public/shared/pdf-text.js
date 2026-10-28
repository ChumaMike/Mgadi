// Local PDF text extraction. Runs in the browser (and in Node for tests); the file never leaves the device.
//
// This is a bounded, best-effort reader, NOT a PDF engine: it handles ordinary text PDFs (plain or Flate-compressed streams,
// simple fonts, and fonts with a ToUnicode map, which is what browsers and most office tools write). It refuses encrypted files,
// scans and image-only pages, and anything over its limits, and says so; the person then types the details instead.
// Everything it returns is UNTRUSTED TEXT. Nothing in a PDF can make the app do anything: the text is only ever displayed
// and searched with fixed patterns.
export const LIMITS = Object.freeze({ fileBytes: 5 * 1024 * 1024, objects: 4000, streams: 400, inflatedBytes: 2 * 1024 * 1024, textChars: 100_000, tokenCount: 400_000 });

const latin1 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return s; };

async function inflateZlib(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('no_inflate');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader(); const chunks = []; let total = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.length; if (total > LIMITS.inflatedBytes) { await reader.cancel(); throw new Error('too_big'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// ---- objects and streams
function parseObjects(raw, bytes) {
  const objects = new Map(); const re = /(\d{1,7})\s+(\d{1,5})\s+obj\b/g; let m; let count = 0;
  while ((m = re.exec(raw))) {
    if (++count > LIMITS.objects) break;
    const bodyStart = m.index + m[0].length; const end = raw.indexOf('endobj', bodyStart); if (end < 0) break;
    const body = raw.slice(bodyStart, end); const s = body.search(/stream\r?\n|stream\r/);
    let dict = body; let data = null;
    if (s >= 0) {
      dict = body.slice(0, s);
      const dataStart = bodyStart + s + body.slice(s).match(/^stream(\r\n|\n|\r)/)[0].length;
      let dataEnd = raw.lastIndexOf('endstream', end); if (dataEnd < dataStart) dataEnd = end;
      while (dataEnd > dataStart && (raw[dataEnd - 1] === '\n' || raw[dataEnd - 1] === '\r')) dataEnd -= 1;
      data = bytes.subarray(dataStart, dataEnd);
    }
    objects.set(Number(m[1]), { dict, data, decoded: undefined });
    re.lastIndex = end + 6;
  }
  return objects;
}

async function decodeStream(object, warnings, budget) {
  if (object.decoded !== undefined) return object.decoded;
  object.decoded = null;
  if (!object.data || budget.streams >= LIMITS.streams) return null;
  budget.streams += 1;
  const dict = object.dict;
  if (/\/Subtype\s*\/Image/.test(dict)) return null;
  const filters = (dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/)?.[1] ?? '').match(/\/\w+/g) ?? [];
  try {
    if (!filters.length) object.decoded = latin1(object.data);
    else if (filters.length === 1 && filters[0] === '/FlateDecode') object.decoded = latin1(await inflateZlib(object.data));
    else return null; // other encodings (LZW, ASCII85, images): not read
  } catch { warnings.add('A part of the file could not be unpacked.'); object.decoded = null; }
  return object.decoded;
}

// ---- ToUnicode maps
const hexToCodes = (hex) => { const c = hex.replace(/\s+/g, ''); const out = []; for (let i = 0; i + 3 < c.length + 1; i += 4) out.push(parseInt(c.slice(i, i + 4), 16)); return out; };
const hexToString = (hex) => { const codes = hexToCodes(hex.length % 4 === 2 ? `00${hex}` : hex); return String.fromCharCode(...codes.filter((c) => Number.isFinite(c))); };

export function parseToUnicode(text) {
  const map = new Map(); let bytes = 1;
  for (const block of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    const first = block[1].match(/<([0-9a-fA-F]+)>/); if (first) bytes = Math.max(1, Math.round(first[1].length / 2));
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(p[1], 16), hexToString(p[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(p[1], 16); const hi = Math.min(parseInt(p[2], 16), lo + 65535);
      if (p[3]) { const start = hexToCodes(p[3].length % 4 === 2 ? `00${p[3]}` : p[3]); for (let c = lo; c <= hi; c += 1) { const codes = [...start]; codes[codes.length - 1] += c - lo; map.set(c, String.fromCharCode(...codes)); } }
      else if (p[4]) { let c = lo; for (const item of p[4].matchAll(/<([0-9a-fA-F]+)>/g)) { if (c > hi) break; map.set(c, hexToString(item[1])); c += 1; } }
    }
  }
  return { map, bytes };
}

// ---- content streams
const ESC = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
function readLiteral(s, i) { // s[i] === '('
  let depth = 1; let out = ''; i += 1;
  while (i < s.length && depth > 0) {
    const ch = s[i];
    if (ch === '\\') {
      const n = s[i + 1];
      if (/[0-7]/.test(n)) { const oct = s.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0]; out += String.fromCharCode(parseInt(oct, 8) & 255); i += 1 + oct.length; continue; }
      if (n === '\r' || n === '\n') { i += n === '\r' && s[i + 2] === '\n' ? 3 : 2; continue; }
      out += ESC[n] ?? n; i += 2; continue;
    }
    if (ch === '(') depth += 1; else if (ch === ')') { depth -= 1; if (!depth) { i += 1; break; } }
    out += ch; i += 1;
  }
  return [out, i];
}

function decodeShown(raw, font) {
  if (!font?.cmap) return raw;
  const { map, bytes } = font.cmap; let out = '';
  if (bytes >= 2) { for (let i = 0; i + 1 < raw.length; i += 2) out += map.get((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1)) ?? ''; }
  else for (let i = 0; i < raw.length; i += 1) out += map.get(raw.charCodeAt(i)) ?? raw[i];
  return out;
}

function readContent(s, fonts) {
  let out = ''; let font = null; const stack = []; let tokens = 0; let i = 0; let lastY = null;
  const newline = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  while (i < s.length && out.length < LIMITS.textChars) {
    if (++tokens > LIMITS.tokenCount) break;
    const ch = s[i];
    if (ch === '(') { const [str, next] = readLiteral(s, i); stack.push({ t: 's', v: str }); i = next; continue; }
    if (ch === '<' && s[i + 1] !== '<') { const end = s.indexOf('>', i); if (end < 0) break; const hex = s.slice(i + 1, end).replace(/\s+/g, ''); let str = ''; for (let k = 0; k + 1 < hex.length + 1; k += 2) { const b = parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16); if (Number.isFinite(b)) str += String.fromCharCode(b); } stack.push({ t: 's', v: str }); i = end + 1; continue; }
    if (ch === '<' || ch === '>') { i += ch === s[i + 1] ? 2 : 1; continue; }
    if (ch === '[') { stack.push({ t: '[' }); i += 1; continue; }
    if (ch === ']') { const items = []; while (stack.length && stack.at(-1).t !== '[') items.unshift(stack.pop()); stack.pop(); stack.push({ t: 'a', v: items }); i += 1; continue; }
    if (ch === '/') { const m = s.slice(i + 1, i + 80).match(/^[^\s()<>\[\]{}\/%]*/)[0]; stack.push({ t: 'n', v: m }); i += 1 + m.length; continue; }
    if (ch === '%') { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e + 1; continue; }
    if (/\s/.test(ch)) { i += 1; continue; }
    const word = s.slice(i, i + 40).match(/^[^\s()<>\[\]{}\/%]+/)?.[0] ?? s[i]; i += word.length || 1;
    if (/^[+-]?\d*\.?\d+$/.test(word)) { stack.push({ t: 'x', v: Number(word) }); continue; }
    switch (word) {
      case 'Tf': { const name = stack.at(-2); font = name?.t === 'n' ? fonts.get(name.v) ?? null : null; stack.length = 0; break; }
      case 'Tj': { const a = stack.at(-1); if (a?.t === 's') out += decodeShown(a.v, font); stack.length = 0; break; }
      case "'": case '"': { newline(); const a = stack.at(-1); if (a?.t === 's') out += decodeShown(a.v, font); stack.length = 0; break; }
      case 'TJ': { const a = stack.at(-1); if (a?.t === 'a') for (const item of a.v) { if (item.t === 's') out += decodeShown(item.v, font); else if (item.t === 'x' && item.v < -250 && !out.endsWith(' ')) out += ' '; } stack.length = 0; break; }
      // A new line only when the vertical position changes: browsers split one line into several runs (kerning pairs).
      case 'Tm': { const y = stack.at(-1); if (y?.t === 'x') { if (lastY !== null && Math.abs(y.v - lastY) > 0.5) newline(); lastY = y.v; } stack.length = 0; break; }
      case 'Td': case 'TD': { const ty = stack.at(-1); if (ty?.t === 'x' && Math.abs(ty.v) > 0.5) newline(); stack.length = 0; break; }
      case 'T*': case 'ET': newline(); lastY = null; stack.length = 0; break;
      case 'BT': stack.length = 0; break;
      default: if (stack.length > 64) stack.length = 0; if (/^[A-Za-z*'"]+$/.test(word)) stack.length = 0;
    }
  }
  return out;
}

// ---- fonts: map each font resource name (/F1) to its ToUnicode map
async function buildFonts(raw, objects, warnings, budget) {
  const fonts = new Map(); const cmapCache = new Map();
  const cmapFor = async (num) => {
    if (cmapCache.has(num)) return cmapCache.get(num);
    const obj = objects.get(num); const text = obj ? await decodeStream(obj, warnings, budget) : null;
    const parsed = text && /beginbf(char|range)/.test(text) ? parseToUnicode(text) : null; cmapCache.set(num, parsed); return parsed;
  };
  const pairs = []; // [name, object number]
  for (const m of raw.matchAll(/\/Font\s*(<<|\d+\s+\d+\s+R)/g)) {
    let block = '';
    if (m[1] === '<<') { let depth = 0; for (let i = m.index + m[0].length - 2; i < raw.length && i < m.index + 6000; i += 1) { if (raw.startsWith('<<', i)) { depth += 1; i += 1; } else if (raw.startsWith('>>', i)) { depth -= 1; i += 1; if (!depth) { block = raw.slice(m.index, i + 1); break; } } } }
    else { const n = Number(m[1].match(/\d+/)[0]); block = objects.get(n)?.dict ?? ''; }
    for (const p of block.matchAll(/\/([^\s\/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) pairs.push([p[1], Number(p[2])]);
  }
  for (const [name, num] of pairs) {
    if (fonts.has(name)) continue;
    const font = objects.get(num); const to = font?.dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    fonts.set(name, { cmap: to ? await cmapFor(Number(to[1])) : null });
  }
  return fonts;
}

const fail = (reason, message) => ({ ok: false, reason, message, text: '', warnings: [] });
export const MESSAGES = Object.freeze({
  not_pdf: 'This does not look like a PDF file.',
  too_large: 'This file is too large to read on this device. Type the details instead.',
  encrypted: 'This PDF is protected, so it cannot be read here. Type the details instead.',
  no_text: 'No readable text was found. It may be a scan or a photo. Type the details instead.',
});

export async function extractPdfText(input) {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes) return fail('not_pdf', MESSAGES.not_pdf);
  if (bytes.length > LIMITS.fileBytes) return fail('too_large', MESSAGES.too_large);
  const raw = latin1(bytes);
  if (!/%PDF-\d/.test(raw.slice(0, 1024))) return fail('not_pdf', MESSAGES.not_pdf);
  if (/\/Encrypt\b/.test(raw)) return fail('encrypted', MESSAGES.encrypted);
  const warnings = new Set(); const budget = { streams: 0 };
  const objects = parseObjects(raw, bytes);
  const fonts = await buildFonts(raw, objects, warnings, budget);
  let text = '';
  for (const object of objects.values()) {
    if (text.length >= LIMITS.textChars) { warnings.add('Only the first part of a long file was read.'); break; }
    const body = await decodeStream(object, warnings, budget);
    if (body && /\bBT\b[\s\S]*\bET\b/.test(body) && !/beginbf(char|range)/.test(body)) { const part = readContent(body, fonts); if (part.trim()) text += `${part}\n`; }
  }
  // Control characters and direction overrides are removed: the text is shown, never interpreted.
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').slice(0, LIMITS.textChars).trim();
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (text.length < 15 || letters < 8 || letters / text.length < 0.25) return { ...fail('no_text', MESSAGES.no_text), warnings: [...warnings] };
  return { ok: true, text, warnings: [...warnings] };
}
