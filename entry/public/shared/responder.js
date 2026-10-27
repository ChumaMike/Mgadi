// Responder handoff: a SHORT summary built from the incident pack the owner already made, shown to the owner for approval and only
// then shared by link. It is deliberately smaller than the pack. NOT included: the story, the business name, the amount, evidence
// file names or fingerprints. Statuses are draft (nothing shared) -> sent (a link was made; delivery is not known) -> acknowledged
// (the contact pressed the button). Acknowledged means "seen". It is never "accepted".
import { cleanLine, isPlainObject } from './text.js';
import { formatTime } from './summary.js';

export const STATUS_WORDS = Object.freeze({
  draft: 'Draft: nothing has been shared.',
  sent: 'Link created. Mgadi cannot tell whether it was delivered or opened.',
  acknowledged: 'Acknowledged: the contact opened the link and pressed Acknowledge. This does not mean they accepted the work.',
});
export const ACK_MEANING = 'Acknowledging only tells the sender you have seen this summary. It does not mean you have accepted any work, and Mgadi does not record that you will help.';
export const NOT_INCLUDED = 'Not included: what the owner wrote about the incident, the business name, any amount, and evidence file names or fingerprints.';

const STEP_WORD = { 'reported-by-owner': 'reported by the owner', 'skipped-by-owner': 'skipped by the owner', 'not-reported': 'not reported' };

export function buildResponderSummary(pack) {
  const lines = [];
  lines.push(`Situation suggested by Mgadi: ${cleanLine(pack?.incident?.title, 120) || 'not set'}. This is a first-step guide, not a finding.`);
  lines.push(`Summary prepared: ${formatTime(pack?.generatedAt)}.`);
  lines.push(pack?.guide?.reviewedByPractitioner ? 'The guidance used was reviewed.' : 'The guidance used is a draft that no practitioner has reviewed yet.');
  lines.push(pack?.bank?.status === 'user-reported-called' ? `The owner reports calling the bank at ${formatTime(pack.bank.reportedAt)}. Mgadi cannot confirm the bank answered or acted.` : 'The owner has not reported calling the bank in Mgadi.');
  const handoff = pack?.handoff;
  if (handoff) {
    const typed = handoff.typedByOwner;
    if (typed?.affected) lines.push(`Affected (as typed by the owner): ${cleanLine(typed.affected, 40)}${typed.affectedNote ? `, ${cleanLine(typed.affectedNote, 120)}` : ''}.`);
    if (typed?.discoveredAt) lines.push(`First noticed (as typed by the owner): ${cleanLine(typed.discoveredAt, 60)}.`);
    if (typed?.reference) lines.push(`Reference number the owner typed (Mgadi cannot check it): ${cleanLine(typed.reference, 40)}.`);
    if (typed?.followUp) lines.push(`Next follow-up (as typed by the owner): ${cleanLine(typed.followUp, 120)}.`);
    for (const action of (Array.isArray(handoff.actions) ? handoff.actions : []).slice(0, 12)) lines.push(`Step "${cleanLine(action.step, 100)}": ${STEP_WORD[action.status] ?? 'not reported'}.`);
    lines.push('A tap is the owner\'s own report. Mgadi cannot confirm that anything was done or that it worked.');
  } else {
    lines.push('The owner chose not to include step details.');
  }
  lines.push(`Evidence files fingerprinted on the owner's device: ${Array.isArray(pack?.evidence) ? pack.evidence.length : 0}. The files themselves were never uploaded.`);
  lines.push(NOT_INCLUDED);
  return { title: 'Incident summary for a helper', lines };
}

// What a contact is willing to display: a strict shape, bounded, cleaned. Anything else is refused.
export function normalizeHandoffPayload(input) {
  if (!isPlainObject(input) || input.v !== 1 || input.type !== 'handoff') return null;
  const summary = input.summary;
  if (!isPlainObject(summary) || !Array.isArray(summary.lines)) return null;
  const lines = summary.lines.slice(0, 40).filter((line) => typeof line === 'string').map((line) => cleanLine(line, 400)).filter(Boolean);
  if (!lines.length) return null;
  return { v: 1, type: 'handoff', from: cleanLine(input.from, 60), summary: { title: cleanLine(summary.title, 120) || 'Incident summary', lines } };
}
