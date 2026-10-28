import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { catalog } from '../public/accessibility/catalog.js';
import { computeCoverage, isTranslated, renderReport, LANGS } from '../scripts/translation-coverage.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the committed coverage report is current: regenerate it with scripts/translation-coverage.mjs --write', () => {
  assert.equal(read('TRANSLATION-COVERAGE.md'), renderReport());
});

test('the report is internally consistent and never overstates', () => {
  const rows = computeCoverage();
  assert.ok(rows.length >= 10);
  for (const row of rows) {
    assert.equal(row.total, row.strings + row.dynamic);
    for (const lang of LANGS) assert.ok(row[lang] >= 0 && row[lang] <= row.strings, `${row.name} ${lang}`);
  }
  const report = renderReport(rows);
  assert.match(report, /Every translation in Mgadi is an unreviewed draft/);
  assert.match(report, /No language is complete/);
  assert.doesNotMatch(report, /\b100%\b.*(?:reviewed|approved|complete)/i);
});

test('counting rule: only an entry that exists AND differs from the English counts as translated', () => {
  const table = { zu: { Same: 'Same', Different: 'Okwehlukile', Empty: '' } };
  assert.equal(isTranslated('Same', 'zu', table), false, 'a copy of the English is not a translation');
  assert.equal(isTranslated('Different', 'zu', table), true);
  assert.equal(isTranslated('Empty', 'zu', table), false);
  assert.equal(isTranslated('Missing', 'zu', table), false);
  assert.equal(isTranslated('Different', 'xh', table), false, 'another language is not borrowed');
  for (const lang of ['zu', 'xh', 'af']) assert.equal(Object.keys(catalog[lang]).length, Object.keys(catalog.en).length, `${lang} catalog has the same keys as English`);
});

test('nothing the person can read claims the product is fully or completely translated, or that translations are reviewed', () => {
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'icons') walk(p); } else if (/\.(js|html|json|webmanifest)$/.test(e.name)) files.push(p); } };
  walk(path.join(root, 'public'));
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /fully translated|completely translated|complete translation|translations? (?:are|is) (?:reviewed|approved|verified|certified)/i, file);
  }
  assert.match(read('public/accessibility/accessibility.js'), /translations need speaker review\. Missing translations remain in English/);
});

test('the ransomware guide, the connectivity notices and the pack screens are honestly reported as untranslated drafts today', () => {
  const rows = Object.fromEntries(computeCoverage().map((r) => [r.name.split(' (')[0], r]));
  for (const name of ['Ransomware guide', 'Errors and connectivity notices']) for (const lang of LANGS) assert.equal(rows[name][lang], 0, `${name} ${lang}`);
  for (const lang of ['st', 'tn', 'nso', 'ss', 'nr', 'ts', 've']) for (const row of Object.values(rows)) assert.equal(row[lang], 0, `${lang} has no invented translation in ${row.name}`);
  assert.ok(rows['Payment-diversion guide'].zu > 0, 'the one drafted path is counted');
});
