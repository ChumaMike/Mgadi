import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildGuidance, guidanceToText, stepTexts } from '../public/voice/guidance.js';
import { catalog } from '../public/accessibility/catalog.js';

const playbook = JSON.parse(fs.readFileSync(new URL('../public/data/playbook.json', import.meta.url), 'utf8'));

test('guidance covers only reviewed playbook text, marks progress, and picks the current step', () => {
  const g = buildGuidance({ playbook, route: 'payment_diversion', confirmed: ['bank'], catalog });
  assert.equal(g.title, 'Possible payment diversion');
  assert.deepEqual(g.steps.map((s) => [s.id, s.status]), [['bank', 'confirmed'], ['supplier', 'pending'], ['mailbox', 'pending'], ['evidence', 'pending']]);
  assert.equal(g.current.id, 'supplier', 'the first pending step is current');
  assert.equal(buildGuidance({ playbook, route: 'payment_diversion', stepId: 'mailbox', catalog }).current.id, 'mailbox');
  assert.equal(g.reviewed, false);
  assert.match(guidanceToText(g), /1\. Call your bank's fraud line now \(confirmed\)/);
});

test('guidance contains no phone numbers, links or credential requests', () => {
  for (const route of Object.keys(playbook.incidents)) {
    const text = guidanceToText(buildGuidance({ playbook, route, catalog }));
    assert.doesNotMatch(text, /(?:\+27|\b0)[\s\d-]{9,}|https?:|www\./i, route);
  }
});

test('unknown routes give nothing, and English is always complete while other languages need real translations', () => {
  assert.equal(buildGuidance({ playbook, route: 'made_up', catalog }), null);
  assert.equal(buildGuidance({ playbook, route: 'mailbox_compromise', lang: 'en', catalog }).complete, true);
  assert.equal(buildGuidance({ playbook, route: 'mailbox_compromise', lang: 'af', catalog }).complete, false);
  const step = playbook.incidents.payment_diversion.steps[0];
  assert.equal(stepTexts(step).length, step.do.length + 3, 'title, why, every action and the button label are all counted');
});
