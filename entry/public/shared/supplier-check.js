// Supplier payment-change check: logic only, no screens.
//
// Mgadi does NOT hold, release or block any payment, and nothing here can. The check helps the owner and a second person decide
// BEFORE they pay. Every statement in a record is something a person reported; Mgadi cannot confirm any of them.
import { cleanLine, isPlainObject } from './text.js';
import { makePack } from './pack.js';

export const CHANGED = Object.freeze({ bank_account: 'the bank account number', account_name: 'the name on the account', bank_branch: 'the bank or branch', contact: 'the email address or phone number', payment_terms: 'how or when to pay', other: 'something else' });
export const ARRIVED = Object.freeze({ email: 'an email', whatsapp_sms: 'a WhatsApp or text message', phone_call: 'a phone call', letter: 'a letter or invoice', in_person: 'in person', portal: "the supplier's online portal", other: 'another way' });
export const QUESTIONS = Object.freeze({
  urgent: 'It said to pay urgently, or today',
  dont_call: 'It asked me not to phone, or to reply by message only',
  new_name: 'The account holder name is different from the supplier',
  personal_account: 'It is a personal account for a business supplier',
  odd_sender: 'The sender address, number or wording looks slightly different from before',
  first_time: 'This is the first time this supplier has ever changed its details',
});
export const NUMBER_SOURCE = Object.freeze({
  old_invoice: 'an old invoice or contract',
  previous_payment: 'the records of an earlier payment',
  my_contacts: 'my own contacts, saved before this request',
  from_request: 'the message or request itself',
  searched_online: 'something I just found online',
  unsure: 'I am not sure',
});
export const INDEPENDENT_SOURCES = Object.freeze(['old_invoice', 'previous_payment', 'my_contacts']);
export const RESULT = Object.freeze({
  confirmed: 'They confirmed that they asked for the change',
  denied: 'They said they did NOT ask for any change',
  no_answer: 'I could not reach them',
  unsure: 'I am not sure what they meant',
});
export const DECISIONS = Object.freeze(['approved', 'rejected']);

export const NOT_A_BLOCK = 'Mgadi cannot stop, block or release a payment. You decide, and you pay through your own bank.';
export const AUDIT_STATEMENT = 'This is a record of what people reported. Mgadi does not hold, release or block payments and cannot confirm any statement in it. The fingerprint shows whether the record changed after it was made. It is not a signature and does not prove who said what.';

const hasString = (v) => typeof v === 'string';

export function normalizeRequest(input) {
  const source = isPlainObject(input) ? input : {};
  const errors = [];
  const supplier = cleanLine(source.supplier, 80); if (!supplier) errors.push('supplier');
  const changed = hasString(source.changed) && Object.hasOwn(CHANGED, source.changed) ? source.changed : ''; if (!changed) errors.push('changed');
  const arrived = hasString(source.arrived) && Object.hasOwn(ARRIVED, source.arrived) ? source.arrived : ''; if (!arrived) errors.push('arrived');
  const flags = Array.isArray(source.flags) ? [...new Set(source.flags.filter((f) => hasString(f) && Object.hasOwn(QUESTIONS, f)))].slice(0, 10) : [];
  return { value: { supplier, changed, arrived, amount: cleanLine(source.amount, 30), note: cleanLine(source.note, 200), flags }, errors };
}

const PRESSURE = /\b(urgent(ly)?|immediately|asap|today only|right now|don'?t (call|phone)|do not (call|phone)|keep (this|it) (confidential|secret|quiet)|new account|only (email|reply|message)|final notice)\b/i;

// Red flags are prompts to verify, never a verdict. High first.
export function redFlags(request) {
  const flags = [];
  if (['bank_account', 'account_name', 'bank_branch'].includes(request.changed)) flags.push({ id: 'bank_change', level: 'high', text: 'The banking details changed.', why: 'Changed banking details are how most payment scams work.' });
  if (['email', 'whatsapp_sms', 'phone_call'].includes(request.arrived)) flags.push({ id: 'channel', level: 'high', text: `The change arrived by ${ARRIVED[request.arrived]}.`, why: 'These can be faked or sent from a hacked account. The message cannot vouch for itself.' });
  else if (['letter', 'other'].includes(request.arrived)) flags.push({ id: 'channel', level: 'medium', text: `The change arrived by ${ARRIVED[request.arrived]}.`, why: 'A letter or invoice can be forged. Check it with the supplier another way.' });
  const level = { urgent: 'high', dont_call: 'high', new_name: 'high', odd_sender: 'high', personal_account: 'medium', first_time: 'medium' };
  for (const id of request.flags) flags.push({ id, level: level[id], text: QUESTIONS[id] + '.', why: id === 'urgent' ? 'Pressure to act quickly is a common sign of a scam.' : id === 'dont_call' ? 'A real supplier will accept a phone call on a number you already have.' : 'This is worth checking before any money moves.' });
  if (PRESSURE.test(request.note)) flags.push({ id: 'note_words', level: 'medium', text: 'Your note mentions pressure, secrecy or a new account.', why: 'Those words often appear in payment scams.' });
  const order = { high: 0, medium: 1, low: 2 };
  return flags.sort((a, b) => order[a.level] - order[b.level]);
}

export function normalizeVerification(input) {
  const source = isPlainObject(input) ? input : {};
  const errors = [];
  const who = cleanLine(source.who, 80); if (!who) errors.push('who');
  const numberSource = hasString(source.numberSource) && Object.hasOwn(NUMBER_SOURCE, source.numberSource) ? source.numberSource : ''; if (!numberSource) errors.push('numberSource');
  const result = hasString(source.result) && Object.hasOwn(RESULT, source.result) ? source.result : ''; if (!result) errors.push('result');
  if (source.calledMyself !== true) errors.push('calledMyself');
  const calledAt = hasString(source.calledAt) && !Number.isNaN(Date.parse(source.calledAt)) ? new Date(source.calledAt).toISOString() : ''; if (!calledAt) errors.push('calledAt');
  return { value: { who, numberSource, independent: INDEPENDENT_SOURCES.includes(numberSource), result, calledMyself: source.calledMyself === true, calledAt, note: cleanLine(source.note, 140) }, errors };
}

// What the record supports, in plain words. "verified_independent" means the owner REPORTS a call on a number they already had.
export function verdict(verification) {
  if (!verification) return { state: 'not_verified', text: 'Not verified. Verify before paying.' };
  if (verification.result === 'denied') return { state: 'denied', text: 'The supplier says they did NOT ask for this change. Do not pay to the new details. This looks like fraud. If you have already paid, go to the bank first.' };
  if (!verification.independent) return { state: 'not_independent', text: 'This call does not count as independent: the number did not come from something you already had before this request. Find a number from an old invoice, contract or earlier payment, and call that.' };
  if (verification.result === 'confirmed') return { state: 'verified_independent', text: 'You report that you phoned a number you already had and the supplier confirmed the change. Mgadi cannot check that.' };
  return { state: 'not_verified', text: 'Not verified yet. Keep trying a number you already had. Do not pay to the new details until you have reached them.' };
}

export function normalizeCheckPayload(input) {
  if (!isPlainObject(input) || input.v !== 1 || input.type !== 'supplier-check') return null;
  const request = normalizeRequest(input.request); if (request.errors.length) return null;
  const verification = normalizeVerification(input.verification); if (verification.errors.length) return null;
  return { v: 1, type: 'supplier-check', request: request.value, verification: verification.value };
}

export function normalizeDecisionNote(input) {
  const source = isPlainObject(input) ? input : {};
  return { by: cleanLine(source.by, 60), note: cleanLine(source.note, 140) };
}

export function buildCheckAudit({ payload, decision, checkId, createdAt }) {
  const request = normalizeRequest(payload.request).value;
  const verification = normalizeVerification(payload.verification).value;
  const flags = redFlags(request);
  const data = {
    format: 'mgadi-supplier-check/1',
    checkId,
    createdAt,
    request,
    redFlags: flags.map((f) => ({ id: f.id, level: f.level, text: f.text })),
    verification,
    ...(payload.comparison ? { comparison: payload.comparison } : {}),
    ...(payload.evidence ? { evidence: payload.evidence } : {}),
    verdict: verdict(verification),
    secondPerson: decision
      ? { status: decision.status, decidedAt: decision.at, by: decision.by ?? '', note: decision.note ?? '', recordedBy: "Mgadi's server clock; the person is identified only by what they typed" }
      : { status: 'pending', decidedAt: null, by: '', note: '', recordedBy: null },
    statement: AUDIT_STATEMENT,
  };
  return makePack(data);
}
