import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPackData, defaultPackOptions, previewItems, summarySections, storyFor, formatBytes, PACK_FORMAT } from '../public/shared/summary.js';
import { makePack, verifyPack } from '../public/shared/pack.js';
import { redactIncident } from '../public/shared/redact.js';

const description = 'Sipho paid R70k to the new account. Call 082 123 4567.';
const state = (extra = {}) => ({
  description, redacted: redactIncident(description, ['Sipho']), business: 'Test Co', amount: 'R 70 000,00',
  triage: { label: 'payment_diversion', confidence: 0.9 }, source: 'rules', title: 'Possible payment diversion',
  timeline: [{ at: '2026-10-27T10:00:00.000Z', text: 'Incident started' }],
  evidence: [{ name: 'proof.pdf', size: 2048, type: 'application/pdf', sha256: 'ab'.repeat(32), addedAt: '2026-10-27T10:05:00.000Z' }],
  guideReviewed: false, ...extra,
});

test('by default the pack holds the masked story and never the original words', () => {
  const pack = buildPackData(state(), defaultPackOptions(state()));
  assert.equal(pack.format, PACK_FORMAT);
  assert.equal(pack.story.version, 'masked');
  const text = JSON.stringify(pack);
  assert.doesNotMatch(text, /082 123 4567|Sipho|R70k/);
  assert.match(pack.story.text, /\[PHONE\]/);
  assert.equal(Object.hasOwn(pack, 'ownerDescription'), false);
});

test('original words, business and amount appear only when the owner opts in', () => {
  const none = buildPackData(state(), { includeOriginal: false, includeBusiness: false, includeAmount: false });
  assert.equal(Object.hasOwn(none, 'business'), false); assert.equal(Object.hasOwn(none, 'amount'), false);
  const all = buildPackData(state(), { includeOriginal: true, includeBusiness: true, includeAmount: true });
  assert.equal(all.story.version, 'original'); assert.match(all.story.text, /082 123 4567/);
  assert.equal(all.business, 'Test Co'); assert.equal(all.amount, 'R 70 000,00');
});

test('no typed description (route chosen by buttons) is reported as such, not invented', () => {
  const s = state({ description: '', redacted: undefined });
  assert.equal(storyFor(s, { includeOriginal: true }).version, 'none');
  const lines = summarySections(buildPackData(s, defaultPackOptions(s)))[0].lines.join(' ');
  assert.match(lines, /chosen from the buttons/);
});

test('bank status is honest: reported only when the owner pressed called', () => {
  assert.equal(buildPackData(state()).bank.status, 'not-reported');
  const reported = buildPackData(state({ bankReportedAt: '2026-10-27T10:02:00.000Z' }));
  assert.equal(reported.bank.status, 'user-reported-called');
  assert.match(reported.bank.note, /cannot confirm/);
  assert.match(summarySections(buildPackData(state())).find((s) => s.heading === 'Bank').lines[0], /has not reported calling the bank/);
});

test('preview lists what will be shared and shows what is excluded', () => {
  const items = Object.fromEntries(previewItems(state(), { includeOriginal: false, includeBusiness: false, includeAmount: true }).map((i) => [i.id, i.value]));
  assert.match(items.story, /\[PHONE\]/); assert.equal(items.business, 'Not included'); assert.equal(items.amount, 'R 70 000,00');
  assert.match(items.evidence, /files themselves are not included/);
});

test('readable summary covers timeline, evidence fingerprints and the checksum caveat', () => {
  const sections = summarySections(buildPackData(state()));
  const headings = sections.map((s) => s.heading);
  for (const heading of ['What happened', 'Situation suggested by Mgadi', 'Bank', 'Timeline', 'Evidence fingerprints', 'Please note']) assert.ok(headings.includes(heading), heading);
  assert.match(sections.find((s) => s.heading === 'Evidence fingerprints').lines[0], /proof\.pdf \(2,0 KB, application\/pdf\) SHA-256 abab/);
  assert.match(JSON.stringify(sections), /not a digital signature/);
  assert.match(JSON.stringify(sections), /Draft guidance/);
  assert.match(sections.find((s) => s.heading === 'Timeline').lines[0], /2026/);
});

test('pack checksum detects edits to the new format, including the story and bank status', async () => {
  const pack = await makePack(buildPackData(state()));
  assert.equal(await verifyPack(pack), true);
  assert.equal(await verifyPack({ ...pack, story: { ...pack.story, text: 'edited' } }), false);
  assert.equal(await verifyPack({ ...pack, bank: { ...pack.bank, status: 'user-reported-called' } }), false);
});

test('formatBytes uses South African decimal commas and survives bad input', () => {
  assert.equal(formatBytes(512), '512 bytes'); assert.equal(formatBytes(1536), '1,5 KB'); assert.equal(formatBytes('x'), 'unknown size');
});
