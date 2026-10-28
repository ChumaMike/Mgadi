import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPackData, buildHandoff } from '../public/shared/summary.js';
const at = '2026-10-28T09:00:00.000Z';
const steps = [
  { id: 'bank', title: 'Call the bank', state: 'needs_help', at },
  { id: 'supplier', title: 'Check supplier', state: 'not_applicable', at },
  { id: 'mailbox', title: 'Check mailbox', state: 'confirmed', at },
  { id: 'evidence', title: 'Keep evidence', state: 'pending' },
];
test('pack keeps owner outcomes distinct and never turns help or N/A into a bank confirmation', () => {
  const pack = buildPackData({ steps, timeline: [], evidence: [] });
  assert.equal(pack.bank.status, 'not-reported');
  const handoff = buildHandoff({ steps });
  assert.deepEqual(handoff.actions.map(a => a.status), ['help-requested-by-owner', 'not-applicable-by-owner', 'reported-by-owner', 'not-reported']);
  assert.deepEqual(handoff.remainingSteps, ['Call the bank', 'Check supplier', 'Keep evidence']);
  assert.equal(handoff.actions[0].reportedAt, at);
  assert.equal(handoff.actions[3].reportedAt, null);
});
test('ransomware handoff explains help and not-applicable without calling either completed', () => {
  const handoff = buildHandoff({ triage: { label: 'ransomware_suspected' }, steps: [
    { id: 'disconnect', title: 'Disconnect', state: 'needs_help', at },
    { id: 'get_help', title: 'Get help', state: 'not_applicable', at },
  ] });
  const text = handoff.specialistSummary.lines.join('\n');
  assert.match(text, /Disconnected from the network: help requested by the owner/);
  assert.match(text, /Contacted a specialist: marked not applicable by the owner/);
  assert.doesNotMatch(text, /undefined|completed/);
});
test('direct incident records never claim an AI classification or a reported bank call', async () => {
  const { summarySections, previewItems } = await import('../public/shared/summary.js');
  const state = { title: 'Incident record', source: 'manual-record', timeline: [], evidence: [] };
  const pack = buildPackData(state);
  assert.equal(pack.incident.label, null);
  assert.equal(pack.bank.status, 'not-reported');
  const text = summarySections(pack).flatMap(s => s.lines).join(' ');
  assert.match(text, /record created by the owner without classification/);
  assert.doesNotMatch(text, /automatic suggestion|situation was chosen from the buttons/);
  assert.match(previewItems(state, {})[0].value, /without choosing a situation/);
});
