// Offline-safe fallback. Unknown or ambiguous incidents never receive a confident diagnosis.
// Patterns are general families (paid / changed details / negation), not copies of test sentences.
// Anything that mixes "paid" with "not paid", or that mentions scam words without a clear route,
// goes to the clarifying question rather than to a confident label. English-first; a few
// isiZulu/Afrikaans phrases are included but free-text in those languages is not verified.
const includesAny = (text, patterns) => patterns.some((pattern) => pattern.test(text));

const NOT_PAID = [
  /\b(?:not|never)\s+(?:yet\s+)?(?:paid|pay|transferred|sent\s+(?:the\s+|any\s+)?(?:money|payment|funds))\b/,
  /\b(?:have|has|had|did|do|does)(?:\s+not|n'?t)\s+(?:yet\s+)?(?:paid|pay|made\b[^.!?]{0,12}\b(?:payment|transfer|eft)|transferred|sent\s+(?:the\s+|any\s+)?(?:money|payment|funds))\b/,
  /\bnothing\s+(?:has been|was|is|got)\s+(?:paid|sent|transferred)\b/,
  /\bno\s+(?:payment|money|transfer)\s+(?:has been|was|had been)\s+(?:made|sent|paid)\b/,
  /\byet to pay\b/,
  /\b(?:before|until)\b[^.!?]{0,30}\b(?:pay|paying|payment|transfer)\b/,
  /\bshould\b[^.!?]{0,20}\bpay\b/,
  /\b(?:checking|verify(?:ing)?|confirm(?:ing)?)\b[^.!?]{0,15}\bfirst\b/,
];
const PAID = [
  /\bpaid\b/, /\bpaying\b/, /\bsettled\b/, /\beft\b/, /\bdeposit(?:ed)?\b/, /\bwired\b/, /\bremitted\b/,
  /\btransf(?:er{1,2}|re)ed\b/, /\bdid\b[^.!?]{0,12}\b(?:transfer|eft|payment)\b/,
  /\bmade\b[^.!?]{0,12}\b(?:payment|eft|transfer|deposit)\b/,
  /\bsent\b[^.!?]{0,30}\b(?:payment|money|funds|eft)\b/,
  /\btransferred\b/, /\bpayment (?:was|has been|went) (?:made|through)\b/,
  /ngikhokh/, /\bbetaal\b/,
];
const DETAIL_WORDS = '(?:bank(?:ing)?|account|acc|beneficiary|details|info|information|particulars|statement)';
const CHANGE_WORDS = '(?:new|updated?|revised|different|changed?|switched|altered|replacement)';
const CHANGED = [
  new RegExp(`\\b${CHANGE_WORDS}\\b[^.!?]{0,40}\\b${DETAIL_WORDS}\\b`),
  new RegExp(`\\b${DETAIL_WORDS}\\b[^.!?]{0,30}\\b(?:changed?|changes|updated?|switched|moved|different|closed)\\b`),
  /\b(?:switched|moved|changed) banks?\b/,
  /\bfake invoice\b/, /\b(?:altered|forged|tampered|doctored)\b/,
  /\baccount\b[^.!?]{0,40}\b(?:from now on|going forward|instead)\b/, /\b(?:from now on|going forward)\b[^.!?]{0,40}\baccount\b/,
  /\b(?:ask(?:s|ed|ing)?|want(?:s|ed)?|request(?:s|ed|ing)?)\b[^.!?]{0,40}\b(?:change|update)\b[^.!?]{0,30}\b(?:bank|banking|account|details)\b/,
  /\baccount\b[^.!?]{0,30}\b(?:was|were|came|is)\b[^.!?]{0,15}\b(?:on|in|from)\b[^.!?]{0,15}\b(?:an? )?(?:email|e-mail|whatsapp|sms|message|invoice|letter|pdf|statement)\b/,
  /(?:akhawunti|account|rekening)\s+(?:entsha|ntsha|nuwe)\b/, /\bnuwe (?:bank|rekening)/,
];
const MAILBOX = [
  /mailbox/, /inbox rules?/, /forwarding/, /password\b.*\b(?:changed|reset)/, /signed?[- ]?in\b/, /emails? sent from/,
  /\brules?\b[^.!?]{0,60}\b(?:forward|copy|copies|send|sending|redirect)/,
  /\b(?:hacked|compromised|taken over)\b[^.!?]{0,40}\b(?:email|e-mail|mail|inbox|account)\b/,
  /\b(?:email|e-mail|outlook|gmail)\b[^.!?]{0,40}\b(?:hacked|compromised)\b/,
  /\b(?:someone|somebody)\b[^.!?]{0,20}\b(?:logged|signed|accessed|got into|is in)\b/,
  /\b(?:logged|signed) into my\b/,
  /\b(?:from|using) my (?:own )?(?:email|e-mail|mailbox)\b/,
  /\b(?:emails?|invoices?|messages?)\b[^.!?]{0,40}\b(?:never|did not|didn'?t)\s+sen[dt]\b/,
];
const SUSPICIOUS = [
  /phish/, /suspicious (?:email|sms|message|link|call)/, /fake (?:login|website|site)/,
  /\b(?:clicked|opened|tapped)\b[^.!?]{0,30}\b(?:link|attachment)\b/, /otp|\bpin\b/,
  /\b(?:read out|give|share|send|asked for)\b[^.!?]{0,30}\b(?:code|otp|pin|password)\b/,
  /\b(?:pretend(?:ed|ing)|impersonat\w*|claim(?:ed|ing)? to be)\b/,
  /\b(?:phoned|called|messaged|whatsapp(?:ed)?)\b[^.!?]{0,30}\b(?:from|saying)\b[^.!?]{0,20}\b(?:bank|sars|police)\b/,
];
const ORDINARY = [
  /\blate(?:ly)?\b[^.!?]{0,15}\bpay/, /\boverdue\b/, /payment (?:is )?pending/, /\bpending\b[^.!?]{0,30}\bpayment\b/, /\bpayment\b[^.!?]{0,40}\bpending\b/,
  /bank.*\b(?:down|offline)\b/, /\b(?:app|network|machine|system|website)\b[^.!?]{0,20}\b(?:is |was )?(?:down|offline|slow)\b/,
  /debit order/, /\binsufficient funds\b/, /\bcredit note\b/, /\b(?:wrong|damaged|missing|incorrect)\s+(?:stock|goods|delivery|order|items?)\b/,
  /\b(?:paid|payment|pay)\b[^.!?]{0,30}\b(?:twice|double)\b/, /\bduplicate payment\b/, /\bby mistake\b/, /\b(?:refund|money back)\b/,
];
const SCAM_WORDS = /\b(?:scam\w*|fraud\w*|trick\w*|fake|hack\w*|phish\w*|stolen|criminals?|impersonat\w*|pretend\w*)\b/;

export function classifyRules(value) {
  const text = String(value ?? '').toLowerCase();
  const notPaid = includesAny(text, NOT_PAID);
  // Remove "not paid" phrases first so they cannot count as payment evidence.
  const remainder = NOT_PAID.reduce((acc, pattern) => acc.replace(new RegExp(pattern.source, 'g'), ' '), text);
  const paid = includesAny(remainder, PAID);
  // "no bank details changed" is not a change; the window is short so "no money arrived in the new account" is untouched.
  const changeText = text.replace(/\b(?:no|nothing|not)\s+(?:\w+\s+){0,3}?(?:changed?|new|updated?)\b/g, ' ');
  const changed = includesAny(changeText, CHANGED);

  if (paid && changed && notPaid) return { label: 'unsure', confidence: 0.4 }; // contradictory: ask, bank stays first
  if (paid && changed) return { label: 'payment_diversion', confidence: 0.9 };
  if (changed && notPaid) return { label: 'suspicious_message', confidence: 0.85 };
  if (includesAny(text, MAILBOX)) return { label: 'mailbox_compromise', confidence: 0.8 };
  if (includesAny(text, SUSPICIOUS)) return { label: 'suspicious_message', confidence: 0.75 };
  if (changed) return { label: 'unsure', confidence: 0.4 };
  if (includesAny(text, ORDINARY) && !SCAM_WORDS.test(text)) return { label: 'not_cyber', confidence: 0.72 };
  return { label: 'unsure', confidence: 0.3 };
}
