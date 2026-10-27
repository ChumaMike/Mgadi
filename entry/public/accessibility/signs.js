// Add only rights-cleared, SASL-reviewed clips. IDs refer to source-language guidance, for example "payment_diversion.bank".
// No match must remain unavailable, never guessed from English word order, and never produced by the 3D avatar.
// A clip is shown ONLY if every one of these is true. The registry ships empty: no clip has been validated yet.
//   { language: 'sasl', reviewed: true, reviewer: 'Name, role', reviewedOn: '2026-11-03', rightsCleared: true,
//     src: '/accessibility/media/<file>.mp4|webm', captions: '/accessibility/media/<file>.vtt' }
export const reviewedSigns = Object.freeze({});

const MEDIA = /^\/accessibility\/media\/[A-Za-z0-9._-]+\.(?:mp4|webm)$/;
const CAPTIONS = /^\/accessibility\/media\/[A-Za-z0-9._-]+\.vtt$/;

export function validSaslClip(clip) {
  const ok = clip && clip.reviewed === true && clip.language === 'sasl'
    && typeof clip.reviewer === 'string' && clip.reviewer.trim().length > 2
    && /^\d{4}-\d{2}-\d{2}$/.test(String(clip.reviewedOn ?? ''))
    && clip.rightsCleared === true
    && typeof clip.src === 'string' && MEDIA.test(clip.src)
    && typeof clip.captions === 'string' && CAPTIONS.test(clip.captions);
  return ok ? clip : null;
}

export function findReviewedSign(messageId, registry = reviewedSigns) {
  if (typeof messageId !== 'string' || !Object.hasOwn(registry, messageId)) return null;
  return validSaslClip(registry[messageId]);
}
