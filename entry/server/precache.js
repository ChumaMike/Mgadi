// Builds the list of PUBLIC, static, reviewed files the service worker saves for offline use, each with its SHA-256, plus a
// version that changes whenever any of them changes. The service worker verifies every download against these hashes and
// keeps all-or-nothing, so a half-finished, corrupted or mixed-version install can never become the offline copy.
//
// Deliberately NOT included: the voice engine (public/vendor, needs the internet anyway), reviewed media (large; added only
// once real clips exist), this manifest, and the service worker itself. Nothing private ever lives in public/.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = ['vendor', 'accessibility/media'];
const SKIP_FILES = new Set(['sw.js', 'precache-manifest.json']);
const EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.png', '.svg', '.ico', '.txt']);
export const MAX_TOTAL_BYTES = 2_000_000;

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(base, full).split(path.sep).join('/');
    if (entry.isDirectory()) { if (!SKIP_DIRS.includes(relative)) out.push(...await walk(full, base)); }
    else if (!SKIP_FILES.has(relative) && !entry.name.startsWith('.') && EXTENSIONS.has(path.extname(entry.name))) out.push({ full, relative });
  }
  return out;
}

export async function buildPrecacheManifest(publicDir, { builtAt } = {}) {
  const assets = []; let newest = 0;
  for (const file of (await walk(publicDir)).sort((a, b) => (a.relative < b.relative ? -1 : 1))) {
    const bytes = await readFile(file.full);
    newest = Math.max(newest, (await stat(file.full)).mtimeMs);
    assets.push({ url: `/${file.relative}`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
  }
  // The app shell is reached as "/" as well as "/index.html".
  const index = assets.find((a) => a.url === '/index.html');
  if (index) assets.unshift({ ...index, url: '/' });
  const totalBytes = assets.reduce((sum, a) => sum + a.bytes, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`offline copy would be ${totalBytes} bytes, over the ${MAX_TOTAL_BYTES} budget`);
  // The version depends only on the files, so the same files always give the same version (reproducible builds).
  const version = createHash('sha256').update(assets.map((a) => `${a.url} ${a.sha256}`).join('\n')).digest('hex').slice(0, 12);
  // "Saved on" is when the newest file was written (or SOURCE_DATE_EPOCH, for reproducible builds). It is not part of the version.
  return { version, builtAt: new Date(builtAt ?? builtAtFromEnv() ?? newest).toISOString(), totalBytes, assets };
}

function builtAtFromEnv(env = process.env) {
  const seconds = Number(env.SOURCE_DATE_EPOCH);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}
