import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPopiaDraft, popiaText, DISCLAIMER, TBC } from '../public/shared/popia.js';
import { buildResponderSummary, normalizeHandoffPayload, STATUS_WORDS, ACK_MEANING, NOT_INCLUDED } from '../public/shared/responder.js';
import { buildPackData, defaultPackOptions } from '../public/shared/summary.js';
import { makePack } from '../public/shared/pack.js';
import { redactIncident } from '../public/shared/redact.js';

const steps = ['check_signs', 'disconnect', 'do_not_pay', 'get_help', 'keep_evidence', 'protect_backups', 'handoff'].map((id, i) => ({ id, title: `Step ${i + 1}`, state: i < 2 ? 'confirmed' : i === 2 ? 'skipped' : 'pending', at: i < 3 ? '2026-10-27T10:00:00.000Z' : null }));
const state = (extra = {}) => ({
  description: 'Our files are encrypted. Call 082 123 4567.', redacted: redactIncident('Our files are encrypted. Call 082 123 4567.'), business: 'SENTINEL-BUSINESS-Acme', amount: 'SENTINEL-R 123 456',
  triage: { label: 'ransomware_suspected', confidence: 0.9 }, source: 'rules', title: 'Possible ransomware', timeline: [{ at: '2026-10-27T10:00:00.000Z', text: 'Incident started' }],
  evidence: [{ name: 'SENTINEL-proof.pdf', size: 10, type: 'application/pdf', sha256: 'ab'.repeat(32), addedAt: '2026-10-27T10:05:00.000Z' }], guideReviewed: false, steps,
  handoff: { discoveredAt: 'Monday 08:00', affected: 'server', affectedNote: 'finance share', reference: 'CAS 123/10/2026', outcome: 'pending', followUp: 'Call Thursday' }, ...extra,
});
const pack = async (extra, options) => makePack(buildPackData(state(extra), { ...defaultPackOptions(state(extra)), includeHandoff: true, includeBusiness: true, includeAmount: true, ...options }));

test('the POPIA draft says what it is, first and last: a template for the information officer, not legal advice', async () => {
  const draft = buildPopiaDraft(await pack()); const text = popiaText(draft);
  assert.match(text, /TEMPLATE FOR THE INFORMATION OFFICER TO REVIEW\. NOT LEGAL ADVICE\./);
  assert.equal(draft.sections[0].lines[0], DISCLAIMER); assert.equal(draft.sections.at(-1).lines[0], DISCLAIMER);
  assert.equal((text.match(/NOT LEGAL ADVICE/g) ?? []).length, 2);
  assert.match(text, /Mgadi cannot tell whether personal information was affected/);
});

test('it never asserts that a breach happened or that a notification is required: that decision is left to the information officer', async () => {
  const text = popiaText(buildPopiaDraft(await pack()));
  assert.match(text, /Decision for the information officer \(Mgadi cannot make it\)/); assert.match(text, /\[ \] Yes {3}\[ \] No {3}\[ \] Not yet known/);
  assert.doesNotMatch(text, /you (must|are required to|have to) (notify|report)|a (breach|compromise) (has|did) (occurred|happen)|(?<!believe (?:that )?)personal information (was|has been) (accessed|stolen|compromised)/i);
  assert.match(text, /not a finding that a compromise happened/);
});

test('everything Mgadi does not know is a visible blank, and typed details fill the right places', async () => {
  const blank = popiaText(buildPopiaDraft(await pack())); assert.ok((blank.match(/\[to be completed by the information officer\]/g) ?? []).length >= 12);
  const filled = popiaText(buildPopiaDraft(await pack(), { responsibleParty: 'Test Co (Pty) Ltd', officerName: 'Nomsa IO', officerContact: 'io@example.test', categories: 'customer names', count: '12' }));
  for (const value of ['Test Co (Pty) Ltd', 'Nomsa IO', 'io@example.test', 'customer names', '12']) assert.ok(filled.includes(value), value);
  assert.ok(popiaText(buildPopiaDraft(await pack(), { responsibleParty: '' })).includes(TBC));
});

test('it follows what public guidance says section 22 and the Regulator\'s form ask for, and tells the reader to check the current form', async () => {
  const text = popiaText(buildPopiaDraft(await pack()));
  for (const must of ['Part A', 'Part B', 'Part C', 'Date of the compromise', 'Reason for any delay', 'Type of compromise', 'Number of people', 'Status of the compromise', 'Potential', 'possible consequences', 'recommend', 'identity of the person or group', 'as soon as reasonably possible', 'eServices portal', 'must be registered', 'Security Compromise Notification form \\(SCN1\\)', 'Impact', 'retrieved or secured', 'sample of each notice']) assert.match(text, new RegExp(must, 'i'), must);
  assert.match(text, /which route applies today, and do not rely on this template for it/);
  assert.doesNotMatch(text, /\[x\]/i, 'Mgadi ticks nothing: every box is left for the information officer');
});

test('it is built from the pack only: the business name, amount and evidence names never appear', async () => {
  const p = await pack(); assert.match(JSON.stringify(p), /SENTINEL-BUSINESS/, 'the pack itself holds them (opt-in), so the test is meaningful');
  const text = popiaText(buildPopiaDraft(p));
  for (const s of ['SENTINEL-BUSINESS', 'SENTINEL-R', 'SENTINEL-proof', '082 123 4567']) assert.ok(!text.includes(s), s);
  assert.match(text, /Evidence fingerprints in the pack: 1\./); assert.match(text, /Step "Step 1": reported by the owner\./); assert.match(text, /Step "Step 3": skipped by the owner\./);
});

test('it copes with a minimal pack and with hostile fields, and never inserts markup', async () => {
  const minimal = popiaText(buildPopiaDraft({})); assert.match(minimal, /NOT LEGAL ADVICE/); assert.match(minimal, /Step details were not included/);
  const hostile = popiaText(buildPopiaDraft({ incident: { title: '<img src=x onerror=1>\u202eEvil' }, story: { text: '<script>alert(1)</script>' }, handoff: { typedByOwner: { discoveredAt: '<b>x</b>' }, actions: [{ step: '<i>y</i>', status: '__proto__' }] } }, { responsibleParty: '<svg onload=1>' }));
  assert.doesNotMatch(hostile, /[<>\u202e]/); assert.match(hostile, /not reported/);
});

test('the responder summary is smaller than the pack and says exactly what is left out', async () => {
  const p = await pack(); const s = buildResponderSummary(p); const text = s.lines.join('\n');
  assert.ok(s.lines.includes(NOT_INCLUDED)); assert.match(NOT_INCLUDED, /Not included: .*the business name, any amount, and evidence file names or fingerprints/);
  for (const secret of ['SENTINEL-BUSINESS', 'SENTINEL-R', 'SENTINEL-proof', '082 123 4567', 'abababab', 'Our files are encrypted']) assert.ok(!text.includes(secret), secret);
  assert.match(text, /Possible ransomware/); assert.match(text, /Step "Step 1": reported by the owner/); assert.match(text, /Reference number the owner typed \(Mgadi cannot check it\): CAS 123\/10\/2026/);
  assert.match(text, /Evidence files fingerprinted on the owner's device: 1\. The files themselves were never uploaded\./); assert.match(text, /A tap is the owner's own report/);
  assert.ok(text.length < 3500, 'small enough to seal');
});

test('without step details the summary says so instead of inventing any', async () => {
  const p = await pack({}, { includeHandoff: false }); const text = buildResponderSummary(p).lines.join('\n');
  assert.match(text, /The owner chose not to include step details/); assert.doesNotMatch(text, /reported by the owner\./);
});

test('statuses never say accepted: draft, sent and acknowledged are the only three, with honest wording', () => {
  assert.deepEqual(Object.keys(STATUS_WORDS), ['draft', 'sent', 'acknowledged']);
  assert.match(STATUS_WORDS.sent, /cannot tell whether it was delivered or opened/); assert.match(STATUS_WORDS.acknowledged, /does not mean they accepted the work/);
  assert.match(ACK_MEANING, /does not mean you have accepted any work/);
  for (const text of [...Object.values(STATUS_WORDS), ACK_MEANING]) assert.doesNotMatch(text.replace(/does not mean[^.]*\./gi, ''), /\baccepted\b|\bwill help\b|\bhas agreed\b|\bis helping\b/i);
});

test('a handoff payload from a link is accepted only in the exact shape, and re-cleaned', () => {
  const good = { v: 1, type: 'handoff', from: 'Owner', summary: { title: 'T', lines: ['one', 'two'] } };
  assert.ok(normalizeHandoffPayload(good));
  for (const bad of [null, [], 'x', { ...good, v: 2 }, { ...good, type: 'supplier-check' }, { ...good, summary: null }, { ...good, summary: { lines: 'no' } }, { ...good, summary: { title: 'T', lines: [] } }, { ...good, summary: { title: 'T', lines: ['', '   ', 5, null] } }]) assert.equal(normalizeHandoffPayload(bad), null);
  const hostile = normalizeHandoffPayload({ ...good, from: '<b>x</b>\u202e', summary: { title: '<h1>t</h1>', lines: Array.from({ length: 100 }, () => '<img src=x onerror=1>' + 'z'.repeat(900)) } });
  assert.doesNotMatch(JSON.stringify(hostile), /[<>\u202e]/); assert.equal(hostile.summary.lines.length, 40); assert.ok(hostile.summary.lines.every((l) => l.length <= 400));
});
