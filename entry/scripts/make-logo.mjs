// Makes the small copy of the Mgadi logo that the app actually shows. The supplied logo (public/brand/mgadi-logo.png, 1254 x 1254,
// about 740 KB) is kept exactly as supplied, but it is drawn at about 100 to 190 pixels, so sending it to every phone cost more than
// everything else on the first screen put together. This writes public/brand/mgadi-logo-384.png: the same picture, same square
// proportions, same colours (the page's CSS still removes the paper-white background), reduced with an averaging filter.
// Dependencies: none (Node's zlib). Handles the supplied file's format only (8-bit RGB, not interlaced) and refuses anything else.
//   node scripts/make-logo.mjs     (also run by `npm run build`)
import { inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './make-icons.mjs';

export const SMALL_SIZE = 384;

export function decodePngRgb(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('not a PNG file');
  let width = 0; let height = 0; const data = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset); const type = buffer.toString('latin1', offset + 4, offset + 8); const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 2 || body[12] !== 0) throw new Error('only 8-bit RGB, non-interlaced PNG files are supported');
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data)); const stride = width * 3; const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 3 ? out[y * stride + x - 3] : 0; const up = y ? out[(y - 1) * stride + x] : 0; const upLeft = x >= 3 && y ? out[(y - 1) * stride + x - 3] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left; else if (filter === 2) predictor = up; else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) { const p = left + up - upLeft; const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft); predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft; }
      else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
      out[y * stride + x] = (line[x] + predictor) & 0xff;
    }
  }
  return { width, height, rgb: out };
}

// Area-average reduction of a square picture: every output pixel is the mean of the source pixels it covers.
export function shrinkSquare({ width, height, rgb }, size) {
  if (width !== height) throw new Error('the logo must be square');
  const out = Buffer.alloc(size * size * 3); const ratio = width / size;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const x0 = Math.floor(x * ratio); const x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio)); const y0 = Math.floor(y * ratio); const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio));
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) { const i = (yy * width + xx) * 3; r += rgb[i]; g += rgb[i + 1]; b += rgb[i + 2]; n += 1; }
    const o = (y * size + x) * 3; out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
  }
  return out;
}

export function writeSmallLogo(brandDir) {
  const source = decodePngRgb(readFileSync(path.join(brandDir, 'mgadi-logo.png')));
  const png = encodePng(SMALL_SIZE, shrinkSquare(source, SMALL_SIZE));
  writeFileSync(path.join(brandDir, `mgadi-logo-${SMALL_SIZE}.png`), png);
  return { from: source.width, to: SMALL_SIZE, bytes: png.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = writeSmallLogo(path.join(root, 'public', 'brand'));
  console.log(`Wrote public/brand/mgadi-logo-${result.to}.png (${result.bytes} bytes) from the ${result.from}px original`);
}
