import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { translate, translationLanguage, languages } from '../public/accessibility/catalog.js';
import { findReviewedSign } from '../public/accessibility/signs.js';
import { createApp } from '../server/app.js';

test('unsupported and missing translations retain the original with English language metadata', () => {
  for(const language of ['zu','xh','af','unknown']){
    assert.equal(translate('An untranslated instruction',language),'An untranslated instruction');
    assert.equal(translationLanguage('An untranslated instruction',language),'en');
  }
  assert.deepEqual(Object.keys(languages),['en','zu','xh','af']);
  assert.equal(translationLanguage('What happened?','xh'),'xh');
});

test('signing fails closed for unknown, inherited and arbitrary user text', () => {
  for(const value of ['payment_diversion.bank','constructor','__proto__','Call my bank','',null])assert.equal(findReviewedSign(value),null);
});

test('accessibility assets are available under the CSP; camera stays blocked and the microphone is limited to our own origin', async t => {
  const server=createApp();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const file of ['catalog.js','avatar.js','accessibility.js','signs.js']){
    const response=await fetch(`${base}/accessibility/${file}`);assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/javascript/);
    assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
    assert.match(response.headers.get('permissions-policy'),/camera=\(\), microphone=\(self\)/);
  }
});
