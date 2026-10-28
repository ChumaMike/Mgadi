import test from 'node:test';
import assert from 'node:assert/strict';
import { computeKeyboardInset, watchKeyboard } from '../public/voice/viewport.js';

function fakeEnv({ innerHeight = 800, height = 800, offsetTop = 0 } = {}) {
  const listeners = { vv: {}, win: {} };
  const vv = { height, offsetTop, addEventListener: (t, f) => { listeners.vv[t] = f; }, removeEventListener: (t) => { delete listeners.vv[t]; } };
  const props = new Map(); const root = { dataset: {}, style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } };
  const win = { innerHeight, visualViewport: vv, addEventListener: (t, f) => { listeners.win[t] = f; }, removeEventListener: (t) => { delete listeners.win[t]; } };
  return { win, doc: { documentElement: root }, vv, root, props, listeners };
}

test('a difference under 120 px is a browser toolbar, not a keyboard', () => {
  assert.equal(computeKeyboardInset({ innerHeight: 800, viewportHeight: 800 }), 0);
  assert.equal(computeKeyboardInset({ innerHeight: 800, viewportHeight: 700 }), 0);
  assert.equal(computeKeyboardInset({ innerHeight: 800, viewportHeight: 680 }), 0);
  assert.equal(computeKeyboardInset({ innerHeight: 800, viewportHeight: 479 }), 321);
});

test('the inset accounts for the visual viewport scrolling (offsetTop) and never goes negative', () => {
  assert.equal(computeKeyboardInset({ innerHeight: 800, viewportHeight: 500, viewportTop: 40 }), 260);
  assert.equal(computeKeyboardInset({ innerHeight: 800, viewportHeight: 900 }), 0);
});

test('watchKeyboard publishes --kb-inset and data-keyboard, updates on resize, and cleans up', () => {
  const env = fakeEnv(); const stop = watchKeyboard(env);
  assert.equal(env.root.dataset.keyboard, 'closed'); assert.equal(env.props.get('--kb-inset'), '0px');
  env.vv.height = 480; env.listeners.vv.resize();
  assert.equal(env.root.dataset.keyboard, 'open'); assert.equal(env.props.get('--kb-inset'), '320px');
  env.vv.height = 800; env.listeners.vv.resize();
  assert.equal(env.root.dataset.keyboard, 'closed'); assert.equal(env.props.get('--kb-inset'), '0px');
  stop();
  assert.deepEqual(Object.keys(env.listeners.vv), []); assert.equal(env.root.dataset.keyboard, undefined); assert.equal(env.props.has('--kb-inset'), false);
});

test('without a visual viewport (an old browser) nothing is changed and nothing throws', () => {
  const root = { dataset: {}, style: { setProperty() { throw new Error('should not be called'); } } };
  const stop = watchKeyboard({ win: { innerHeight: 800 }, doc: { documentElement: root } });
  assert.equal(typeof stop, 'function'); stop(); assert.deepEqual(root.dataset, {});
});
