import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LABELS } from '../public/shared/labels.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const playbook = JSON.parse(read('../public/data/playbook.json'));
const lines = JSON.parse(read('../public/data/fraud-lines.json'));
const strings = (value) => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);

test('playbook stays marked as unreviewed until a real review is recorded', () => {
  assert.equal(playbook.reviewed, false);
  assert.match(playbook.reviewNote, /review pending/i);
});

test('no stale "next in this build" wording remains in guidance', () => {
  assert.doesNotMatch(strings(playbook).join('\n'), /next in this build|feature is next/i);
});

test('every label has a guide and every clarifying answer leads to one that exists', () => {
  for (const label of LABELS) if (label !== 'not_cyber' || playbook.incidents.not_cyber) assert.ok(playbook.incidents[label], label);
  assert.ok(playbook.clarify.options.length >= 3);
  for (const option of playbook.clarify.options) assert.ok(playbook.incidents[option.route], `${option.id} -> ${option.route}`);
  assert.ok(playbook.clarify.options.some((o) => o.route === 'unsure'), 'there must be a way to say "I am not sure"');
});

test('bank steps lead the routes where money may have moved, and never force a claim of calling', () => {
  for (const key of ['payment_diversion', 'unsure']) {
    const [first] = playbook.incidents[key].steps;
    assert.equal(first.id, 'bank', `${key} must start with the bank`);
    assert.ok(first.skip, `${key} must let the owner continue without saying they called`);
    assert.notEqual(first.skip, first.done);
  }
});

test('guidance never contains phone numbers or links: official numbers come only from fraud-lines.json', () => {
  assert.doesNotMatch(strings(playbook).join('\n'), /(?:\+27|\b0)[\s\d-]{9,}|https?:|www\./i);
  assert.ok(lines.checkedOn && lines.banks.every((b) => /^\+27\d{9}$/.test(b.tel)));
});

test('guidance never asks for credentials', () => {
  const text = strings(playbook).join('\n').toLowerCase();
  assert.doesNotMatch(text, /(?:enter|give|share|send|tell|read out)[^.]{0,30}(?:password|otp|pin\b|card number)/);
});

test('front-end code never writes HTML from strings', () => {
  const dir = new URL('../public/', import.meta.url);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : [new URL(e.name, d)]));
  for (const file of walk(dir).filter((f) => f.pathname.endsWith('.js'))) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/, file.pathname);
});
