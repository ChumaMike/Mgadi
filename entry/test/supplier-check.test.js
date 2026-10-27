import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CHANGED, ARRIVED, QUESTIONS, NUMBER_SOURCE, normalizeRequest, redFlags, normalizeVerification, verdict, normalizeCheckPayload, normalizeDecisionNote, buildCheckAudit, NOT_A_BLOCK, AUDIT_STATEMENT } from '../public/shared/supplier-check.js';
import { verifyPack } from '../public/shared/pack.js';

const request = (extra = {}) => normalizeRequest({ supplier: 'Test Supplier (Pty) Ltd', changed: 'bank_account', arrived: 'email', amount: 'R 70 000,00', note: '', flags: [], ...extra }).value;
const verification = (extra = {}) => normalizeVerification({ who: 'Thandi, accounts', numberSource: 'old_invoice', result: 'confirmed', calledMyself: true, calledAt: '2026-10-27T10:00:00.000Z', note: '', ...extra }).value;

test('a request needs a supplier, what changed and how it arrived; everything else is optional', () => {
  assert.deepEqual(normalizeRequest({}).errors, ['supplier', 'changed', 'arrived']);
  assert.deepEqual(normalizeRequest({ supplier: 'A', changed: 'bank_account', arrived: 'email' }).errors, []);
  assert.deepEqual(normalizeRequest({ supplier: '   ', changed: 'bank_account', arrived: 'email' }).errors, ['supplier']);
  for (const odd of [null, undefined, 'text', 5, []]) assert.deepEqual(normalizeRequest(odd).errors, ['supplier', 'changed', 'arrived']);
});

test('hostile request input is cleaned, bounded and limited to known choices', () => {
  const { value } = normalizeRequest({ supplier: '<img src=x onerror=alert(1)>\u202eAcme\u0000 ' + 'x'.repeat(300), changed: ['bank_account'], arrived: 'constructor', amount: 'R'.repeat(100), note: '<script>x</script>', flags: ['urgent', 'urgent', '__proto__', 'constructor', 5, null, 'admin'] });
  assert.ok(value.supplier.length <= 80); assert.doesNotMatch(value.supplier, /[<>\u202e\u0000]/);
  assert.equal(value.changed, '', 'an array is not a choice'); assert.equal(value.arrived, '', 'a prototype name is not a choice');
  assert.equal(value.amount.length, 30); assert.doesNotMatch(value.note, /[<>]/); assert.deepEqual(value.flags, ['urgent']);
  assert.deepEqual(Object.keys(value).sort(), ['amount', 'arrived', 'changed', 'flags', 'note', 'supplier']);
});

test('names that exist on every JavaScript object are never accepted as a choice, in any choice field', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf']) {
    const r = normalizeRequest({ supplier: 'A', changed: name, arrived: name, flags: [name] });
    assert.deepEqual(r.errors, ['changed', 'arrived'], name); assert.equal(r.value.changed, ''); assert.equal(r.value.arrived, ''); assert.deepEqual(r.value.flags, []);
    const v = normalizeVerification({ who: 'T', numberSource: name, result: name, calledMyself: true, calledAt: '2026-10-27T10:00:00.000Z' });
    assert.deepEqual(v.errors, ['numberSource', 'result'], name); assert.equal(v.value.independent, false);
  }
});

test('red flags: changed banking details arriving by email are high; the list is a prompt, never a verdict', () => {
  const flags = redFlags(request());
  assert.deepEqual(flags.map((f) => [f.id, f.level]), [['bank_change', 'high'], ['channel', 'high']]);
  for (const f of flags) assert.ok(f.text && f.why, 'each flag says what and why');
  assert.deepEqual(redFlags(request({ changed: 'contact', arrived: 'in_person' })), [], 'nothing to flag is not the same as genuine, and the screen says so');
  assert.equal(redFlags(request({ arrived: 'portal', changed: 'payment_terms' })).length, 0);
  assert.equal(redFlags(request({ arrived: 'letter' })).find((f) => f.id === 'channel').level, 'medium');
});

test('every question adds its own flag, high before medium', () => {
  const all = redFlags(request({ flags: Object.keys(QUESTIONS) }));
  for (const id of Object.keys(QUESTIONS)) assert.ok(all.some((f) => f.id === id), id);
  const levels = all.map((f) => f.level); assert.deepEqual(levels, [...levels].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a] - { high: 0, medium: 1, low: 2 }[b])));
});

test('pressure and secrecy words in the note are flagged', () => {
  for (const note of ['Please pay URGENTLY', 'do not call us', "Don't phone, email only", 'keep this confidential', 'new account effective immediately', 'final notice']) assert.ok(redFlags(request({ note })).some((f) => f.id === 'note_words'), note);
  assert.ok(!redFlags(request({ note: 'Their usual contact, Thandi, sent it' })).some((f) => f.id === 'note_words'));
});

test('verification: who, where the number came from, the result and "I called myself" are all required', () => {
  assert.deepEqual(normalizeVerification({}).errors.sort(), ['calledAt', 'calledMyself', 'numberSource', 'result', 'who']);
  assert.deepEqual(normalizeVerification({ who: 'A', numberSource: 'old_invoice', result: 'confirmed', calledMyself: false, calledAt: '2026-10-27T10:00:00Z' }).errors, ['calledMyself'], 'ticking the box is a statement, not a default');
  assert.deepEqual(normalizeVerification({ who: 'A', numberSource: 'old_invoice', result: 'confirmed', calledMyself: 'true', calledAt: '2026-10-27T10:00:00Z' }).errors, ['calledMyself'], 'a string is not true');
  assert.deepEqual(normalizeVerification({ who: 'A', numberSource: 'old_invoice', result: 'confirmed', calledMyself: true, calledAt: 'yesterday-ish' }).errors, ['calledAt']);
  assert.deepEqual(normalizeVerification({ who: 'A', numberSource: '__proto__', result: ['denied'], calledMyself: true, calledAt: '2026-10-27T10:00:00Z' }).errors.sort(), ['numberSource', 'result']);
});

test('a number counts as independent only when it was known BEFORE the request; Mgadi never stores the number itself', () => {
  for (const [source, independent] of [['old_invoice', true], ['previous_payment', true], ['my_contacts', true], ['from_request', false], ['searched_online', false], ['unsure', false]]) assert.equal(verification({ numberSource: source }).independent, independent, source);
  assert.deepEqual(Object.keys(verification()).sort(), ['calledAt', 'calledMyself', 'independent', 'note', 'numberSource', 'result', 'who']);
  assert.equal(Object.keys(NUMBER_SOURCE).length, 6);
});

test('the verdict says only what the record supports and keeps "do not pay" for a denial', () => {
  assert.equal(verdict(null).state, 'not_verified');
  assert.equal(verdict(verification()).state, 'verified_independent'); assert.match(verdict(verification()).text, /You report/); assert.match(verdict(verification()).text, /cannot check that/);
  assert.equal(verdict(verification({ numberSource: 'from_request' })).state, 'not_independent');
  const denied = verdict(verification({ result: 'denied' })); assert.equal(denied.state, 'denied'); assert.match(denied.text, /Do not pay/); assert.match(denied.text, /go to the bank first/);
  assert.equal(verdict(verification({ numberSource: 'from_request', result: 'denied' })).state, 'denied', 'a denial counts even if the number was not independent');
  assert.equal(verdict(verification({ result: 'no_answer' })).state, 'not_verified'); assert.equal(verdict(verification({ result: 'unsure' })).state, 'not_verified');
});

test('a payload read from a link is accepted only in the exact shape, and re-cleaned', () => {
  const good = { v: 1, type: 'supplier-check', request: request(), verification: verification() };
  assert.ok(normalizeCheckPayload(good));
  for (const bad of [null, [], 'x', { ...good, v: 2 }, { ...good, type: 'handoff' }, { ...good, request: {} }, { ...good, verification: { ...good.verification, calledMyself: false } }, { v: 1, type: 'supplier-check' }]) assert.equal(normalizeCheckPayload(bad), null);
  const hostile = normalizeCheckPayload({ ...good, request: { ...good.request, supplier: '<img src=x onerror=alert(1)>Evil', note: 'x'.repeat(5000), injected: 'y' } });
  assert.doesNotMatch(JSON.stringify(hostile), /<|injected/); assert.ok(hostile.request.note.length <= 200);
  assert.deepEqual(normalizeDecisionNote({ by: '<b>Me</b>', note: 'n'.repeat(999), x: 1 }), { by: 'b Me /b', note: 'n'.repeat(140) });
  assert.deepEqual(normalizeDecisionNote('nonsense'), { by: '', note: '' });
});

test('the audit record is fingerprinted, verifies, and any edit is caught', async () => {
  const payload = { v: 1, type: 'supplier-check', request: request(), verification: verification() };
  const record = await buildCheckAudit({ payload, decision: { status: 'approved', at: 1_800_000_000_000, by: 'Sipho', note: 'Looks right' }, checkId: 'abcdefghijklmnop', createdAt: 1_799_999_000_000 });
  assert.match(record.fingerprint, /^[0-9a-f]{64}$/); assert.equal(record.format, 'mgadi-supplier-check/1'); assert.equal(await verifyPack(record), true);
  assert.equal(record.secondPerson.status, 'approved'); assert.match(record.secondPerson.recordedBy, /server clock/);
  const edit = (fn) => { const copy = structuredClone(record); fn(copy); return copy; };
  for (const change of [(r) => { r.secondPerson.status = 'rejected'; }, (r) => { r.request.supplier = 'Other'; }, (r) => { r.verification.result = 'confirmed'; r.verification.independent = true; r.verification.numberSource = 'old_invoice'; r.verification.who = 'Someone else'; }, (r) => { r.statement = 'Mgadi guarantees this.'; }, (r) => { delete r.redFlags; }]) assert.equal(await verifyPack(edit(change)), false);
  const pending = await buildCheckAudit({ payload, decision: null, checkId: 'abcdefghijklmnop', createdAt: 1 }); assert.equal(pending.secondPerson.status, 'pending');
  assert.equal(record.statement, AUDIT_STATEMENT); assert.match(AUDIT_STATEMENT, /not a signature/); assert.match(AUDIT_STATEMENT, /does not hold, release or block/);
});

test('the audit record carries no phone number, no link and no key', async () => {
  const record = await buildCheckAudit({ payload: { v: 1, type: 'supplier-check', request: request({ note: 'x' }), verification: verification() }, decision: { status: 'rejected', at: 1, by: '', note: '' }, checkId: 'abcdefghijklmnop', createdAt: 1 });
  assert.doesNotMatch(JSON.stringify(record), /#mgadi|\b0\d{9}\b|\+27|token|key/i);
});

// Mgadi can never block a payment or vouch for a supplier, so no sentence in the new screens or logic may say or imply that it does.
// Negations ("cannot", "does not", "not") are the only allowed form, and they are judged ONE SENTENCE AT A TIME, so a "not" in a
// neighbouring sentence cannot excuse a claim. This is a pattern check on the source text, a safety net and not a proof: it cannot
// catch every possible phrasing, so the wording itself still needs a human reader (see PLAYBOOK-REVIEW.md).
export const RISKY_CLAIMS = [
  /\b(block(s|ed|ing)?|stop(s|ped|ping)?|hold(s|ing)?|held|release(s|d)?|prevent(s|ed|ing)?|freeze(s)?|cancel(s|led)?)\b.{0,40}\b(payment|pay|money|transfer)\b/i,
  /\b(payment|pay|money|transfer)\b.{0,40}\b(blocked|stopped|held|released|prevented|frozen|cancelled)\b/i,
  /\bon hold\b/i,
  /\b(protect(s|ed|ing)?|secure[sd]?|safeguard(s|ed)?|safe)\b.{0,40}\b(payment|pay|money|transfer|supplier)\b/i,
  /\b(payment|pay|money|transfer|supplier)\b.{0,40}\b(is|are|was|now)\b.{0,12}\b(safe|protected|secure[d]?|genuine|legitimate|trusted)\b/i,
  /\bmgadi\b.{0,30}\b(approv(es|ed)|verif(ies|ied)|confirm(s|ed)|validat(es|ed)|authori[sz](es|ed)|clear(s|ed)|guarantee[sd]?|certif(ies|ied))\b/i,
  /\b(approved|verified|confirmed|validated|authori[sz]ed|cleared) by mgadi\b/i,
  /\b(safe|ok|okay|fine|cleared) to (pay|proceed|transfer|go ahead)\b/i,
  /\byou can (now |safely |go ahead and )?(pay|proceed|transfer)\b/i,
];
const NEGATED = /\b(cannot|can't|can not|does not|doesn't|do not|don't|not|never|no)\b/i;
export const wordingOffenders = (strings) => strings.flatMap(([where, text]) => text.split(/(?<=[.!?])\s+/).filter((sentence) => RISKY_CLAIMS.some((re) => re.test(sentence)) && !NEGATED.test(sentence)).map((sentence) => [where, sentence]));

test('wording guard: nothing says or implies that Mgadi blocks, holds, protects or verifies a payment or a supplier', () => {
  const files = ['public/tools/tools.js', 'public/shared/supplier-check.js', 'public/shared/responder.js', 'public/shared/popia.js'].map((f) => [f, fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')]);
  const sentences = [];
  for (const [file, source] of files) for (const m of source.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.){12,})\1/g)) sentences.push([file, m[2]]);
  assert.ok(sentences.length > 100, 'the guard really is reading the screens');
  assert.deepEqual(wordingOffenders(sentences), []);
  assert.equal(NOT_A_BLOCK, 'Mgadi cannot stop, block or release a payment. You decide, and you pay through your own bank.');
});

test('the wording guard itself catches the phrasings it exists for, and lets the honest negations through', () => {
  for (const bad of ['Mgadi has blocked the payment.', 'Your payment is now on hold with Mgadi.', 'Mgadi has protected your payment from fraud.', 'The transfer is safe now that it is approved.', 'Approved by Mgadi. You can pay now.', 'Mgadi verified the supplier is genuine.', 'It is safe to pay.', 'The supplier is legitimate.', 'We will hold the money for you.', 'Mgadi cannot stop a payment. Mgadi has stopped the payment.'])
    assert.equal(wordingOffenders([['x', bad]]).length >= 1, true, bad);
  for (const good of ['Mgadi cannot stop, block or release a payment.', 'Mgadi has not checked who sent it.', 'Do not pay to the new details.', 'Mgadi does not hold, release or block payments and cannot confirm any statement in it.', 'You decide, and you pay through your own bank.', 'Mgadi cannot check that.'])
    assert.deepEqual(wordingOffenders([['x', good]]), [], good);
});

test('every choice list is a frozen, closed set', () => {
  for (const map of [CHANGED, ARRIVED, QUESTIONS, NUMBER_SOURCE]) { assert.ok(Object.isFrozen(map)); assert.ok(Object.keys(map).length >= 4); }
});
