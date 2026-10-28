// Full build: voice engine bundle, app icons, and the offline manifest. Generated files are git-ignored.
//   npm run build
// Reproducible: the same source and the same SOURCE_DATE_EPOCH give the same manifest version and the same bundle.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrecacheManifest } from '../server/precache.js';
import { writeIcons } from './make-icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = spawnSync(process.execPath, [path.join(root, 'scripts', 'vendor-retell.mjs')], { stdio: 'inherit' });
if (vendor.status !== 0) process.exit(vendor.status ?? 1);
console.log(`Wrote ${writeIcons(path.join(root, 'public', 'icons')).length} icons`);
const manifest = await buildPrecacheManifest(path.join(root, 'public'));
writeFileSync(path.join(root, 'public', 'precache-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`Offline copy: version ${manifest.version}, ${manifest.assets.length} files, ${manifest.totalBytes} bytes`);
