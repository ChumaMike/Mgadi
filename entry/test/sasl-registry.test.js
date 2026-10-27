import test from 'node:test';
import assert from 'node:assert/strict';
import { findReviewedSign, validSaslClip, reviewedSigns } from '../public/accessibility/signs.js';

const good = { language: 'sasl', reviewed: true, reviewer: 'A. Interpreter, SASL interpreter', reviewedOn: '2026-11-03', rightsCleared: true, src: '/accessibility/media/bank-step.mp4', captions: '/accessibility/media/bank-step.vtt' };

test('the shipped registry is empty: no signing content is claimed anywhere', () => {
  assert.deepEqual(Object.keys(reviewedSigns), []);
  assert.equal(findReviewedSign('payment_diversion.bank'), null);
});

test('a clip is accepted only when it is reviewed, dated, rights-cleared, captioned and served from our media folder', () => {
  assert.equal(findReviewedSign('payment_diversion.bank', { 'payment_diversion.bank': good }), good);
  const broken = {
    notReviewed: { ...good, reviewed: false }, reviewedString: { ...good, reviewed: 'true' }, notSasl: { ...good, language: 'asl' },
    noReviewer: { ...good, reviewer: '' }, noDate: { ...good, reviewedOn: undefined }, badDate: { ...good, reviewedOn: 'last week' },
    noRights: { ...good, rightsCleared: false }, noCaptions: { ...good, captions: undefined }, wrongCaptions: { ...good, captions: '/accessibility/media/x.mp4' },
    external: { ...good, src: 'https://evil.test/video.mp4' }, traversal: { ...good, src: '/accessibility/media/../../secret.mp4' }, badType: { ...good, src: '/accessibility/media/x.exe' },
  };
  for (const [name, clip] of Object.entries(broken)) assert.equal(findReviewedSign('x', { x: clip }), null, name);
  assert.equal(validSaslClip(null), null);
});

test('lookups use own keys only and ignore anything that is not a plain step id string', () => {
  const registry = { 'payment_diversion.bank': good };
  for (const id of ['constructor', '__proto__', 'toString', '', null, undefined, 42, {}, ['payment_diversion.bank']]) assert.equal(findReviewedSign(id, registry), null);
  const inherited = Object.create({ 'payment_diversion.bank': good });
  assert.equal(findReviewedSign('payment_diversion.bank', inherited), null);
});
