// PRACTICE BUILD, NOT THE ENTRY.
// Rule-based fallback classifier. Same output shape as the AI: {label, confidence}.
// Runs on the server when the AI is off or fails, and in the browser when the
// server cannot be reached (bad venue wifi). Works on redacted text.

const has = (text, patterns) => patterns.some((p) => p.test(text));

const SIGNALS = {
  payment: [
    /\bpaid\b/, /\bpay(?:ment|ing)?\b/, /\beft\b/, /\btransfer+ed\b|\btransfer\b/, /\bdeposit(?:ed)?\b/,
    /\bsent (?:the |them )?money\b/, /\[amount\]/, /proof of payment/, /\bbeneficiary\b/,
    /ngikhokh/, /sikhokh/, /\bimali\b/,
  ],
  detailsChange: [
    /\b(?:new|changed?|updated?|different|another)['"’]?\s+(?:bank(?:ing)?\s+)?(?:details|account|acc|bank|info|information)\b/,
    /\bbank(?:ing)? details (?:have |had |were |was )?(?:changed|updated)\b/,
    /\b(?:changed?|moved|switched) (?:of )?banks?\b/, /\bchanged (?:the )?beneficiary\b/, /\baccount (?:is |was )?closed\b/,
    /\buse (?:their|our|his|her|the|this|a) (?:\w+ )?account\b/,
    /\bfake invoice\b/, /\bpretend(?:ed|ing)? to be\b/,
    /\b(?:invoice|statement|letter) (?:was |had been )?(?:altered|changed|edited|fake)\b/,
    /\baccount entsha\b/, /\bi-?akhawunti entsha\b/,
  ],
  notReceived: [
    /\bnever (?:got|received|sent|changed)\b/,
    /\b(?:didn'?t|did not|have not|haven'?t|hasn'?t|has not) (?:get|got|receive|received|change|changed|been paid)\b/,
    /\bwhere(?:'s| is) (?:our|my|the) money\b/, /\bnot (?:been )?paid\b/, /\bwasn'?t (?:them|from them)\b/,
    /\bnot from (?:them|him|her)\b/, /\bstill (?:waiting|outstanding)\b/, /\bscam(?:med)?\b/,
    /\bno money (?:came|has come|arrived)\b/, /\breceived nothing\b/, /\bknows? nothing about\b/, /\bnever asked\b/,
    /ayitholanga/, /ayifikanga/,
  ],
  notPaidYet: [
    /\b(?:haven'?t|have not|not yet|didn'?t|did not)\s+(?:yet\s+)?(?:paid|pay|made (?:the|a) payment)\b/,
    /\bbefore (?:we|i) pay\b/, /\bshould (?:we|i) pay\b/,
  ],
  supplier: [/\bsupplier\b/, /\binvoice\b/, /\bvendor\b/, /\bcontractor\b/, /\blandlord\b/, /\bagent\b/],
  mailbox: [
    /\bhack(?:ed)?\b/, /\bforward(?:ing)? rules?\b/, /\binbox rules?\b/, /\bpassword (?:was |got |has been )?(?:changed|reset)\b/,
    /\bsign(?:ed)?[- ]?in (?:alert|from)\b/, /\blog(?:ged)? ?in from\b/, /\blocked out\b/, /\bstrange emails? from (?:me|us|my|our)\b/,
    /\bemails? (?:sent|going) from (?:my|our)\b/, /\bsomeone (?:is )?(?:in|using|reading) (?:my|our) (?:email|mailbox|inbox)\b/,
  ],
  phishing: [
    /\bclick(?:ed)? (?:on )?(?:a |the |an )?(?:\w+ )?link\b/, /\bphish/, /\bsuspicious (?:email|sms|message|link)\b/,
    /\bfake (?:login|page|email|website)\b/, /\b(?:entered|typed|gave) (?:in )?my (?:\w+ )?(?:password|pin|otp|details)\b/,
    /\bopened (?:an |the )?attachment\b/, /\bask(?:ed|ing)? (?:me )?for (?:my |our |the )?(?:otp|pin|password)\b/,
  ],
  benign: [
    /\blate (?:paying|payment)\b/, /\bcustomer (?:hasn'?t|has not|is late)\b/, /\bclient (?:hasn'?t|has not|is late)\b/,
    /\b(?:app|bank|system) (?:is )?(?:offline|down)\b/, /\bpayment (?:is )?pending\b/, /\bforgot to pay\b/, /\bdebit order\b/,
    /\bby mistake\b/, /\bpaid (?:\w+ ){0,2}twice\b/,
  ],
};

export function classifyRules(redactedText) {
  const t = String(redactedText ?? '').toLowerCase();
  const s = Object.fromEntries(Object.entries(SIGNALS).map(([k, v]) => [k, has(t, v)]));

  // Payment diversion: money moved after a change of banking details.
  if (s.payment && s.detailsChange && !s.notPaidYet) {
    const confidence = s.notReceived || s.supplier ? 0.9 : 0.8;
    return { label: 'payment_diversion', confidence };
  }
  // A change request, but nothing paid yet: stop before money moves.
  if (s.detailsChange && s.notPaidYet) return { label: 'suspicious_message', confidence: 0.85 };
  // Money moved and the payee says it never arrived, but no change of details was mentioned.
  if (s.payment && s.notReceived) return { label: 'payment_diversion', confidence: 0.55 };
  if (s.detailsChange) return { label: 'payment_diversion', confidence: 0.5 };

  if (s.phishing) return { label: 'suspicious_message', confidence: 0.75 };
  if (s.mailbox) return { label: 'mailbox_compromise', confidence: s.payment ? 0.6 : 0.8 };
  if (s.benign && !s.notReceived) return { label: 'not_cyber', confidence: 0.75 };

  return { label: 'unsure', confidence: 0.3 };
}
