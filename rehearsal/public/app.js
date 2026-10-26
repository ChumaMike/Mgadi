// PRACTICE BUILD, NOT THE ENTRY.
// Mgadi on the phone: describe -> triage -> one safe step at a time -> incident pack.
// Every screen is built with DOM calls and textContent. No innerHTML anywhere, so
// pasted scam text can never become markup or script.

import { redact, MAX_INPUT_CHARS } from './shared/redact.js';
import { classifyRules } from './shared/rules.js';
import { route, validateTriage } from './shared/labels.js';
import { sha256Hex, canonicalJSON } from './shared/sha256.js';
import { formatZAR, parseZAR } from './shared/zar.js';

const STORE_KEY = 'mgadi-practice-incident';
const app = document.getElementById('app');
let playbook;
let directory;
let state;

// ---------- small helpers ----------

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

const nowISO = () => new Date().toISOString();
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dateOf = (iso) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });

function elapsed(fromISO, toISO) {
  const s = Math.max(0, Math.round((new Date(toISO) - new Date(fromISO)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fresh() {
  return {
    startedAt: nowISO(),
    screen: 'home',
    returnTo: 'home',
    timeline: [],
    description: '',
    names: '',
    redacted: '',
    counts: {},
    triage: null,
    clarify: null,
    incident: null,
    stepIndex: 0,
    bank: null,
    bankRef: '',
    outcomes: {},
    mailboxGuide: null,
    evidence: [],
    details: { business: '', amount: '', datePaid: '', paidTo: '' },
    firstActionAt: null,
    pack: null,
    clearArmed: false,
  };
}

function load() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or storage blocked: Mgadi still works, it just won't survive a reload.
  }
}

function log(text) {
  state.timeline.push({ at: nowISO(), text });
  save();
}

function firstAction(text) {
  if (!state.firstActionAt) state.firstActionAt = nowISO();
  log(text);
}

function go(screen) {
  state.screen = screen;
  save();
  render();
}

function render() {
  const screens = { home, checking, clarify, incident, step, bank: bankScreen, pack, verify };
  const nodes = (screens[state.screen] || home)();
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
  app.querySelector('h1')?.setAttribute('tabindex', '-1');
  app.querySelector('h1')?.focus({ preventScroll: true });
}

function markTags(text) {
  // Show [AMOUNT], [NAME] etc. highlighted, still as plain text nodes.
  return text.split(/(\[[A-Z]+\])/g).map((part) => (/^\[[A-Z]+\]$/.test(part) ? h('mark', { text: part }) : part));
}

function countsLine(counts) {
  const words = { LINK: 'link', EMAIL: 'email address', AMOUNT: 'amount', PHONE: 'phone number', NUMBER: 'long number', NAME: 'name' };
  const parts = Object.entries(counts).map(([k, n]) => `${n} ${words[k] || k.toLowerCase()}${n > 1 ? 's' : ''}`);
  return parts.length ? `Hidden before sending: ${parts.join(', ')}.` : 'Nothing needed hiding.';
}

// ---------- screens ----------

function home() {
  const textarea = h('textarea', {
    id: 'desc',
    maxlength: MAX_INPUT_CHARS,
    placeholder: 'For example: "Our supplier says they never changed bank details, but we paid the new account from their email."',
  });
  textarea.value = state.description;
  const names = h('input', { id: 'names', type: 'text', autocomplete: 'off', placeholder: 'e.g. Ridgeline, Thandi' });
  names.value = state.names;

  const submit = async () => {
    const description = textarea.value.trim();
    if (!description) {
      textarea.focus();
      return;
    }
    state.description = description;
    state.names = names.value;
    const { text, counts } = redact(description, { names: names.value.split(',') });
    state.redacted = text;
    state.counts = counts;
    log('Described what happened');
    go('checking');
  };

  return [
    h('h1', { text: 'Something went wrong?' }),
    h('p', { class: 'lead', text: "Tell us what happened in your own words. You don't need to know the cyber term." }),
    h('label', { for: 'desc', text: 'What happened?' }),
    textarea,
    h('details', {},
      h('summary', { text: 'Names to hide (optional)' }),
      h('p', { class: 'small', text: 'Supplier, staff or client names, separated by commas. Account numbers, phone numbers, emails and amounts are hidden automatically.' }),
      names),
    h('button', { class: 'btn', type: 'button', onclick: submit, text: 'Get help now' }),
    h('div', { class: 'card warn' },
      h('strong', { text: 'Money already gone? ' }),
      'Call your bank first. Tap the red ',
      h('strong', { text: 'Bank fraud line' }),
      ' button at the top at any time.'),
    h('button', { class: 'btn link', type: 'button', onclick: () => go('verify'), text: 'Check a file against an incident pack' }),
  ];
}

async function triageRemote(text) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch('api/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    const valid = validateTriage({ label: body.label, confidence: body.confidence });
    return valid ? { ...valid, source: body.source === 'ai' ? 'ai' : 'rules' } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function checking() {
  if (!state.redacted) return home();
  queueMicrotask(async () => {
    const result = (await triageRemote(state.redacted)) || { ...classifyRules(state.redacted), source: 'offline' };
    state.triage = result;
    const next = route(result);
    if (next === 'clarify') {
      state.clarify = result.label === 'payment_diversion' ? 'payment' : 'money';
      go('clarify');
    } else {
      state.incident = next;
      state.stepIndex = 0;
      log(`Mgadi sorted it: ${playbook.incidents[next].title}`);
      go('incident');
    }
  });
  return [
    h('h1', { text: 'Checking…' }),
    h('p', { class: 'lead', text: 'This takes a few seconds. While you wait: if money has left your account, call your bank now.' }),
    h('button', { class: 'btn urgent', type: 'button', onclick: () => openBank(), text: 'Call your bank fraud line' }),
  ];
}

function clarify() {
  const q = playbook.clarify[state.clarify] || playbook.clarify.money;
  const answer = (choice) => {
    log(`Answered: "${q.question}" ${choice.text}`);
    state.incident = choice.label;
    state.stepIndex = 0;
    log(`Mgadi sorted it: ${playbook.incidents[choice.label].title}`);
    go('incident');
  };
  return [
    h('p', { class: 'eyebrow', text: 'One more detail' }),
    h('h1', { text: q.question }),
    h('p', { class: 'lead', text: "We need one more detail before we guide you. If you're not sure, pick the answer that says \"not sure\": it is always the safer path." }),
    h('div', { class: 'choices' },
      h('button', { class: 'choice', type: 'button', onclick: () => answer(q.yes), text: q.yes.text }),
      h('button', { class: 'choice', type: 'button', onclick: () => answer(q.no), text: q.no.text })),
    triageCard(),
  ];
}

function triageCard() {
  const t = state.triage;
  if (!t) return null;
  const source = { ai: 'Sorted by AI, using the hidden-details text only', rules: "Sorted by Mgadi's built-in rules", offline: 'Sorted on this phone (no connection)' }[t.source];
  // Set the width through CSSOM: the CSP blocks inline style attributes.
  const bar = h('span');
  bar.style.width = `${Math.round(t.confidence * 100)}%`;
  return h('details', { class: 'card' },
    h('summary', { text: 'What left your phone, and how it was sorted' }),
    h('p', { class: 'redacted' }, markTags(state.redacted)),
    h('p', { class: 'small', text: countsLine(state.counts) }),
    h('p', { class: 'small', text: `${source}. Confidence ${Math.round(t.confidence * 100)}%. The AI can only pick a label; it never writes the steps.` }),
    h('div', { class: 'meter', role: 'img', 'aria-label': `Confidence ${Math.round(t.confidence * 100)} percent` }, bar));
}

function incident() {
  const inc = playbook.incidents[state.incident];
  return [
    h('p', { class: 'eyebrow', text: 'Possible incident' }),
    h('h1', { text: inc.title }),
    h('p', { class: 'lead', text: inc.summary }),
    playbook.reviewed ? null : h('p', {}, h('span', { class: 'badge', text: 'Draft steps, not yet practitioner-reviewed' })),
    h('button', { class: 'btn', type: 'button', onclick: () => go('step'), text: `Start step 1 of ${inc.steps.length}` }),
    triageCard(),
  ];
}

function step() {
  const inc = playbook.incidents[state.incident];
  const s = inc.steps[state.stepIndex];
  if (!s) return pack();
  const widgets = { bank: bankWidget, supplier: supplierWidget, mailbox: mailboxWidget, evidence: evidenceWidget };
  const done = () => {
    if (s.kind === 'bank') firstAction(s.done);
    else log(s.done);
    state.stepIndex += 1;
    go(state.stepIndex < inc.steps.length ? 'step' : 'pack');
  };
  return [
    h('p', { class: 'progress', text: `STEP ${state.stepIndex + 1} OF ${inc.steps.length}` }),
    h('h1', { text: s.title }),
    h('p', { class: 'lead', text: s.why }),
    h('ol', { class: 'do' }, s.do.map((line) => h('li', { text: line }))),
    widgets[s.kind] ? widgets[s.kind](s) : null,
    h('button', { class: 'btn', type: 'button', onclick: done, text: `${s.done}: timestamp this` }),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn secondary', type: 'button',
        onclick: () => (state.stepIndex === 0 ? go('incident') : (state.stepIndex -= 1, go('step'))),
        text: 'Back',
      }),
      h('button', {
        class: 'btn secondary', type: 'button',
        onclick: () => { log(`Skipped: ${s.title}`); state.stepIndex += 1; go(state.stepIndex < inc.steps.length ? 'step' : 'pack'); },
        text: 'Skip for now',
      })),
  ];
}

function openBank() {
  state.returnTo = state.screen === 'bank' ? state.returnTo : state.screen;
  go('bank');
}

function bankScreen() {
  return [
    h('h1', { text: "Call your bank's fraud line" }),
    h('p', { class: 'lead', text: 'Use an official number, never one from the suspicious email or message.' }),
    bankWidget(),
    h('button', { class: 'btn secondary', type: 'button', onclick: () => go(state.returnTo || 'home'), text: 'Back to where I was' }),
  ];
}

function bankWidget() {
  const wrap = h('div', { class: 'card' });
  const draw = () => {
    const chosen = directory.banks.find((b) => b.id === state.bank);
    const ref = h('input', { id: 'bankRef', type: 'text', autocomplete: 'off', placeholder: 'e.g. the case or reference number' });
    ref.value = state.bankRef;
    ref.addEventListener('change', () => {
      state.bankRef = ref.value.trim();
      if (state.bankRef) log('Wrote down the bank reference number');
      save();
    });
    wrap.replaceChildren(
      h('strong', { text: 'Which bank paid the money?' }),
      h('div', { class: 'choices' },
        directory.banks.map((b) => h('button', {
          class: 'choice', type: 'button', 'aria-pressed': String(b.id === state.bank),
          onclick: () => { state.bank = b.id; save(); draw(); },
          text: b.name,
        }))),
      chosen
        ? h('div', {},
          chosen.lines.map((line) => h('div', { class: 'tel' },
            h('p', { class: 'small', text: `${chosen.name}: ${line.label}` }),
            h('p', { class: 'number', text: line.number }),
            h('a', {
              class: 'btn urgent', href: `tel:${line.tel}`,
              onclick: () => firstAction(`Called ${chosen.name} fraud line (${line.number})`),
              text: `Call ${line.number}`,
            }))),
          h('p', { class: 'small', text: `Checked online on ${dateOf(directory.checkedOn)}. ${directory.note}` }),
          h('label', { for: 'bankRef', text: 'Reference number from the bank (optional)' }),
          ref)
        : h('p', { class: 'small', text: directory.other }),
    );
  };
  draw();
  return wrap;
}

function outcomeWidget(key, question, options) {
  const wrap = h('div', { class: 'card' });
  const draw = () => wrap.replaceChildren(
    h('strong', { text: question }),
    h('div', { class: 'choices' },
      options.map((o) => h('button', {
        class: 'choice', type: 'button', 'aria-pressed': String(state.outcomes[key] === o),
        onclick: () => { state.outcomes[key] = o; log(`${question} ${o}`); draw(); },
        text: o,
      }))));
  draw();
  return wrap;
}

function supplierWidget() {
  return outcomeWidget('supplier', 'What did they say?', [
    'They did NOT change their banking details',
    'They DID change their banking details',
    "I couldn't reach them yet",
  ]);
}

function mailboxWidget() {
  const guides = playbook.mailboxGuides;
  const wrap = h('div', {});
  const draw = () => {
    const chosen = guides[state.mailboxGuide];
    wrap.replaceChildren(
      h('div', { class: 'card' },
        h('strong', { text: 'Which email do you use?' }),
        h('div', { class: 'choices' },
          Object.keys(guides).map((name) => h('button', {
            class: 'choice', type: 'button', 'aria-pressed': String(name === state.mailboxGuide),
            onclick: () => { state.mailboxGuide = name; save(); draw(); },
            text: name,
          }))),
        chosen ? h('ol', { class: 'do' }, chosen.map((line) => h('li', { text: line }))) : null,
        chosen ? h('p', { class: 'small', text: 'Menu names change from time to time. If you get stuck, ask your IT person or email provider.' }) : null),
      outcomeWidget('mailbox', 'What did you find?', [
        'Rules or sign-ins I did not recognise',
        'Nothing strange',
        "I couldn't check yet",
      ]),
    );
  };
  draw();
  return wrap;
}

function evidenceList(items) {
  if (!items.length) return h('p', { class: 'small', text: 'No files added yet.' });
  return h('ul', { class: 'plain' }, items.map((e) => h('li', {},
    h('strong', { text: e.name }),
    ` (${Math.max(1, Math.round(e.size / 1024))} KB, added ${timeOf(e.addedAt)})`,
    h('div', { class: 'hash', text: `SHA-256 ${e.sha256}` }))));
}

function evidenceWidget() {
  const listBox = h('div', {}, evidenceList(state.evidence));
  const input = h('input', { type: 'file', id: 'evidence', multiple: true, accept: 'image/*,.pdf,.eml,.msg,.txt' });
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    for (const file of files) {
      const sha256 = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
      state.evidence.push({ name: file.name, size: file.size, type: file.type || 'unknown', sha256, addedAt: nowISO() });
      log(`Fingerprinted evidence: ${file.name}`);
    }
    listBox.replaceChildren(evidenceList(state.evidence));
  });
  return h('div', { class: 'card' },
    h('label', { for: 'evidence', text: 'Add the email screenshot and proof of payment' }),
    input,
    h('p', { class: 'small', text: 'Files stay on this phone. Mgadi only records each file\'s fingerprint (SHA-256), so any later change can be spotted.' }),
    listBox);
}

// ---------- incident pack ----------

async function makePack() {
  const inc = playbook.incidents[state.incident] || playbook.incidents.unsure;
  const bank = directory.banks.find((b) => b.id === state.bank);
  const amount = parseZAR(state.details.amount);
  const body = {
    format: 'mgadi-incident-pack/practice-1',
    notice: 'PRACTICE BUILD, NOT THE HACKSECURE ENTRY. Made on the owner\'s phone; nothing was uploaded.',
    generatedAt: nowISO(),
    business: state.details.business,
    incident: {
      type: state.incident,
      title: inc.title,
      triage: state.triage,
      playbookVersion: playbook.version,
      playbookReviewed: playbook.reviewed,
    },
    ownerDescription: state.description,
    payment: {
      amount,
      amountText: amount == null ? '' : formatZAR(amount),
      datePaid: state.details.datePaid,
      paidTo: state.details.paidTo,
    },
    bank: bank ? { name: bank.name, fraudLine: bank.lines[0].number, reference: state.bankRef } : null,
    outcomes: state.outcomes,
    startedAt: state.startedAt,
    firstSafeActionAt: state.firstActionAt,
    timeline: state.timeline,
    evidence: state.evidence,
  };
  const fingerprint = await sha256Hex(new TextEncoder().encode(canonicalJSON(body)));
  return { ...body, fingerprint };
}

function packView(p) {
  const row = (k, v) => (v ? h('tr', {}, h('th', { text: k }), h('td', { text: v })) : null);
  return h('section', { class: 'pack', 'aria-label': 'Incident pack' },
    h('p', { class: 'eyebrow', text: 'Incident pack' }),
    h('h1', { text: p.incident.title }),
    h('p', { class: 'small', text: p.notice }),
    h('table', {},
      h('tbody', {},
        row('Business', p.business),
        row('Made on', `${dateOf(p.generatedAt)} at ${timeOf(p.generatedAt)}`),
        row('Amount paid', p.payment.amountText),
        row('Date paid', p.payment.datePaid ? dateOf(`${p.payment.datePaid}T12:00:00`) : ''),
        row('Paid to', p.payment.paidTo),
        row('Bank', p.bank ? `${p.bank.name} (fraud line ${p.bank.fraudLine})` : ''),
        row('Bank reference', p.bank?.reference),
        row('Supplier said', p.outcomes.supplier),
        row('Mailbox check', p.outcomes.mailbox),
        row('First safe action', p.firstSafeActionAt ? `${elapsed(p.startedAt, p.firstSafeActionAt)} after opening Mgadi` : ''),
        row('Sorted as', p.incident.triage
          ? `${p.incident.title}: first read ${Math.round(p.incident.triage.confidence * 100)}% sure, by ${{ ai: 'AI', rules: 'built-in rules', offline: 'rules on the phone' }[p.incident.triage.source]}`
          : ''))),
    h('h2', { text: 'In the owner\'s words' }),
    h('p', { class: 'redacted', text: p.ownerDescription }),
    h('h2', { text: 'Timeline' }),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: 'Time' }), h('th', { text: 'What happened' }))),
      h('tbody', {}, p.timeline.map((e) => h('tr', {}, h('td', { class: 't', text: timeOf(e.at) }), h('td', { text: e.text }))))),
    h('h2', { text: 'Evidence fingerprints' }),
    evidenceList(p.evidence),
    h('p', { class: 'small', text: 'A matching fingerprint shows a file has not changed since it was added on this phone. It does not prove the file is genuine.' }),
    h('h2', { text: 'Who else to tell' }),
    h('ul', { class: 'plain' }, playbook.whoElse.map((w) => h('li', {}, h('strong', { text: `${w.who}: ` }), w.what, h('br'), h('span', { class: 'small', text: w.contact })))),
    h('h2', { text: 'Pack fingerprint' }),
    h('p', { class: 'hash', text: `SHA-256 ${p.fingerprint}` }));
}

function pack() {
  const field = (id, label, key, type = 'text', placeholder = '') => {
    const input = h('input', { id, type, autocomplete: 'off', placeholder });
    input.value = state.details[key];
    input.addEventListener('input', () => { state.details[key] = input.value; save(); });
    return [h('label', { for: id, text: label }), input];
  };
  const amountHint = h('p', { class: 'small' });
  const build = async () => {
    log('Made the incident pack'); // logged first, so the pack's own timeline includes it
    state.pack = await makePack();
    save();
    render();
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(state.pack, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `mgadi-incident-pack-${state.pack.generatedAt.slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    log('Downloaded the incident pack');
  };
  const clear = () => {
    if (!state.clearArmed) {
      state.clearArmed = true;
      render();
      return;
    }
    try { sessionStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    state = fresh();
    render();
  };

  const nodes = [
    h('p', { class: 'eyebrow no-print', text: 'Last step' }),
    h('h1', { class: 'no-print', text: 'Your incident pack' }),
    h('p', { class: 'lead no-print', text: 'One page for the bank, SAPS and your insurer. Everything below stays on this phone until you choose to share it.' }),
    h('div', { class: 'card no-print' },
      field('business', 'Business name', 'business'),
      field('amount', 'Amount paid', 'amount', 'text', 'e.g. R70 000'),
      amountHint,
      field('datePaid', 'Date paid', 'datePaid', 'date'),
      field('paidTo', 'Account it was paid to (for your bank)', 'paidTo', 'text', 'Bank and account number from the fake invoice'),
      h('button', { class: 'btn', type: 'button', onclick: build, text: state.pack ? 'Update the pack' : 'Make the incident pack' })),
  ];
  const amt = parseZAR(state.details.amount);
  amountHint.textContent = amt == null ? '' : `Shown as ${formatZAR(amt)}`;

  if (state.pack) {
    nodes.push(
      packView(state.pack),
      h('div', { class: 'no-print' },
        h('button', { class: 'btn', type: 'button', onclick: () => { log('Printed or saved the pack as PDF'); window.print(); }, text: 'Print or save as PDF' }),
        h('button', { class: 'btn secondary', type: 'button', onclick: download, text: 'Download the pack (.json)' }),
        h('button', { class: 'btn link', type: 'button', onclick: () => go('verify'), text: 'Check a file against this pack' })),
    );
  }
  nodes.push(h('div', { class: 'no-print' },
    h('button', { class: 'btn link', type: 'button', onclick: () => { state.stepIndex = 0; go('step'); }, text: 'Go back through the steps' }),
    h('button', {
      class: 'btn secondary', type: 'button', onclick: clear,
      text: state.clearArmed ? 'Tap again to clear everything from this phone' : 'Start again',
    })));
  return nodes;
}

// ---------- verifier ----------

function verify() {
  const out = h('div', {});
  let loadedPack = state.pack;
  const show = (ok, title, text) => out.replaceChildren(h('div', { class: `card ${ok ? 'ok' : 'bad'}` }, h('strong', { text: title }), h('p', { text })));

  const packInput = h('input', { type: 'file', id: 'packFile', accept: '.json,application/json' });
  packInput.addEventListener('change', async () => {
    const file = packInput.files[0];
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return show(false, 'Not an incident pack', 'This file is not a Mgadi incident pack.');
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.fingerprint !== 'string') {
      return show(false, 'Not an incident pack', 'This file has no Mgadi fingerprint.');
    }
    const { fingerprint, ...rest } = parsed;
    const again = await sha256Hex(new TextEncoder().encode(canonicalJSON(rest)));
    loadedPack = parsed;
    if (again === fingerprint) show(true, 'Pack unchanged', 'This pack is exactly as it was when it was made.');
    else show(false, 'Pack has been changed', 'Something in this pack was edited after it was made. Use the original.');
  });

  const fileInput = h('input', { type: 'file', id: 'checkFile' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const sha = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
    const pool = [...(loadedPack?.evidence || []), ...state.evidence];
    const hit = pool.find((e) => e.sha256 === sha);
    if (hit) show(true, 'Matches', `Same as "${hit.name}", fingerprinted at ${timeOf(hit.addedAt)}. It has not changed since.`);
    else show(false, 'No match', `This file's fingerprint (${sha.slice(0, 16)}…) is not in the pack. It is a different file, or it was changed.`);
  });

  return [
    h('h1', { text: 'Check a file' }),
    h('p', { class: 'lead', text: 'See whether an incident pack, or a piece of evidence, has changed since Mgadi fingerprinted it.' }),
    h('div', { class: 'card' },
      h('label', { for: 'packFile', text: '1. Incident pack (.json)' }),
      packInput,
      h('label', { for: 'checkFile', text: '2. A file to check against the pack' }),
      fileInput),
    out,
    h('p', { class: 'small', text: 'A match shows the file is unchanged since capture on the phone. It does not prove the file is genuine. The pack fingerprint is a checksum, not a signature: it catches changes, not a forger who recalculates it.' }),
    h('button', { class: 'btn secondary', type: 'button', onclick: () => go(state.pack ? 'pack' : 'home'), text: 'Back' }),
  ];
}

// ---------- start ----------

async function start() {
  try {
    [playbook, directory] = await Promise.all([
      fetch('data/playbook.json').then((r) => r.json()),
      fetch('data/fraud-lines.json').then((r) => r.json()),
    ]);
  } catch {
    app.replaceChildren(
      h('h1', { text: "Mgadi couldn't load." }),
      h('p', { text: 'Call the fraud number on the back of your bank card now.' }),
    );
    return;
  }
  state = load() || fresh();
  if (state.screen === 'checking' && !state.redacted) state.screen = 'home';
  if (!state.timeline.length) log('Opened Mgadi');
  state.clearArmed = false;
  document.getElementById('bankNow').addEventListener('click', openBank);
  render();
}

start();
