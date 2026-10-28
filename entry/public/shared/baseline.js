// Supplier banking-details comparison: the details the owner ALREADY HELD (a trusted baseline they entered from a separate
// source) against the details in the new request. Deterministic text and digit comparison, nothing more.
//
// What this does NOT do: it cannot tell whether the trusted details are genuine, whether the new details belong to the supplier, or
// whether a bank account exists. A "same" result is not proof of legitimacy and a "different" result is not proof of fraud.
// Full account numbers stay in the browser's memory: everything that is stored, shared or exported carries only the last four digits.
import { cleanLine, isPlainObject } from './text.js';
import { redFlags } from './supplier-check.js';

export const BASELINE_SOURCE = Object.freeze({
  contract: 'a contract or an earlier invoice',
  paid_before: 'the records of an earlier payment to this supplier',
  saved_record: 'my saved supplier record from before this request',
  from_request: 'the same message or request',
  unsure: 'I am not sure',
});
export const BASELINE_INDEPENDENT = Object.freeze(['contract', 'paid_before', 'saved_record']);
export const FIELD_LABEL = Object.freeze({ holder: 'Account holder', bank: 'Bank', account: 'Account number', branch: 'Branch code' });
const FIELD_IDS = Object.freeze(Object.keys(FIELD_LABEL));
export const STATUS_WORD = Object.freeze({ same: 'Same', different: 'Different', no_baseline: 'No trusted record to compare', not_in_request: 'Not in the request', not_given: 'Not given' });
const COMPANY_WORDS = /\b(pty|ltd|limited|cc|inc|proprietary|\(pty\)|\(ltd\))\b/g;

const digits = (value) => String(value ?? '').replace(/[\s-]/g, '');
const words = (value) => String(value ?? '').toLowerCase().replace(COMPANY_WORDS, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
export const maskAccount = (value) => { const d = digits(value).replace(/\D/g, ''); return d ? `\u2022\u2022\u2022\u2022${d.slice(-4)}` : ''; };

// One set of bank details as typed. Returns the cleaned values (account kept in full, for in-memory comparison only) and what is wrong.
export function normalizeBankDetails(input) {
  const source = isPlainObject(input) ? input : {};
  const errors = [];
  const holder = cleanLine(source.holder, 60); const bank = cleanLine(source.bank, 40);
  const accountRaw = typeof source.account === 'string' || typeof source.account === 'number' ? digits(source.account) : '';
  if (accountRaw && !/^\d{6,20}$/.test(accountRaw)) errors.push('account');
  const branchRaw = typeof source.branch === 'string' || typeof source.branch === 'number' ? digits(source.branch) : '';
  if (branchRaw && !/^\d{4,11}$/.test(branchRaw)) errors.push('branch');
  return { value: { holder, bank, account: errors.includes('account') ? '' : accountRaw, branch: errors.includes('branch') ? '' : branchRaw }, errors };
}
export const hasAny = (details) => FIELD_IDS.some((id) => Boolean(details?.[id]));

function same(id, a, b) {
  if (id === 'holder' || id === 'bank') return words(a) === words(b);
  return digits(a) === digits(b);
}
const shown = (id, value) => (id === 'account' ? maskAccount(value) : cleanLine(value, 60));

// rows: one per field either side gave. Never contains a full account number.
export function compareDetails(baseline, proposed, baselineSource = '') {
  const rows = FIELD_IDS.map((id) => {
    const a = baseline?.[id] ?? ''; const b = proposed?.[id] ?? '';
    let status;
    if (!a && !b) status = 'not_given'; else if (!a) status = 'no_baseline'; else if (!b) status = 'not_in_request'; else status = same(id, a, b) ? 'same' : 'different';
    return { id, label: FIELD_LABEL[id], status, baseline: shown(id, a), proposed: shown(id, b) };
  }).filter((row) => row.status !== 'not_given');
  const source = Object.hasOwn(BASELINE_SOURCE, baselineSource) ? baselineSource : '';
  return { baselineSource: source, independentBaseline: BASELINE_INDEPENDENT.includes(source), rows };
}

// What a link or a record may carry: strict shape, known ids and statuses, short cleaned text, account numbers cut to the last four digits.
export function normalizeComparison(input) {
  if (!isPlainObject(input) || !Array.isArray(input.rows)) return null;
  const rows = [];
  for (const row of input.rows.slice(0, 4)) {
    if (!isPlainObject(row) || typeof row.id !== 'string' || !Object.hasOwn(FIELD_LABEL, row.id) || typeof row.status !== 'string' || !Object.hasOwn(STATUS_WORD, row.status)) continue;
    if (rows.some((r) => r.id === row.id)) continue;
    const clip = (v) => (row.id === 'account' ? maskAccount(cleanLine(v, 40)) : cleanLine(v, 60));
    rows.push({ id: row.id, label: FIELD_LABEL[row.id], status: row.status, baseline: clip(row.baseline), proposed: clip(row.proposed) });
  }
  if (!rows.length) return null;
  const baselineSource = typeof input.baselineSource === 'string' && Object.hasOwn(BASELINE_SOURCE, input.baselineSource) ? input.baselineSource : '';
  return { baselineSource, independentBaseline: BASELINE_INDEPENDENT.includes(baselineSource), rows };
}

// Extra red flags that come from the comparison. High first, merged with the flags from the request itself.
export function comparisonFlags(comparison) {
  const flags = []; const rows = comparison?.rows ?? []; const row = (id) => rows.find((r) => r.id === id);
  if (row('account')?.status === 'different') flags.push({ id: 'account_differs', level: 'high', text: 'The account number in the request is different from the trusted details you entered.', why: 'A changed account with the same supplier name is the classic payment-diversion pattern.' });
  if (row('holder')?.status === 'different') flags.push({ id: 'holder_differs', level: 'high', text: 'The account holder name is different from the trusted details you entered.', why: 'Paying into an account in another name is a common sign of a scam.' });
  if (row('bank')?.status === 'different') flags.push({ id: 'bank_differs', level: 'medium', text: 'The bank is different from the trusted details you entered.', why: 'Suppliers rarely change bank without saying so by a channel you already know.' });
  if (row('branch')?.status === 'different') flags.push({ id: 'branch_differs', level: 'medium', text: 'The branch code is different from the trusted details you entered.', why: 'Worth checking together with the account number.' });
  if (comparison && !comparison.independentBaseline) flags.push({ id: 'baseline_weak', level: 'medium', text: 'The trusted details did not come from a source that existed before this request.', why: 'A comparison with details copied from the same message tells you nothing.' });
  return flags;
}

const ORDER = { high: 0, medium: 1, low: 2 };
export function allFlags(request, comparison) {
  return [...redFlags(request), ...comparisonFlags(comparison)].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}

// What the comparison supports, in plain words. Never "genuine", never "safe".
export function comparisonVerdict(comparison) {
  if (!comparison) return { state: 'none', text: 'No trusted details were entered, so nothing was compared. Verify before paying.' };
  const rows = comparison.rows; const diff = rows.filter((r) => r.status === 'different');
  if (diff.length) return { state: 'different', text: `${diff.length === 1 ? 'One detail differs' : `${diff.length} details differ`} from the trusted record you entered (${diff.map((r) => r.label.toLowerCase()).join(', ')}). Verify before paying.` };
  if (rows.some((r) => r.status === 'same') && !rows.some((r) => r.status === 'no_baseline' || r.status === 'not_in_request')) return { state: 'same', text: 'Nothing differs from the trusted record you entered. That does not make the request genuine: details can be copied. Verify before paying.' };
  return { state: 'incomplete', text: 'Some details could not be compared. Verify before paying.' };
}

// Where the independent check stands, in one line, for the top of the result and the approver's page.
export function independentStatus(verification) {
  if (!verification) return 'Independent check: not recorded yet.';
  if (!verification.independent) return 'Independent check: recorded, but the number did not come from before the request, so it does not count.';
  return `Independent check: reported by the owner (${verification.result === 'confirmed' ? 'the supplier confirmed' : verification.result === 'denied' ? 'the supplier denied it' : 'no confirmation'}). Mgadi cannot check the call.`;
}

// A synthetic example for demonstrations. Clearly fictional.
export const SYNTHETIC_EXAMPLE = Object.freeze({
  supplier: 'Example Packaging (Pty) Ltd (synthetic)',
  baseline: { holder: 'Example Packaging (Pty) Ltd', bank: 'Test Bank', account: '1234567890', branch: '123456' },
  proposed: { holder: 'Example Packaging (Pty) Ltd', bank: 'Test Bank', account: '9876501234', branch: '123456' },
  note: 'Our bank details have changed. Please pay today and do not call us, the office line is down.',
});
