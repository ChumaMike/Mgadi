// Draws the Mgadi app icons as PNG files with no dependencies (Node's zlib only). Run by `npm run build`; the PNGs are
// generated into the git-ignored public/icons/ folder. icon.svg (committed) is the same artwork as vector.
// The artwork is simple on purpose: forest square, ivory "M", amber dot. Brand colours come from styles.css.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FOREST = [0x12, 0x3c, 0x35]; const IVORY = [0xf7, 0xf4, 0xec]; const AMBER = [0xe9, 0xb4, 0x4c];
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(8 + data.length + 4); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length); return out; };

export function encodePng(size, rgb) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) { raw[y * (size * 3 + 1)] = 0; rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3); }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Distance from point to a segment, for stroking the letter.
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax; const dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };

// Opaque, full-bleed square: Android, iOS and desktop apply their own mask. A maskable icon keeps the artwork inside the
// centre ~70% so no platform crop can cut the letter.
export function drawIcon(size, { maskable = false } = {}) {
  const rgb = Buffer.alloc(size * size * 3); const s = 3; // 3x3 supersampling for smooth edges
  const scale = maskable ? 0.72 : 1; const half = size / 2;
  const stroke = size * 0.085 * scale;
  const u = (v) => half + (v - 0.5) * size * scale; // artwork is drawn in a 0..1 box
  const M = [[0.26, 0.74, 0.26, 0.28], [0.26, 0.28, 0.5, 0.56], [0.5, 0.56, 0.74, 0.28], [0.74, 0.28, 0.74, 0.74]].map((v) => v.map(u));
  const dot = { x: u(0.5), y: u(0.8), r: size * 0.045 * scale };
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    let r = 0; let g = 0; let b = 0;
    for (let sy = 0; sy < s; sy += 1) for (let sx = 0; sx < s; sx += 1) {
      const px = x + (sx + 0.5) / s; const py = y + (sy + 0.5) / s;
      let color = FOREST;
      if (M.some(([ax, ay, bx, by]) => segDist(px, py, ax, ay, bx, by) <= stroke / 2)) color = IVORY;
      else if (Math.hypot(px - dot.x, py - dot.y) <= dot.r) color = AMBER;
      r += color[0]; g += color[1]; b += color[2];
    }
    const i = (y * size + x) * 3; rgb[i] = Math.round(r / (s * s)); rgb[i + 1] = Math.round(g / (s * s)); rgb[i + 2] = Math.round(b / (s * s));
  }
  return rgb;
}

export function writeIcons(outDir) {
  mkdirSync(outDir, { recursive: true });
  const files = { 'icon-192.png': [192, {}], 'icon-512.png': [512, {}], 'icon-maskable-512.png': [512, { maskable: true }], 'apple-touch-icon.png': [180, { maskable: true }] };
  for (const [name, [size, options]] of Object.entries(files)) writeFileSync(path.join(outDir, name), encodePng(size, drawIcon(size, options)));
  return Object.keys(files);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
  console.log(`Wrote ${writeIcons(out).join(', ')} to public/icons/`);
}
