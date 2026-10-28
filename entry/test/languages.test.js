import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LANGUAGE_LIST, languageCodes } from '../public/accessibility/languages.js';
import { catalog, languages, translate, translationLanguage, translationState } from '../public/accessibility/catalog.js';
import { PROVIDER_LANGUAGES } from '../server/voice.js';
import { exportRows, renderCsv, PRIORITY } from '../scripts/translation-export.mjs';
import { surfaces } from '../scripts/translation-coverage.mjs';

const review = JSON.parse(fs.readFileSync(new URL('../translations/REVIEW-STATUS.json', import.meta.url), 'utf8'));
const NEW = ['st', 'tn', 'nso', 'ss', 'nr', 'ts', 've'];

test('the interface lists the eleven written official languages, each with a distinct language tag, and SASL is not among them', () => {
  assert.equal(LANGUAGE_LIST.length, 11);
  assert.deepEqual(languageCodes, ['en', 'zu', 'xh', 'af', ...NEW]);
  assert.equal(new Set(languageCodes).size, 11);
  for (const entry of LANGUAGE_LIST) assert.match(entry.code, /^[a-z]{2,3}$/, `${entry.name} has a plain BCP 47 language tag`);
  assert.ok(!languageCodes.some((code) => /sasl|sfs|ssh|sgn/i.test(code)), 'sign language is a separate pathway, not a text translation');
  assert.deepEqual(Object.keys(languages), languageCodes);
});

test('a language with no translation shows English, tags it as English, and says so', () => {
  for (const code of NEW) {
    assert.equal(translationState(code), 'fallback', code);
    assert.equal(Object.keys(catalog[code]).length, 0, `${code} has no invented text`);
    assert.equal(translate('Call your bank now', code), 'Call your bank now');
    assert.equal(translationLanguage('Call your bank now', code), 'en', 'the screen reader must pronounce it as English');
  }
  assert.equal(translationState('en'), 'source');
  for (const code of ['zu', 'xh', 'af']) assert.equal(translationState(code), 'draft');
});

test('an entry that only copies the English is not tagged as the other language, and inherited object keys are not translations', () => {
  const before = catalog.zu.__probe; assert.equal(before, undefined);
  catalog.zu.__probe = '__probe'; // a copy of the English
  assert.equal(translationLanguage('__probe', 'zu'), 'en'); delete catalog.zu.__probe;
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) { assert.equal(translate(key, 'zu'), key); assert.equal(translationLanguage(key, 'zu'), 'en'); }
});

test('every language has a review record, and the record agrees with what the catalog really holds', () => {
  assert.equal(review.format, 'mgadi-translation-review/1');
  const allowed = new Set(Object.keys(review.statuses));
  for (const code of languageCodes.filter((c) => c !== 'en')) {
    const record = review.languages[code];
    assert.ok(record, `${code} has a review record`);
    assert.equal(record.name, languages[code]);
    assert.ok(allowed.has(record.status), `${code} status ${record.status}`);
    assert.ok(Array.isArray(record.reviewers) && Array.isArray(record.reviewedScope));
    const hasText = translationState(code) === 'draft';
    assert.equal(record.status === 'not-started', !hasText, `${code}: "not-started" exactly when the catalog has no text`);
  }
  assert.deepEqual(Object.keys(review.languages).sort(), languageCodes.filter((c) => c !== 'en').sort());
});

test('"reviewed" cannot be claimed without named reviewers, a date and a scope (and nobody is recorded today)', () => {
  for (const [code, record] of Object.entries(review.languages)) {
    if (record.status === 'reviewed' || record.status === 'in-review') {
      assert.ok(record.reviewers.length > 0 && record.reviewers.every((n) => typeof n === 'string' && n.trim()), `${code} reviewers`);
      assert.match(String(record.reviewedOn), /^\d{4}-\d{2}-\d{2}$/, `${code} date`);
      assert.ok(record.reviewedScope.length > 0, `${code} scope`);
    }
    assert.notEqual(record.status, 'reviewed', `${code}: no language has been reviewed; if one has, change this test on purpose together with the recorded review`);
    assert.equal(record.reviewers.length, 0, `${code}: no reviewer is recorded today`);
  }
});

test('a written language can never switch on a spoken one: every language is known to the voice service, and only English and Afrikaans have any provider voice', () => {
  for (const code of languageCodes) assert.ok(PROVIDER_LANGUAGES[code], `${code} is known to the voice service`);
  const withVoice = Object.entries(PROVIDER_LANGUAGES).filter(([, info]) => info.retell).map(([code]) => code);
  assert.deepEqual(withVoice.sort(), ['af', 'en']);
});

test('the reviewer spreadsheet lists every string, puts money and safety first, shows current drafts, and invents nothing', () => {
  const rows = exportRows('zu');
  const expected = surfaces.reduce((n, [, { strings, dynamic }]) => n + strings.length + dynamic.length, 0);
  assert.equal(rows.length, expected);
  assert.ok(rows[0].priority.startsWith('critical'), 'critical rows come first');
  const firstNonCritical = rows.findIndex((r) => !r.priority.startsWith('critical'));
  assert.ok(rows.slice(firstNonCritical).every((r) => !r.priority.startsWith('critical')), 'critical rows are not scattered');
  assert.ok(rows.some((r) => r.draft && r.status === 'unreviewed draft'), 'an existing draft is shown as an unreviewed draft');
  assert.ok(exportRows('st').every((r) => r.draft === '' && r.status === 'not translated'), 'a language with no text exports no invented drafts');
  assert.ok(rows.some((r) => r.kind.startsWith('pattern')), 'run-time text is marked as a pattern');
  assert.ok(Object.values(PRIORITY).some((p) => /consent/.test(p)));
  const csv = renderCsv('st');
  assert.ok(csv.startsWith('\uFEFF"id"'));
  assert.equal(csv.trimEnd().split('\r\n').length, exportRows('st').length + 1);
  assert.throws(() => exportRows('xx'), /Unknown language code/);
});
