import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPackData, defaultPackOptions, previewItems, summarySections } from '../public/shared/summary.js';
import { redactIncident } from '../public/shared/redact.js';
import { makePack, verifyPack } from '../public/shared/pack.js';

const sample = (extra = {}) => ({
  description: 'Supplier changed the bank details and I paid.',
  redacted: redactIncident('Supplier changed the bank details and I paid.'),
  source: 'user-selected route', title: 'Possible payment fraud',
  timeline: [{ at: '2026-10-28T09:00:00.000Z', text: 'Incident started' }],
  evidence: [{ name: 'test-invoice.pdf', size: 150, type: 'application/pdf', sha256: 'a'.repeat(64), addedAt: '2026-10-28T09:01:00.000Z' }],
  steps: [{ id: 'bank', title: 'Call the bank', state: 'pending', at: null }],
  ...extra,
});

test('evidence and timeline can be left out of the downloaded incident pack', async () => {
  const state = sample();
  const options = { ...defaultPackOptions(state), includeEvidence: false, includeTimeline: false };
  const pack = buildPackData(state, options);
  assert.deepEqual(pack.evidence, []);
  assert.deepEqual(pack.timeline, []);
  assert.deepEqual(pack.omittedByOwner, { evidence: true, timeline: true });
  const preview = Object.fromEntries(previewItems(state, options).map(item => [item.id, item.value]));
  assert.match(preview.evidence, /excluded/);
  assert.equal(preview.timeline, 'Not included');
  assert.match(summarySections(pack).find(section => section.heading === 'Evidence fingerprints').lines.join(' '), /excluded/);
  assert.match(summarySections(pack).find(section => section.heading === 'Timeline').lines.join(' '), /excluded/);
  const sealed = await makePack(pack);
  assert.equal(await verifyPack(sealed), true);
  assert.equal(await verifyPack({ ...sealed, omittedByOwner: { evidence: false, timeline: true } }), false);
});

test('default choices retain evidence fingerprints and timeline for a real review', () => {
  const state = sample();
  const options = defaultPackOptions(state);
  assert.equal(options.includeEvidence, true);
  assert.equal(options.includeTimeline, true);
  const pack = buildPackData(state, options);
  assert.equal(pack.evidence.length, 1);
  assert.equal(pack.timeline.length, 1);
  assert.equal(Object.hasOwn(pack, 'omittedByOwner'), false);
});

test('bank feedback is optional, redacted, and included only after the owner's choice', () => {
  const state = sample({ bankFeedback: 'Bank called me at 082 123 4567 and gave a reference.' });
  const options = defaultPackOptions(state);
  assert.equal(options.includeHandoff, true);
  const noHandoff = buildPackData(state, { ...options, includeHandoff: false });
  assert.equal(Object.hasOwn(noHandoff, 'handoff'), false);
  assert.doesNotMatch(JSON.stringify(noHandoff), /082 123 4567/);
  const withHandoff = buildPackData(state, { ...options, includeHandoff: true });
  assert.match(withHandoff.handoff.bankFeedback, /\\[PHONE\\]/);
  assert.doesNotMatch(withHandoff.handoff.bankFeedback, /082 123 4567/);
  assert.match(previewItems(state, options).find(item => item.id === 'handoff').value, /bank/);
});
