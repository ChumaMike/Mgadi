// Add only rights-cleared, SASL-reviewed clips. IDs refer to source-language guidance.
// No match must remain unavailable, never guessed from English word order.
export const reviewedSigns = Object.freeze({});
export function findReviewedSign(messageId) {
  const clip = reviewedSigns[messageId];
  return clip?.reviewed === true && clip.language === 'sasl' && clip.reviewer && clip.src?.startsWith('/accessibility/media/') ? clip : null;
}
