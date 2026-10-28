import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodePngRgb, shrinkSquare, writeSmallLogo, SMALL_SIZE } from '../scripts/make-logo.mjs';
import { encodePng } from '../scripts/make-icons.mjs';
import { buildPrecacheManifest } from '../server/precache.js';

const brand = new URL('../public/brand/', import.meta.url).pathname;

test('the supplied logo is read correctly, and the shrunk copy keeps its proportions, colours and shape', () => {
  const source = decodePngRgb(fs.readFileSync(path.join(brand, 'mgadi-logo.png')));
  assert.equal(source.width, 1254); assert.equal(source.height, 1254);
  const small = shrinkSquare(source, SMALL_SIZE);
  assert.equal(small.length, SMALL_SIZE * SMALL_SIZE * 3);
  const mean = (rgb) => { const t = [0, 0, 0]; for (let i = 0; i < rgb.length; i += 3) { t[0] += rgb[i]; t[1] += rgb[i + 1]; t[2] += rgb[i + 2]; } return t.map((v) => v / (rgb.length / 3)); };
  const a = mean(source.rgb); const b = mean(small);
  for (let i = 0; i < 3; i += 1) assert.ok(Math.abs(a[i] - b[i]) < 1.5, `average colour channel ${i} is unchanged (${a[i].toFixed(2)} vs ${b[i].toFixed(2)})`);
  const edge = (rgb, size) => { let left = size; let right = 0; for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) { const i = (y * size + x) * 3; if (rgb[i] < 200 || rgb[i + 1] < 200 || rgb[i + 2] < 200) { left = Math.min(left, x); right = Math.max(right, x); } } return [left / size, right / size]; };
  const [l1, r1] = edge(source.rgb, 1254); const [l2, r2] = edge(small, SMALL_SIZE);
  assert.ok(Math.abs(l1 - l2) < 0.01 && Math.abs(r1 - r2) < 0.01, `the artwork sits in the same place (${l1.toFixed(3)}-${r1.toFixed(3)} vs ${l2.toFixed(3)}-${r2.toFixed(3)})`);
});

test('the decoder round-trips what the icon writer encodes, and refuses formats it does not understand', () => {
  const rgb = Buffer.alloc(8 * 8 * 3); for (let i = 0; i < rgb.length; i += 1) rgb[i] = (i * 37) & 0xff;
  const back = decodePngRgb(encodePng(8, rgb)); assert.equal(back.width, 8); assert.ok(back.rgb.equals(rgb));
  assert.throws(() => decodePngRgb(Buffer.from('not a png')), /not a PNG/);
  const rgba = encodePng(4, Buffer.alloc(48)); rgba[25] = 6; // claim RGBA
  assert.throws(() => decodePngRgb(rgba), /only 8-bit RGB/);
  assert.throws(() => shrinkSquare({ width: 4, height: 2, rgb: Buffer.alloc(24) }, 2), /square/);
});

test('the small logo is a fraction of the original, and the page uses it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgadi-logo-'));
  fs.copyFileSync(path.join(brand, 'mgadi-logo.png'), path.join(dir, 'mgadi-logo.png'));
  const made = writeSmallLogo(dir);
  assert.equal(made.to, 384);
  assert.ok(made.bytes < fs.statSync(path.join(brand, 'mgadi-logo.png')).size / 4, `${made.bytes} bytes is under a quarter of the original`);
  assert.ok(made.bytes < 150_000, 'small enough for a slow connection');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /src="\/brand\/mgadi-logo-384\.png"[^>]*width="384" height="384"/);
  assert.doesNotMatch(html, /mgadi-logo\.png/);
});

test('the offline copy carries the small logo, not the 740 KB original', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgadi-pre-'));
  fs.mkdirSync(path.join(dir, 'brand')); fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(dir, 'brand', 'mgadi-logo.png'), Buffer.alloc(100)); fs.writeFileSync(path.join(dir, 'brand', 'mgadi-logo-384.png'), Buffer.alloc(50));
  const urls = (await buildPrecacheManifest(dir)).assets.map((a) => a.url);
  assert.ok(urls.includes('/brand/mgadi-logo-384.png')); assert.ok(!urls.includes('/brand/mgadi-logo.png'));
});
