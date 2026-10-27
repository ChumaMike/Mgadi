// Offline-safe fallback. Unknown or ambiguous incidents never receive a confident diagnosis.
const includesAny = (text, patterns) => patterns.some((pattern) => pattern.test(text));

export function classifyRules(value) {
  const text = String(value ?? '').toLowerCase();
  const paid = includesAny(text, [/\bpaid\b/, /\bpayment\b/, /\beft\b/, /\btransfer/, /\[amount\]/, /ngikhokh/]);
  const changedDetails = includesAny(text, [/new (?:bank|account|details)/, /changed? (?:bank|account|details|beneficiary)/, /banking details.*changed/, /fake invoice/, /i-?akhawunti entsha/]);
  const notPaid = includesAny(text, [/not yet paid/, /(?:have not|haven'?t|did not|didn'?t) paid/, /before .*pay/, /should .*pay/]);
  const mailbox = includesAny(text, [/mailbox/, /inbox rules?/, /forwarding/, /password.*(?:changed|reset)/, /signed?[- ]?in/, /emails? sent from/]);
  const suspicious = includesAny(text, [/phish/, /suspicious (?:email|sms|message|link)/, /fake (?:login|website)/, /clicked? .*link/, /otp|\bpin\b/]);
  const ordinary = includesAny(text, [/late payment/, /payment pending/, /bank.*down/, /debit order/]);

  if (paid && changedDetails && !notPaid) return { label: 'payment_diversion', confidence: 0.9 };
  if (changedDetails && notPaid) return { label: 'suspicious_message', confidence: 0.85 };
  if (mailbox) return { label: 'mailbox_compromise', confidence: 0.8 };
  if (suspicious) return { label: 'suspicious_message', confidence: 0.75 };
  if (ordinary) return { label: 'not_cyber', confidence: 0.72 };
  return { label: 'unsure', confidence: 0.3 };
}
