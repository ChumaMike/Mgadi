// Builds public/vendor/retell-client.js from the pinned official SDK (retell-client-js-sdk) so the browser
// loads it from our own origin: the CSP stays `script-src 'self'` with no CDN. The output is generated, git-ignored
// and rebuilt on deploy (`npm run vendor`). If it is missing, the app still works and voice is reported unavailable.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let esbuild;
try { esbuild = await import('esbuild'); } catch { console.error('esbuild is not installed. Run `npm install` first.'); process.exit(1); }
let sdkVersion;
try { sdkVersion = JSON.parse(await readFile(path.join(root, 'node_modules/retell-client-js-sdk/package.json'), 'utf8')).version; }
catch { console.error('retell-client-js-sdk is not installed. Run `npm install` first.'); process.exit(1); }

const outDir = path.join(root, 'public/vendor');
await mkdir(outDir, { recursive: true });
const result = await esbuild.build({
  entryPoints: [path.join(root, 'scripts/vendor/retell-entry.js')],
  bundle: true, format: 'esm', minify: true, target: 'es2020', platform: 'browser', write: false,
  alias: { 'livekit-client': path.join(root, 'scripts/vendor/livekit-stub.js') },
  legalComments: 'none', logLevel: 'warning',
});
const code = `/* retell-client-js-sdk ${sdkVersion} (ISC), bundled by scripts/vendor-retell.mjs. Generated: do not edit. */\n${result.outputFiles[0].text}`;
if (/\beval\(|new Function\(/.test(code)) { console.error('Refusing to write a bundle that uses eval/new Function: it would break the CSP.'); process.exit(1); }
await writeFile(path.join(outDir, 'retell-client.js'), code);
const manifest = { sdk: sdkVersion, bytes: Buffer.byteLength(code), sha256: createHash('sha256').update(code).digest('hex') };
await writeFile(path.join(outDir, 'retell-client.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built public/vendor/retell-client.js (retell-client-js-sdk ${sdkVersion}, ${manifest.bytes} bytes)`);
