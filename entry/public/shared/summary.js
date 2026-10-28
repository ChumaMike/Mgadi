// Builds the incident pack and its human-readable summary.
// Privacy-first: by default the pack carries the MASKED description. The owner's original words,
// the business name and the amount are included only when the owner chooses, after seeing a preview.
// Evidence file bytes are never included, only name, size, type and SHA-256 fingerprint.
// Format /3 adds an optional "handoff" block for a bank, an IT specialist or the police. Everything in it is either typed by the owner
// (and masked unless the owner chooses otherwise) or derived from what the owner tapped. A tap is recorded as "reported by the owner",
// never as "done", and a contact being shown is never recorded as a referral that anyone accepted.
import { redactIncident } from './redact.js';
export const PACK_FORMAT = 'mgadi-incident-pack/3';
export const PACK_WARNING = 'A matching fingerprint detects changes after capture. It does not prove a file is genuine, and it is not a digital signature.';

const SOURCE_TEXT = {
  ai: 'automatic suggestion from the Mgadi server',
  rules: 'automatic suggestion from Mgadi\'s rules',
  'offline rules': 'automatic suggestion from the rules on this phone',
  'user-selected route': 'chosen by the owner',
  'manual-record': 'record created by the owner without classification',
};

export const AFFECTED = Object.freeze({ computer: 'a computer or laptop', server: 'a server or shared drive', phone: 'a phone or tablet', email_account: 'an email account', online_account: 'another online account', bank_payment: 'a bank account or payment', other: 'something else', unsure: 'not sure' });
export const OUTCOMES = Object.freeze({
  unknown: 'Unknown. This is not the same as no loss, or a good result.',
  pending: 'Pending. The owner is waiting to hear from the bank or a specialist.',
  confirmed: 'The owner says a bank or specialist has told them the outcome.',
});
const REFERENCE = /^[A-Za-z0-9 ._/#-]{1,40}$/;
// A long number on its own looks like an account, card, phone or ID number, and the reference field is deliberately not masked.
// So a purely numeric value of 8 or more digits is refused and the owner is told why. This is a heuristic, not a guarantee.
const LOOKS_LIKE_ACCOUNT = /^[\d\s-]+$/;
export function referenceOk(value) {
  const ref = String(value ?? '').trim();
  if (!REFERENCE.test(ref)) return false;
  if (LOOKS_LIKE_ACCOUNT.test(ref) && ref.replace(/\D/g, '').length >= 8) return false;
  return true;
}

// Turns whatever the form held into a safe, bounded object. Nothing unexpected survives: unknown keys, odd characters and
// over-long text are dropped. Free text is masked with the same redaction as the story. Returns null when the owner entered nothing.
export function sanitizeHandoff(input) {
  if (!input || typeof input !== 'object') return null;
  const text = (value, max) => clean(String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ')).replace(/\s+/g, ' ').slice(0, max);
  const mask = (value, max) => { const t = text(value, max); return t ? redactIncident(t).text : ''; };
  const reference = clean(input.reference);
  const out = {
    discoveredAt: mask(input.discoveredAt, 60),
    affected: Object.hasOwn(AFFECTED, input.affected) ? input.affected : '',
    affectedNote: mask(input.affectedNote, 120),
    // A reference number is only ever what the owner typed from a real responder. It is not masked (masking would hide the very
    // number the bank asks for), it is shown in the preview, and a value with odd characters is refused.
    reference: referenceOk(reference) ? reference : '',
    followUp: mask(input.followUp, 120),
    outcome: Object.hasOwn(OUTCOMES, input.outcome) ? input.outcome : 'unknown',
  };
  const entered = out.discoveredAt || out.affected || out.affectedNote || out.reference || out.followUp || out.outcome !== 'unknown';
  return entered ? out : null;
}

const STEP_STATE = {
  confirmed: { status: 'reported-by-owner', words: 'The owner tapped that they did this. Mgadi cannot confirm it happened or that it worked.' },
  skipped: { status: 'skipped-by-owner', words: 'The owner chose to continue without doing or reporting this.' },
  needs_help: { status: 'help-requested-by-owner', words: 'The owner needs help with this step. It has not been reported as done.' },
  not_applicable: { status: 'not-applicable-by-owner', words: 'The owner marked this step not applicable. Mgadi has not verified that assessment.' },
  pending: { status: 'not-reported', words: 'Not reported yet.' },
};
// The words a person reads for each recorded outcome. None of them says that anyone was contacted or that a step worked.
const STEP_OUTCOME_WORDS = {
  'reported-by-owner': 'Done (the owner reported doing this; Mgadi cannot confirm it)',
  'help-requested-by-owner': 'Need help (the owner asked for help with this step; Mgadi did not contact anyone)',
  'not-applicable-by-owner': "Not applicable (the owner's own assessment; Mgadi has not verified it)",
  'skipped-by-owner': 'Continued without reporting this step',
  'not-reported': 'Not reported yet',
};
export function actionsFrom(steps) {
  return (Array.isArray(steps) ? steps : []).slice(0, 20).map((step) => {
    const state = Object.hasOwn(STEP_STATE, step.state) ? step.state : 'pending';
    return { step: text80(step.title), status: STEP_STATE[state].status, reportedAt: state === 'pending' ? null : (step.at ?? null), note: STEP_STATE[state].words };
  });
}
function text80(value) { return clean(value).replace(/[\u0000-\u001f\u007f<>]/g, ' ').slice(0, 120); }

// For a ransomware incident an IT specialist wants the same few facts in the same order. All of it comes from taps and from what
// the owner typed. No encrypted file, no ransom note and no private document is included or asked for.
export function specialistSummary(state, handoff, actions) {
  const done = (id) => { const step = (state.steps ?? []).find((x) => x?.id === id); return step && Object.hasOwn(STEP_STATE, step.state) ? STEP_STATE[step.state].status : 'not-reported'; };
  const word = { 'help-requested-by-owner': 'help requested by the owner', 'not-applicable-by-owner': 'marked not applicable by the owner', 'reported-by-owner': 'reported by the owner (a tap)', 'skipped-by-owner': 'skipped by the owner', 'not-reported': 'not reported' };
  const lines = [
    `Affected: ${handoff?.affected ? AFFECTED[handoff.affected] : 'not stated'}${handoff?.affectedNote ? `. Owner's note: ${handoff.affectedNote}` : ''}.`,
    `First noticed: ${handoff?.discoveredAt || 'not stated'} (as typed by the owner).`,
    `Looked at the screen and noted signs: ${word[done('check_signs')]}.`,
    `Disconnected from the network: ${word[done('disconnect')]}.`,
    `Told not to pay or reply to the attackers: ${word[done('do_not_pay')]}. Mgadi did not ask whether any payment was made.`,
    `Contacted a specialist: ${word[done('get_help')]}.`,
    `Kept the information a specialist needs: ${word[done('keep_evidence')]}.`,
    `Backups protected: ${word[done('protect_backups')]}.`,
    'No encrypted file, ransom note or private document is included or was uploaded. The owner decides what to share with a specialist.',
  ];
  return { for: 'IT or security specialist', lines, actionsCount: actions.length };
}

export function buildHandoff(state) {
  const typed = sanitizeHandoff(state.handoff);
  const actions = actionsFrom(state.steps);
  const bank = bankStatus(state);
  const handoff = {
    typedByOwner: typed,
    actions,
    contacts: {
      bank: bank.status === 'user-reported-called' ? { status: 'reported-by-owner', at: bank.reportedAt } : { status: 'not-reported', at: null },
      referral: 'No referral was made. Mgadi shows contact options only. Showing a contact does not mean anyone has accepted a request for help.',
    },
    remainingSteps: actions.filter((a) => a.status !== 'reported-by-owner').map((a) => a.step),
    outcome: { status: typed?.outcome ?? 'unknown', meaning: OUTCOMES[typed?.outcome ?? 'unknown'] },
  };
  if (state.triage?.label === 'ransomware_suspected') handoff.specialistSummary = specialistSummary(state, typed, actions);
  return handoff;
}

export function defaultPackOptions(state) {
  // The step outcomes are the owner's own taps (Done, Need help, Not applicable) and hold no free text, so once any step has been reported
  // they are in the pack by default. The owner still sees them in the preview and can untick the box before the pack is made.
  const reported = (Array.isArray(state.steps) ? state.steps : []).some((step) => step?.state && step.state !== 'pending');
  return { includeEvidence: true, includeTimeline: true, includeOriginal: false, includeBusiness: Boolean(clean(state.business)), includeAmount: Boolean(clean(state.amount)), includeHandoff: Boolean(sanitizeHandoff(state.handoff)) || reported };
}

function clean(value) { return String(value ?? '').trim(); }

export function storyFor(state, options) {
  const original = clean(state.description);
  const masked = clean(state.redacted?.text);
  if (options.includeOriginal && original) return { version: 'original', text: original };
  if (masked) return { version: 'masked', text: masked };
  return { version: 'none', text: '' };
}

export function bankStatus(state) {
  return state.bankReportedAt
    ? { status: 'user-reported-called', reportedAt: state.bankReportedAt, note: 'Reported by the owner. Mgadi cannot confirm that the bank answered or acted.' }
    : { status: 'not-reported', reportedAt: null, note: 'The owner has not reported calling the bank in Mgadi.' };
}

export function buildPackData(state, options = defaultPackOptions(state), generatedAt = new Date().toISOString()) {
  const story = storyFor(state, options);
  const data = {
    format: PACK_FORMAT,
    generatedAt,
    story,
    maskedItemCounts: state.redacted?.counts ?? {},
    incident: {
      label: state.triage?.label ?? null,
      confidence: state.triage?.confidence ?? null,
      source: state.source ?? null,
      title: state.title ?? null,
      owner_answer: state.ownerAnswer ?? null,
    },
    bank: bankStatus(state),
    guide: { reviewedByPractitioner: Boolean(state.guideReviewed), note: state.guideReviewed ? 'Reviewed.' : 'Draft guidance; practitioner review pending.' },
    timeline: options.includeTimeline === false ? [] : state.timeline ?? [],
    evidence: options.includeEvidence === false ? [] : state.evidence ?? [],
    warning: PACK_WARNING,
  };
  if (options.includeHandoff) data.handoff = buildHandoff(state);
  if (options.includeBusiness && clean(state.business)) data.business = clean(state.business);
  if (options.includeAmount && clean(state.amount)) data.amount = clean(state.amount);
  return data;
}

// What the owner will be told is inside the pack, shown before it is made.
export function previewItems(state, options) {
  const story = storyFor(state, options);
  const items = [];
  items.push({ id: 'story', label: story.version === 'original' ? 'Your own words, exactly as typed' : story.version === 'masked' ? 'Your description with personal details hidden' : 'Description', value: story.text || (state.source === 'manual-record' ? 'Nothing typed: the owner started a record without choosing a situation.' : 'Nothing typed: the situation was chosen from the buttons.') });
  items.push({ id: 'business', label: 'Business name', value: options.includeBusiness && clean(state.business) ? clean(state.business) : 'Not included' });
  items.push({ id: 'amount', label: 'Amount paid', value: options.includeAmount && clean(state.amount) ? clean(state.amount) : 'Not included' });
  items.push({ id: 'evidence', label: 'Evidence', value: options.includeEvidence === false ? 'Not included' : `${(state.evidence ?? []).length} file fingerprint(s): name, size and SHA-256 only. The files themselves are not included.` });
  if (options.includeHandoff) {
    const h = buildHandoff(state);
    const typed = h.typedByOwner;
    items.push({ id: 'handoff', label: 'Handoff details for a bank or specialist', value: [
      typed?.affected ? `Affected: ${AFFECTED[typed.affected]}${typed.affectedNote ? ` (${typed.affectedNote})` : ''}` : '', typed?.discoveredAt ? `First noticed: ${typed.discoveredAt}` : '',
      typed?.reference ? `Reference number you typed: ${typed.reference}` : (clean(state.handoff?.reference) ? "Reference number NOT included: it may only contain letters, numbers, spaces and . _ / # -, and a long number on its own can look like an account, card or phone number. Write 'Ref' before it if it really is a reference." : ''),
      typed?.followUp ? `Follow-up: ${typed.followUp}` : '', `How things stand: ${h.outcome.meaning.replace(/\.$/, '')}`,
      ...h.actions.map((a) => `${a.step}: ${STEP_OUTCOME_WORDS[a.status]}`),
    ].filter(Boolean).join('. ') });
  } else items.push({ id: 'handoff', label: 'Handoff details for a bank or specialist', value: 'Not included' });
  items.push({ id: 'timeline', label: 'Timeline', value: options.includeTimeline === false ? 'Not included' : `${(state.timeline ?? []).length} entries with times` });
  return items;
}

export function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso ?? '');
  try { return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' }).format(date); }
  catch { return date.toISOString(); }
}

export function formatBytes(size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n < 0) return 'unknown size';
  if (n < 1024) return `${n} bytes`;
  return n < 1048576 ? `${(n / 1024).toFixed(1).replace('.', ',')} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`;
}

// Plain-language sections for the on-screen and printed summary. All values are plain strings:
// the UI must insert them with textContent.
export function summarySections(pack) {
  const sections = [];
  const sourceText = SOURCE_TEXT[pack.incident?.source] ?? 'automatic suggestion';
  sections.push({ heading: 'What happened', lines: [
    pack.story?.text ? pack.story.text : pack.incident?.source === 'manual-record' ? 'No description was typed. The owner started a record without choosing a situation.' : 'No description was typed. The situation was chosen from the buttons.',
    pack.story?.version === 'masked' ? 'Personal details such as numbers, links and listed names were hidden before this was written. Names that were not listed may still appear.' : pack.story?.version === 'original' ? 'These are the owner\'s own words and may contain names or numbers.' : '',
  ].filter(Boolean) });
  sections.push({ heading: 'Situation suggested by Mgadi', lines: [
    `${pack.incident?.title ?? 'Not set'} (${sourceText}). This is a first-step guide, not a finding.`,
    ...(pack.incident?.owner_answer ? [`The owner answered the clarifying question: ${pack.incident.owner_answer}`] : []),
  ] });
  sections.push({ heading: 'Bank', lines: [pack.bank?.status === 'user-reported-called' ? `The owner reported calling the bank at ${formatTime(pack.bank.reportedAt)}. ${pack.bank.note}` : pack.bank?.note ?? 'Not recorded.'] });
  if (pack.business || pack.amount) sections.push({ heading: 'Details chosen by the owner', lines: [pack.business ? `Business: ${pack.business}` : '', pack.amount ? `Amount paid: ${pack.amount}` : ''].filter(Boolean) });
  if (pack.handoff) {
    const h = pack.handoff; const t = h.typedByOwner;
    sections.push({ heading: pack.handoff.specialistSummary ? 'Handoff for an IT or security specialist' : 'Handoff', lines: [
      ...(h.specialistSummary?.lines ?? []),
      ...(t?.affected && !h.specialistSummary ? [`Affected: ${AFFECTED[t.affected]}${t.affectedNote ? `. Note: ${t.affectedNote}` : ''}.`] : []),
      ...(t?.discoveredAt && !h.specialistSummary ? [`First noticed (as typed by the owner): ${t.discoveredAt}.`] : []),
      ...(t?.reference ? [`Reference number the owner typed (Mgadi cannot check it): ${t.reference}.`] : []),
      `How things stand: ${h.outcome?.meaning ?? OUTCOMES.unknown}`,
      // Each step in the owner's own terms. Need help and Not applicable are outcomes the owner reported; they are not "not yet reported".
      ...(h.actions?.length ? ['Steps, as the owner reported them:', ...h.actions.map((a) => `${a.step}: ${STEP_OUTCOME_WORDS[a.status] ?? a.status}.`)] : []),
      ...(h.remainingSteps?.length ? [`Not reported as done by the owner: ${h.remainingSteps.join('; ')}.`] : ['Every step has been reported by the owner.']),
      ...(t?.followUp ? [`Next follow-up (as typed by the owner): ${t.followUp}.`] : []),
      h.contacts?.referral ?? '',
    ].filter(Boolean) });
  }
  sections.push({ heading: 'Timeline', lines: (pack.timeline ?? []).map((entry) => `${formatTime(entry.at)}: ${entry.text}`) });
  sections.push({ heading: 'Evidence fingerprints', lines: (pack.evidence ?? []).length
    ? pack.evidence.map((file) => `${file.name} (${formatBytes(file.size)}, ${file.type}) SHA-256 ${file.sha256}`)
    : ['No evidence files were fingerprinted. Keep the original messages and proof of payment.'] });
  sections.push({ heading: 'Please note', lines: [pack.guide?.note ?? '', 'Evidence files are not part of this pack; only their fingerprints are.', PACK_WARNING].filter(Boolean) });
  return sections;
}
