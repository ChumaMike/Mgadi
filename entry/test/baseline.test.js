import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBankDetails, compareDetails, normalizeComparison, comparisonFlags, allFlags, comparisonVerdict, independentStatus, maskAccount, hasAny, SYNTHETIC_EXAMPLE, BASELINE_SOURCE } from '../public/shared/baseline.js';
import { normalizeFullPayload } from '../public/shared/check-record.js';
import { normalizeRequest, normalizeVerification, buildCheckAudit } from '../public/shared/supplier-check.js';
import { verifyPack } from '../public/shared/pack.js';

const norm = (d) => normalizeBankDetails(d).value;
const request = (extra = {}) => normalizeRequest({ supplier: 'S', changed: 'bank_account', arrived: 'email', ...extra }).value;
const verification = (extra = {}) => normalizeVerification({ who: 'T', numberSource: 'old_invoice', result: 'confirmed', calledMyself: true, calledAt: '2026-10-27T10:00:00.000Z', ...extra }).value;
const ex = SYNTHETIC_EXAMPLE;

test('bank details are cleaned, account numbers are digits only, and bad values are reported, not kept', () => {
  assert.deepEqual(normalizeBankDetails({ holder: ' Acme\u202e <b>(Pty)</b> Ltd ', bank: 'Test Bank', account: '1234 567-890', branch: '12 34 56' }).value, { holder: 'Acme b (Pty) /b Ltd', bank: 'Test Bank', account: '1234567890', branch: '123456' });
  for (const bad of ['12ab34', '123', '1'.repeat(25), '<script>']) { const r = normalizeBankDetails({ account: bad }); assert.deepEqual(r.errors, ['account'], bad); assert.equal(r.value.account, ''); }
  assert.deepEqual(normalizeBankDetails({ branch: 'abc' }).errors, ['branch']);
  for (const odd of [null, undefined, 'x', 5, [], { account: { a: 1 }, holder: ['x'] }]) assert.doesNotThrow(() => normalizeBankDetails(odd));
  assert.equal(normalizeBankDetails({ account: ['1234567'] }).value.account, '', 'an array is not an account number');
  assert.equal(hasAny(norm({})), false);
});

test('the synthetic example: only the account number differs, and it is a high flag in plain words', () => {
  const c = compareDetails(norm(ex.baseline), norm(ex.proposed), 'contract');
  assert.deepEqual(c.rows.map((r) => [r.id, r.status]), [['holder', 'same'], ['bank', 'same'], ['account', 'different'], ['branch', 'same']]);
  const flags = comparisonFlags(c); assert.deepEqual(flags.map((f) => [f.id, f.level]), [['account_differs', 'high']]);
  assert.match(comparisonVerdict(c).text, /One detail differs.*account number\)\. Verify before paying/);
});

test('names compare without case, punctuation or company words; accounts compare by digits only', () => {
  const c = compareDetails(norm({ holder: 'ACME  Trading (Pty) Ltd', account: '1234 5678 90' }), norm({ holder: 'Acme Trading', account: '1234567890' }), 'contract');
  assert.deepEqual(c.rows.map((r) => r.status), ['same', 'same']);
  const d = compareDetails(norm({ holder: 'Acme Trading', account: '1234567890' }), norm({ holder: 'Acme Traders', account: '1234567891' }), 'contract');
  assert.deepEqual(d.rows.map((r) => r.status), ['different', 'different']);
});

test('two accounts that only share their last four digits are different', () => {
  const c = compareDetails(norm({ account: '1234567890' }), norm({ account: '9876567890' }), 'contract');
  assert.equal(c.rows[0].status, 'different'); assert.equal(comparisonFlags(c).some((f) => f.id === 'account_differs'), true);
  assert.equal(compareDetails(norm({ account: '123456789' }), norm({ account: '1234567890' }), 'contract').rows[0].status, 'different', 'a missing digit is a difference');
});

test('missing sides are said plainly, and a comparison that is all "same" never says genuine or safe', () => {
  const c = compareDetails(norm({ account: '1234567890' }), norm({ account: '1234567890', branch: '123456' }), 'contract');
  assert.deepEqual(c.rows.map((r) => [r.id, r.status]), [['account', 'same'], ['branch', 'no_baseline']]);
  assert.equal(comparisonVerdict(c).state, 'incomplete');
  const all = compareDetails(norm(ex.baseline), norm(ex.baseline), 'contract'); const v = comparisonVerdict(all);
  assert.equal(v.state, 'same'); assert.match(v.text, /does not make the request genuine/); assert.doesNotMatch(v.text, /\b(safe|verified|confirmed|legitimate)\b/i);
  assert.equal(comparisonVerdict(null).state, 'none');
});

test('a baseline that is not from before the request is flagged as weak', () => {
  for (const [source, weak] of [['contract', false], ['paid_before', false], ['saved_record', false], ['from_request', true], ['unsure', true], ['', true], ['__proto__', true]]) {
    const c = compareDetails(norm(ex.baseline), norm(ex.proposed), source); assert.equal(comparisonFlags(c).some((f) => f.id === 'baseline_weak'), weak, source);
  }
});

test('nothing that is stored or shared carries a full account number', () => {
  const c = compareDetails(norm(ex.baseline), norm(ex.proposed), 'contract');
  const text = JSON.stringify(c); assert.doesNotMatch(text, /1234567890|9876501234/); assert.match(text, /\u2022\u2022\u2022\u20227890/); assert.equal(maskAccount('1234 5678 90'), '\u2022\u2022\u2022\u20227890');
  const hostile = normalizeComparison({ baselineSource: 'contract', rows: [{ id: 'account', status: 'different', baseline: '1234567890', proposed: '<img src=x onerror=1>9876501234' }] });
  assert.doesNotMatch(JSON.stringify(hostile), /1234567890|9876501234|<|onerror/);
});

test('a comparison read from a link is accepted only in the exact shape', () => {
  const good = compareDetails(norm(ex.baseline), norm(ex.proposed), 'contract'); assert.ok(normalizeComparison(good));
  for (const bad of [null, [], 'x', {}, { rows: 'no' }, { rows: [] }, { rows: [{ id: '__proto__', status: 'same' }] }, { rows: [{ id: 'account', status: 'constructor' }] }, { rows: [{ id: ['account'], status: 'same' }] }]) assert.equal(normalizeComparison(bad), null, JSON.stringify(bad));
  const many = normalizeComparison({ rows: Array.from({ length: 50 }, () => ({ id: 'holder', status: 'same', baseline: 'x'.repeat(500), proposed: 'y' })) }); assert.equal(many.rows.length, 1, 'one row per field');
  assert.ok(many.rows[0].baseline.length <= 60);
});

test('the full payload keeps the comparison and evidence in shape, drops anything else, and never loses the base checks', () => {
  const comparison = compareDetails(norm(ex.baseline), norm(ex.proposed), 'contract');
  const payload = { v: 1, type: 'supplier-check', request: request(), verification: verification(), comparison, evidence: { facts: [{ field: 'account', value: '9876501234', source: 'Invoice' }], files: [{ label: 'inv', sha256: 'a'.repeat(64) }], conflicts: [] }, injected: { a: 1 } };
  const out = normalizeFullPayload(payload); assert.deepEqual(Object.keys(out).sort(), ['comparison', 'evidence', 'request', 'type', 'v', 'verification']);
  assert.doesNotMatch(JSON.stringify(out), /9876501234/, 'the evidence account is masked'); assert.equal(out.evidence.facts[0].value, '\u2022\u2022\u2022\u20221234');
  assert.equal(normalizeFullPayload({ ...payload, verification: { ...payload.verification, calledMyself: false } }), null);
  assert.deepEqual(Object.keys(normalizeFullPayload({ v: 1, type: 'supplier-check', request: request(), verification: verification() })).sort(), ['request', 'type', 'v', 'verification'], 'both are optional');
});

test('the audit record carries the comparison and evidence, stays verifiable, and any edit to them is caught', async () => {
  const comparison = compareDetails(norm(ex.baseline), norm(ex.proposed), 'contract');
  const payload = normalizeFullPayload({ v: 1, type: 'supplier-check', request: request(), verification: verification(), comparison, evidence: { facts: [{ field: 'amount', value: '70000.00', source: 'Invoice' }], files: [], conflicts: [] } });
  const record = await buildCheckAudit({ payload, decision: { status: 'rejected', at: 1, by: '', note: '' }, checkId: 'abcdefghijklmnop', createdAt: 1 });
  assert.equal(record.comparison.rows.length, 4); assert.equal(record.evidence.facts[0].value, '70000.00'); assert.equal(await verifyPack(record), true);
  const edited = structuredClone(record); edited.comparison.rows[2].status = 'same'; assert.equal(await verifyPack(edited), false);
  const edited2 = structuredClone(record); edited2.evidence.facts[0].value = '1.00'; assert.equal(await verifyPack(edited2), false);
  assert.doesNotMatch(JSON.stringify(record), /1234567890|9876501234/);
});

test('flags merge with the request flags, high first; independence status never overstates', () => {
  const c = compareDetails(norm(ex.baseline), norm(ex.proposed), 'contract');
  const flags = allFlags(request({ arrived: 'email' }), c); const levels = flags.map((f) => f.level); assert.deepEqual(levels, [...levels].sort((a, b) => ({ high: 0, medium: 1 }[a] - { high: 0, medium: 1 }[b])));
  assert.ok(flags.some((f) => f.id === 'account_differs') && flags.some((f) => f.id === 'bank_change'));
  assert.match(independentStatus(null), /not recorded yet/);
  assert.match(independentStatus(verification({ numberSource: 'from_request' })), /does not count/);
  assert.match(independentStatus(verification()), /reported by the owner.*cannot check the call/);
  assert.equal(Object.keys(BASELINE_SOURCE).length, 5);
});
