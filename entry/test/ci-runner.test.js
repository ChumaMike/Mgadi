import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { judge } from '../scripts/run-browser-suites.mjs';

test('the CI runner passes a suite that ran everything and exited cleanly', () => {
  const v = judge({ code: 0, signal: null, output: 'PASS  a\nPASS  b\n\n59/59 emergency-routing browser checks passed.\n' });
  assert.equal(v.ok, true); assert.equal(v.summary, '59/59 emergency-routing browser checks passed.');
});

test('a suite that SKIPPED itself is a failure in CI, even though it exits 0 (otherwise a missing browser looks like a pass)', () => {
  const v = judge({ code: 0, signal: null, output: 'SKIPPED: Playwright is not installed. Nothing was tested.\n' });
  assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /SKIPPED/.test(p)));
  assert.equal(judge({ code: 0, signal: null, output: 'SKIPPED  automated rules: axe-core not found\n49/49 accessibility checks passed.\n' }).ok, false, 'a partly skipped suite also fails');
});

test('failures, partial passes, timeouts and missing results are all failures', () => {
  assert.equal(judge({ code: 1, signal: null, output: 'FAIL x\n57/59 checks passed.\n' }).ok, false);
  assert.equal(judge({ code: 0, signal: null, output: '57/59 checks passed.\n' }).ok, false, 'exit 0 but not every check passed');
  assert.equal(judge({ code: null, signal: 'SIGKILL', output: 'PASS a\n' }).ok, false);
  assert.equal(judge({ code: 0, signal: null, output: 'nothing useful\n' }).ok, false, 'no result line means we cannot tell, so it fails');
  assert.equal(judge({ code: 0, signal: null, output: '' }).ok, false);
});

test('the runner covers every browser suite that exists in scripts/', () => {
  const source = fs.readFileSync(new URL('../scripts/run-browser-suites.mjs', import.meta.url), 'utf8');
  const listed = source.match(/const ALL = \[(.*?)\]/)[1].split(',').map((x) => x.trim().replaceAll("'", ''));
  const onDisk = fs.readdirSync(new URL('../scripts/', import.meta.url)).filter((f) => /-smoke\.mjs$/.test(f)).map((f) => f.replace('.mjs', ''));
  assert.deepEqual([...listed].sort(), [...onDisk].sort());
});
