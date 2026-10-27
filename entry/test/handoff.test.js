import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPackData, defaultPackOptions, previewItems, summarySections, sanitizeHandoff, actionsFrom, referenceOk, PACK_FORMAT } from '../public/shared/summary.js';
import { makePack, verifyPack } from '../public/shared/pack.js';
import { redactIncident } from '../public/shared/redact.js';

const steps = (states) => ['check_signs', 'disconnect', 'do_not_pay', 'get_help', 'keep_evidence', 'protect_backups', 'handoff']
  .map((id, i) => ({ id, title: `Step ${i + 1} ${id}`, state: states[i] ?? 'pending', at: states[i] ? '2026-10-27T10:0' + i + ':00.000Z' : null }));
const base = (extra = {}) => ({
  description: 'All our files show a note.', redacted: redactIncident('All our files show a note.'), business: '', amount: '',
  triage: { label: 'ransomware_suspected', confidence: 0.9 }, source: 'rules', title: 'Possible ransomware',
  timeline: [{ at: '2026-10-27T10:00:00.000Z', text: 'Incident started' }], evidence: [], guideReviewed: false,
  steps: steps(['confirmed', 'confirmed', 'skipped']), ...extra,
});
const typed = { discoveredAt: 'Monday morning, about 08:00', affected: 'server', affectedNote: 'Shared drive, finance folder', reference: 'CAS 123/10/2026', outcome: 'pending', followUp: 'Call back Thursday' };

test('pack format is /3 and older /2 packs still verify (the checksum is over whatever the pack holds)', async () => {
  assert.equal(PACK_FORMAT, 'mgadi-incident-pack/3');
  const old = await makePack({ format: 'mgadi-incident-pack/2', generatedAt: '2026-10-01T00:00:00.000Z', story: { version: 'masked', text: 'x' } });
  assert.equal(await verifyPack(old), true);
  assert.equal(await verifyPack({ ...old, story: { version: 'masked', text: 'y' } }), false);
});

test('nothing is typed: no handoff is offered by default, and a pack without it has no handoff key at all', () => {
  const s = base();
  assert.equal(sanitizeHandoff(undefined), null); assert.equal(sanitizeHandoff({}), null); assert.equal(sanitizeHandoff('x'), null);
  assert.equal(sanitizeHandoff({ outcome: 'unknown', affected: '' }), null, 'only defaults entered means nothing entered');
  assert.equal(defaultPackOptions(s).includeHandoff, false);
  const pack = buildPackData(s, defaultPackOptions(s));
  assert.equal(Object.hasOwn(pack, 'handoff'), false);
  assert.match(previewItems(s, defaultPackOptions(s)).find((i) => i.id === 'handoff').value, /Not included/);
});

test('typed details are included only when the owner opts in, and then only the sanitized fields', () => {
  const s = base({ handoff: { ...typed, injected: 'surprise', __proto__x: 1 } });
  assert.equal(defaultPackOptions(s).includeHandoff, true);
  const off = buildPackData(s, { ...defaultPackOptions(s), includeHandoff: false });
  assert.equal(Object.hasOwn(off, 'handoff'), false);
  assert.doesNotMatch(JSON.stringify(off), /finance folder|CAS 123|Thursday/);
  const on = buildPackData(s, { ...defaultPackOptions(s), includeHandoff: true });
  assert.deepEqual(Object.keys(on.handoff.typedByOwner).sort(), ['affected', 'affectedNote', 'discoveredAt', 'followUp', 'outcome', 'reference']);
  assert.doesNotMatch(JSON.stringify(on), /surprise|injected/);
  assert.equal(on.handoff.typedByOwner.reference, 'CAS 123/10/2026');
});

test('free text is bounded, stripped of markup and control characters, and masked like the story', () => {
  const out = sanitizeHandoff({
    discoveredAt: `Call me on 082 123 4567 or a@b.co ${'x'.repeat(200)}`,
    affectedNote: '<img src=x onerror=alert(1)>\u0000\u0007 note R70 000',
    followUp: 'See https://evil.example/login now',
    affected: 'server', outcome: 'pending',
  });
  assert.ok(out.discoveredAt.length <= 60, 'discoveredAt bounded');
  assert.match(out.discoveredAt, /\[PHONE\]/); assert.doesNotMatch(out.discoveredAt, /082 123|a@b\.co/);
  assert.doesNotMatch(out.affectedNote, /[<>\u0000\u0007]/);
  assert.match(out.affectedNote, /\[AMOUNT\]/);
  assert.match(out.followUp, /\[LINK\]/); assert.doesNotMatch(out.followUp, /evil\.example/);
  assert.ok(out.affectedNote.length <= 120 && out.followUp.length <= 120);
});

test('unknown choices fall back safely: an unknown "affected" is blank and an unknown outcome stays unknown, never good', () => {
  const out = sanitizeHandoff({ affected: 'a-rogue-value', outcome: 'resolved', reference: 'Ref 1', followUp: 'x' });
  assert.equal(out.affected, ''); assert.equal(out.outcome, 'unknown');
  for (const hostile of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const o = sanitizeHandoff({ affected: hostile, outcome: hostile, followUp: 'x' });
    assert.equal(o.affected, ''); assert.equal(o.outcome, 'unknown');
  }
});

test('a reference number is kept exactly, but anything odd or account-like is refused', () => {
  for (const ok of ['CAS 123/10/2026', 'FRD-2026-0012345', 'Ref 12345678', 'INC0012345', 'ABC123']) assert.equal(referenceOk(ok), true, ok);
  for (const bad of ['<script>alert(1)</script>', 'a'.repeat(41), '', '   ', '12345678', '1234 5678 90', '4111 1111 1111 1111', '0821234567', 'ref;drop', 'ref\nline']) assert.equal(referenceOk(bad), false, JSON.stringify(bad));
  assert.equal(sanitizeHandoff({ reference: '4111 1111 1111 1111', followUp: 'x' }).reference, '');
  const preview = previewItems(base({ handoff: { reference: '0821234567', followUp: 'x' } }), { includeHandoff: true, includeOriginal: false }).find((i) => i.id === 'handoff').value;
  assert.match(preview, /Reference number NOT included/); assert.doesNotMatch(preview, /0821234567/);
});

test('a tap is recorded as "reported by the owner", never as completed or confirmed done', () => {
  const actions = actionsFrom(base().steps);
  assert.deepEqual(actions.map((a) => a.status).slice(0, 4), ['reported-by-owner', 'reported-by-owner', 'skipped-by-owner', 'not-reported']);
  assert.ok(actions.every((a) => ['reported-by-owner', 'skipped-by-owner', 'not-reported'].includes(a.status)));
  const text = JSON.stringify(buildPackData(base({ handoff: typed }), { ...defaultPackOptions(base()), includeHandoff: true }).handoff);
  assert.doesNotMatch(text, /"status":"(completed|done|verified|confirmed|success)/i);
  assert.match(text, /cannot confirm it happened or that it worked/);
  assert.equal(actions[3].reportedAt, null, 'a step nobody tapped has no time');
});

test('hostile step data cannot invent a completed step or inject markup', () => {
  const actions = actionsFrom([{ id: 'x', title: '<b>Pay now</b>\u0000', state: 'completed', at: 'now' }, { id: 'y', title: 'ok', state: '__proto__' }, null, ...Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, title: `t${i}`, state: 'confirmed', at: 'z' }))].filter(Boolean));
  assert.equal(actions[0].status, 'not-reported'); assert.equal(actions[1].status, 'not-reported');
  assert.doesNotMatch(actions[0].step, /[<>\u0000]/);
  assert.ok(actions.length <= 20);
  assert.deepEqual(actionsFrom(undefined), []); assert.deepEqual(actionsFrom('nope'), []);
});

test('the bank contact and the referral line say only what happened: showing a contact is not a referral', () => {
  const none = buildPackData(base(), { includeHandoff: true, includeOriginal: false }).handoff;
  assert.equal(none.contacts.bank.status, 'not-reported');
  const called = buildPackData(base({ bankReportedAt: '2026-10-27T10:02:00.000Z' }), { includeHandoff: true, includeOriginal: false }).handoff;
  assert.deepEqual(called.contacts.bank, { status: 'reported-by-owner', at: '2026-10-27T10:02:00.000Z' });
  assert.match(none.contacts.referral, /No referral was made/); assert.match(none.contacts.referral, /does not mean anyone has accepted/);
});

test('remaining steps list exactly what the owner has not reported, and the outcome defaults to unknown', () => {
  const h = buildPackData(base(), { includeHandoff: true, includeOriginal: false }).handoff;
  assert.equal(h.remainingSteps.length, 5);
  assert.ok(h.remainingSteps[0].startsWith('Step 3'), 'a skipped step is still remaining');
  assert.equal(h.outcome.status, 'unknown'); assert.match(h.outcome.meaning, /not the same as no loss/);
  const all = buildPackData(base({ steps: steps(Array(7).fill('confirmed')) }), { includeHandoff: true, includeOriginal: false });
  assert.deepEqual(all.handoff.remainingSteps, []);
  assert.match(JSON.stringify(summarySections(all)), /Every step has been reported by the owner/);
});

test('ransomware gets a specialist summary built only from taps and typed words, with no payment claim', () => {
  const pack = buildPackData(base({ handoff: typed }), { includeHandoff: true, includeOriginal: false });
  const lines = pack.handoff.specialistSummary.lines.join('\n');
  assert.match(lines, /Affected: a server or shared drive\. Owner's note: Shared drive, finance folder/);
  assert.match(lines, /First noticed: Monday morning, about 08:00 \(as typed by the owner\)/);
  assert.match(lines, /Looked at the screen and noted signs: reported by the owner \(a tap\)/);
  assert.match(lines, /Told not to pay or reply to the attackers: skipped by the owner\. Mgadi did not ask whether any payment was made\./);
  assert.match(lines, /Contacted a specialist: not reported/);
  assert.match(lines, /No encrypted file, ransom note or private document is included/);
  assert.doesNotMatch(lines, /paid|payment was made\b(?!\.)/i);
  const section = summarySections(pack).find((s) => s.heading === 'Handoff for an IT or security specialist');
  assert.ok(section, 'summary has the specialist heading');
  assert.match(section.lines.join(' '), /Reference number the owner typed \(Mgadi cannot check it\): CAS 123\/10\/2026/);
  assert.match(section.lines.join(' '), /Next follow-up \(as typed by the owner\): Call back Thursday/);
  // A non-ransomware incident gets the plain Handoff section and no specialist block.
  const other = buildPackData(base({ triage: { label: 'payment_diversion', confidence: 0.9 }, handoff: typed }), { includeHandoff: true, includeOriginal: false });
  assert.equal(Object.hasOwn(other.handoff, 'specialistSummary'), false);
  assert.ok(summarySections(other).some((s) => s.heading === 'Handoff'));
});

test('handoff content is covered by the pack checksum, so editing it is detected', async () => {
  const pack = await makePack(buildPackData(base({ handoff: typed }), { includeHandoff: true, includeOriginal: false }));
  assert.equal(await verifyPack(pack), true);
  const edit = (fn) => { const copy = structuredClone(pack); fn(copy); return copy; };
  assert.equal(await verifyPack(edit((p) => { p.handoff.outcome.status = 'confirmed'; })), false);
  assert.equal(await verifyPack(edit((p) => { p.handoff.actions[2].status = 'reported-by-owner'; })), false);
  assert.equal(await verifyPack(edit((p) => { p.handoff.typedByOwner.reference = 'CAS 999/10/2026'; })), false);
  assert.equal(await verifyPack(edit((p) => { delete p.handoff; })), false);
});

test('nothing in the handoff is ever drawn from the private original words unless the owner asked for them', () => {
  const s = base({ description: 'My PIN is 5521 and I phoned 082 123 4567', redacted: redactIncident('My PIN is 5521 and I phoned 082 123 4567'), handoff: typed });
  const pack = buildPackData(s, { includeHandoff: true, includeOriginal: false });
  assert.doesNotMatch(JSON.stringify(pack), /5521|082 123 4567/);
});
