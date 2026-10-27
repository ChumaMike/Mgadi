// Runs every browser suite and FAILS if any of them did not really run.
//   MGADI_PLAYWRIGHT=/path/to/playwright/index.mjs MGADI_AXE=/path/to/axe.min.js node scripts/run-browser-suites.mjs [suite ...]
// Each suite prints "SKIPPED" and exits 0 when Playwright or the built files are missing, so that a laptop without a browser can still run
// `npm test`. That is the wrong behaviour for CI, where a skipped suite would look like a pass. This runner treats all of these as failures:
//   - a non-zero exit, a timeout, a missing result line
//   - any line containing SKIPPED
//   - a result line "N/M ..." where N < M
// It prints the real numbers it saw. Nothing here talks to a paid service; the suites start their own local server and block other hosts.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ALL = ['browser-smoke', 'emergency-smoke', 'voice-smoke', 'retell-sdk-smoke', 'pwa-smoke', 'a11y-smoke', 'tools-smoke'];
const TIMEOUT_MS = Number(process.env.MGADI_SUITE_TIMEOUT_MS ?? 240_000);
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

export function judge({ code, signal, output }) {
  const problems = [];
  if (signal) problems.push(`killed by ${signal} (timeout?)`);
  else if (code !== 0) problems.push(`exit code ${code}`);
  if (/SKIPPED/.test(output)) problems.push('a part of this suite was SKIPPED, so it did not really run');
  const results = [...output.matchAll(/^(\d+)\/(\d+)\b.*$/gm)];
  const last = results.at(-1);
  if (!last) problems.push('no "N/M ... passed" result line was printed');
  else if (Number(last[1]) < Number(last[2])) problems.push(`only ${last[1]} of ${last[2]} checks passed`);
  return { ok: problems.length === 0, problems, summary: last ? last[0].trim() : '(no result line)' };
}

function run(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, `${name}.mjs`)], { cwd: path.join(here, '..'), env: process.env });
    let output = ''; const append = (chunk) => { output += chunk; };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ name, code, signal, output }); });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failed = 0; const rows = [];
  for (const name of chosen) {
    const started = Date.now(); const finished = await run(name); const verdict = judge(finished);
    rows.push({ name, ...verdict, seconds: Math.round((Date.now() - started) / 1000) });
    if (!verdict.ok) { failed += 1; console.log(`\n----- ${name}: FAILED -----\n${finished.output.split('\n').filter((line) => /FAIL|SKIPPED|Error|passed/.test(line)).slice(-30).join('\n')}`); }
  }
  console.log('\nBrowser suites (real Chromium, local server, no external services):');
  for (const row of rows) console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.name.padEnd(18)} ${row.summary}  (${row.seconds}s)${row.ok ? '' : `  <- ${row.problems.join('; ')}`}`);
  console.log(failed ? `\n${failed} of ${rows.length} suites did not pass.` : `\nAll ${rows.length} suites passed.`);
  process.exit(failed ? 1 : 0);
}
