// POPIA security-compromise notification DRAFT, built from the incident pack the owner already made.
//
// This is a TEMPLATE for the responsible party's information officer to review. It is NOT legal advice. Mgadi cannot tell whether
// personal information was involved, whether POPIA section 22 applies, or what a lawyer would advise. Everything Mgadi does not
// know is left as a visible blank. Headings follow what public guidance says the Information Regulator's prescribed form and
// section 22 ask for; the Regulator's current form and channel are the authority, so check them before anything is sent.
// Sources read: on 27 October 2026 the text of section 22 (popia.co.za) and Bowmans, Cliffe Dekker Hofmeyr and Clyde & Co
// summaries of the Regulator's earlier fillable form (SCN1, 2022); on 28 October 2026 the Regulator's own "Reporting of Security
// Compromises: how to report on the eServices portal, step-by-step guide" (inforegulator.org.za, file in its May 2025 uploads,
// itself undated). The guide describes the portal's sections (statistical details, incident details, notification, impact,
// document upload) and says the organisation and its information officers must be registered. This draft follows both
// structures and does not choose between them. None of it was reviewed by a South African lawyer for this template.
import { cleanLine } from './text.js';
import { formatTime } from './summary.js';

export const TBC = '[to be completed by the information officer]';
export const DISCLAIMER = 'TEMPLATE FOR THE INFORMATION OFFICER TO REVIEW. NOT LEGAL ADVICE. Mgadi cannot tell whether personal information was affected or whether the Protection of Personal Information Act (POPIA) requires a notification. Get advice from a qualified South African adviser before sending anything to the Information Regulator or to anyone whose information may be affected.';

const STEP_WORD = { 'reported-by-owner': 'reported by the owner', 'skipped-by-owner': 'skipped by the owner', 'not-reported': 'not reported' };
const field = (value, max = 120) => cleanLine(value, max) || TBC;

export function buildPopiaDraft(pack, input = {}) {
  const typed = pack?.handoff?.typedByOwner;
  const sections = [];
  sections.push({ heading: 'Read this first', lines: [
    DISCLAIMER,
    'Section 22 of POPIA is about a "security compromise": reasonable grounds to believe that personal information has been accessed or acquired by an unauthorised person. If that is the case, public guidance says the Information Regulator and the affected people (where they can be identified) must be told as soon as reasonably possible after the compromise is discovered.',
    'Decision for the information officer (Mgadi cannot make it): are there reasonable grounds to believe personal information was accessed or acquired by an unauthorised person?   [ ] Yes   [ ] No   [ ] Not yet known',
  ] });
  sections.push({ heading: 'What Mgadi can tell you from the incident pack', lines: [
    `Pack prepared: ${formatTime(pack?.generatedAt)}.`,
    `Situation suggested by Mgadi: ${cleanLine(pack?.incident?.title, 120) || 'not set'}. This is a first-step guide, not a finding that a compromise happened.`,
    `Owner's description (personal details were hidden before it was written): ${cleanLine(pack?.story?.text, 600) || 'none was typed; the situation was chosen from the buttons.'}`,
    typed?.discoveredAt ? `First noticed (as typed by the owner): ${cleanLine(typed.discoveredAt, 60)}.` : 'First noticed: not stated in the pack.',
    typed?.affected ? `Affected (as typed by the owner): ${cleanLine(typed.affected, 40)}${typed.affectedNote ? `, ${cleanLine(typed.affectedNote, 120)}` : ''}.` : 'What was affected: not stated in the pack.',
    pack?.bank?.status === 'user-reported-called' ? `The owner reports calling the bank at ${formatTime(pack.bank.reportedAt)}. Mgadi cannot confirm the bank answered or acted.` : 'The owner has not reported calling the bank in Mgadi.',
    ...(Array.isArray(pack?.handoff?.actions) ? pack.handoff.actions.slice(0, 12).map((a) => `Step "${cleanLine(a.step, 100)}": ${STEP_WORD[a.status] ?? 'not reported'}.`) : ['Step details were not included in the pack.']),
    `Evidence fingerprints in the pack: ${Array.isArray(pack?.evidence) ? pack.evidence.length : 0}. The files themselves are not in the pack.`,
    'A tap in Mgadi is the owner\'s own report. Mgadi cannot confirm that anything was done or that it worked.',
  ] });
  sections.push({ heading: 'Part A: the responsible party (the organisation)', lines: [
    `Name: ${field(input.responsibleParty, 120)}`,
    'Registration number, address and contact details: ' + TBC,
    `Sector (the Regulator\'s portal asks for it): ${TBC}`,
    'Did this happen at the registered address?   [ ] Yes   [ ] No   If no, the town or city and the province: ' + TBC,
  ] });
  sections.push({ heading: 'Part B: the information officer', lines: [`Name: ${field(input.officerName, 120)}`, `Contact details: ${field(input.officerContact, 120)}`, 'The Regulator\'s guide says the organisation and its information officers must be registered with the Regulator before a report can be made. Registration details: ' + TBC] });
  sections.push({ heading: 'Part C: the security compromise', lines: [
    `Date of the compromise: ${typed?.discoveredAt ? `first noticed ${cleanLine(typed.discoveredAt, 60)} (as typed by the owner); the date it began may be earlier. ` : ''}${TBC}`,
    `Date this is reported to the Regulator: ${TBC}`,
    `Reason for any delay in reporting: ${TBC}`,
    `Description of the incident (the Regulator allows a separate annexure): use the facts above and add what an IT specialist has found. ${TBC}`,
    'Type of compromise (tick what applies, per the Regulator):   [ ] loss   [ ] damage   [ ] unauthorised destruction   [ ] unlawful access   [ ] unlawful processing   [ ] other',
    `Categories of personal information involved: ${field(input.categories, 200)}`,
    `Number of people (data subjects) affected, if known: ${field(input.count, 60)}`,
    'Status of the compromise (the Regulator\'s portal offers these three):   [ ] Confirmed   [ ] Potential   [ ] Alleged',
    `Have the affected people been told, and how? ${TBC}`,
  ] });
  sections.push({ heading: 'Impact (as the Regulator\'s portal asks)', lines: [
    'Possible or likely consequences for the affected people (tick what applies; Mgadi has ticked nothing):   [ ] impact on rights   [ ] discrimination   [ ] identity theft   [ ] fraud   [ ] loss of reputation   [ ] threat to health or safety   [ ] financial loss   [ ] loss of confidentiality of information protected by professional secrecy   [ ] other',
    'Has the personal information been retrieved or secured?   [ ] Yes   [ ] Partially   [ ] No   [ ] Not applicable',
    `Measures taken, or to be taken, to address the incident and to prevent further unauthorised access (use the steps above, plus any specialist work): ${TBC}`,
  ] });
  sections.push({ heading: 'Notice to the affected people (draft wording)', lines: [
    'Public guidance says this must be in writing (for example by post, email, or a prominent notice on the website) and give enough information for people to protect themselves. The Regulator\'s portal guide says a sample of each notice that was sent must be uploaded with the report. Draft, for the information officer to rewrite:',
    `Dear ${TBC},`,
    `We are writing to tell you that on or around ${typed?.discoveredAt ? cleanLine(typed.discoveredAt, 60) : TBC} we discovered an incident that may have affected personal information we hold about you. ${TBC}`,
    `What we know so far: ${TBC}`,
    `The possible consequences for you: ${TBC}`,
    `What we have done or intend to do: ${TBC}`,
    `What we recommend you do to protect yourself: ${TBC}`,
    `The identity of the person or group who may have accessed the information, if we know it: ${TBC}`,
    `Who to contact with questions: ${field(input.officerName, 120)}, ${field(input.officerContact, 120)}`,
  ] });
  sections.push({ heading: 'Before anything is sent', lines: [
    'The Information Regulator\'s own step-by-step guide (inforegulator.org.za, read on 28 October 2026) describes reporting through its eServices portal (eservices.inforegulator.org.za) and says the organisation and its information officers must be registered first. Older public guidance describes a fillable Security Compromise Notification form (SCN1) that was emailed to the Regulator. Check on the Regulator\'s website which route applies today, and do not rely on this template for it.',
    'If the police or the Regulator say a notification would impede a criminal investigation, ask your adviser before telling affected people.',
    'Keep the evidence (see the evidence fingerprints in the pack). Do not put passwords, PINs or full account numbers in any notification.',
    'Have a qualified adviser review the final wording. Mgadi has not.',
  ] });
  sections.push({ heading: 'Reminder', lines: [DISCLAIMER] });
  return { title: 'POPIA security compromise notification: DRAFT TEMPLATE', sections };
}

export function popiaText(draft) {
  const out = [draft.title, '='.repeat(Math.min(draft.title.length, 70)), ''];
  for (const section of draft.sections) { out.push(section.heading.toUpperCase(), ...section.lines.map((line) => `- ${line}`), ''); }
  return out.join('\n');
}
