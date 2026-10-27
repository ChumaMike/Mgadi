// Three tools added on top of the incident pack: a POPIA notification DRAFT, a supplier payment-change check with a second
// person's approval, and a minimal responder handoff. Screens only: the rules live in public/shared/ and the one server route
// is /api/links (see server/links.js for exactly what the server keeps).
//
// Rules that hold on every screen here:
//  - Mgadi never blocks, holds or releases a payment, and never says it does.
//  - A status changes only when the server records an action by someone holding the right link. Nothing is assumed.
//  - Everything shown that came out of a link is untrusted: validated, cleaned and inserted as text only. No number or link
//    inside it is ever made clickable.
import { seal, open, randomId, randomToken, newKey, tokenHash, buildLink, parseLink } from '../shared/seal.js';
import { CHANGED, ARRIVED, QUESTIONS, NUMBER_SOURCE, RESULT, NOT_A_BLOCK, normalizeRequest, redFlags, normalizeVerification, verdict, normalizeCheckPayload, normalizeDecisionNote, buildCheckAudit } from '../shared/supplier-check.js';
import { buildResponderSummary, normalizeHandoffPayload, STATUS_WORDS, ACK_MEANING } from '../shared/responder.js';
import { buildPopiaDraft, popiaText, DISCLAIMER } from '../shared/popia.js';
import { verifyPack } from '../shared/pack.js';
import { formatTime } from '../shared/summary.js';

const WHY = {
  offline: 'This needs an internet connection. Nothing was sent.',
  503: 'Sharing links are not available on this server right now. Nothing was sent.',
  429: 'Too many tries. Please wait a few minutes.',
  404: 'This link is not valid, or it has expired.',
  409: 'This has already been answered, and the first answer stands.',
  403: 'This link cannot do that.',
};
const whyText = (error) => WHY[error?.code ?? error?.status] ?? 'Something went wrong. Nothing was changed.';
const at = (ms) => formatTime(new Date(ms).toISOString());

async function api(body) {
  let response;
  try { response = await fetch('/api/links', { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw Object.assign(new Error('offline'), { code: 'offline' }); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(String(data?.error ?? 'failed')), { status: response.status, data });
  return data;
}

export function initTools({ ui, bridge }) {
  const { element, button, plain, clear, mount } = ui;
  const canSeal = () => Boolean(globalThis.crypto?.subtle);
  const screen = (title) => { clear(); const card = element('section', '', { className: 'card' }); card.append(element('h1', title)); return card; };
  const say = (node, text, good = false) => { node.hidden = !text; node.textContent = text || ''; node.className = `notice ${good ? 'good' : 'bad'}`; };
  const alertBox = () => { const node = element('p', '', { role: 'alert' }); node.hidden = true; return node; };
  const statusBox = () => element('p', '', { role: 'status', className: 'notice tool-status' });
  const field = (card, label, node, id) => { node.id = id; card.append(element('label', label, { for: id }), node); return node; };
  const text = (max) => element('input', '', { type: 'text', maxlength: String(max), autocomplete: 'off' });
  const choose = (map, firstLabel) => { const node = element('select'); const first = plain('option', firstLabel); first.value = ''; node.append(first); for (const [value, label] of Object.entries(map)) { const o = plain('option', label); o.value = value; node.append(o); } return node; };
  const checkbox = (label, id) => { const l = element('label', '', { className: 'check', for: id }); const input = element('input', '', { id, type: 'checkbox' }); l.append(input, element('span', label)); return { l, input }; };
  const watch = (node, tick, ms = 8000) => { const timer = setInterval(async () => { if (!node.isConnected) { clearInterval(timer); return; } try { if ((await tick()) === 'stop') clearInterval(timer); } catch { /* try again next time */ } }, ms); };
  const needsCrypto = (card) => { if (canSeal()) return false; card.append(element('p', 'Sharing a link needs a secure connection (https or localhost) so the browser can lock the content. This page is not secure, so sharing is switched off. You can still read the check and the draft.', { className: 'notice' })); return true; };

  const storedDetails = () => {
    const d = element('details', '', { className: 'resources' });
    d.append(element('summary', "What Mgadi's server keeps"), element('p', "For each link the server keeps: the content in locked (encrypted) form that only people holding the link can open, a status, times, and two one-way fingerprints of the link codes. It never keeps what you typed in readable form, or the key (that stays in the link after the # sign). Mgadi writes no log. To slow down abuse, the running server remembers your internet address in its memory only, for up to an hour, and not with the link. The company that hosts it may keep its own technical logs, which Mgadi does not control. Everything about a link is deleted automatically after 7 days. If this server uses a different limit, the expiry time shown after you create the link is the one that applies."));
    return d;
  };

  const copyRow = (card, label, value) => {
    const id = `link-${Math.random().toString(36).slice(2, 8)}`;
    const input = element('input', '', { type: 'text', readonly: 'readonly', 'aria-label': label }); input.value = value; input.id = id;
    const note = element('p', '', { role: 'status', className: 'privacy' });
    const copy = button('Copy', async () => { try { await navigator.clipboard.writeText(value); note.textContent = 'Copied.'; } catch { input.select(); note.textContent = 'Select the text and copy it.'; } }, 'button secondary');
    const row = element('div', '', { className: 'field' }); row.append(element('label', label, { for: id }), input, copy);
    if (navigator.share) row.append(button('Share', () => navigator.share({ title: 'Mgadi', url: value }).catch(() => {}), 'button secondary'));
    row.append(note); card.append(row);
  };

  async function createRecord(kind, payload, pending) {
    // The ids, codes and key are made once per attempt, so a double click or a retry creates the SAME record, never two.
    // The sealed content (and its random IV) is made ONCE and reused, so a retry is byte-for-byte the same request.
    pending.ids ??= { id: randomId(), ownerToken: randomToken(), contactToken: randomToken(), key: newKey() };
    const { id, ownerToken, contactToken, key } = pending.ids;
    pending.body ??= { op: 'create', kind, id, oh: await tokenHash(ownerToken), ch: await tokenHash(contactToken), ...(await seal(payload, { key, kind, id })) };
    const result = await api(pending.body);
    return { ...pending.ids, expiresAt: result.expiresAt, createdAt: result.createdAt, contactLink: buildLink(location.origin, 'c', id, contactToken, key), ownerLink: buildLink(location.origin, 'o', id, ownerToken, key) };
  }
  const readRecord = (link) => api({ op: 'read', id: link.id, token: link.token });

  // ------------------------------------------------------------------ 1. POPIA draft
  function showPopia(pack, back) {
    const card = screen('POPIA notification: a draft template');
    card.append(element('p', DISCLAIMER, { className: 'notice bad' }));
    card.append(element('p', "Built from the incident pack you made. It stays on this device: nothing here is sent to Mgadi's server. Fill in what you know; anything left blank stays a visible blank for the information officer.", { className: 'privacy' }));
    const inputs = {
      responsibleParty: field(card, 'Responsible party (the business)', text(120), 'popia-party'), officerName: field(card, 'Information officer name', text(120), 'popia-officer'),
      officerContact: field(card, 'Information officer contact details', text(120), 'popia-contact'), categories: field(card, 'Kinds of personal information that may be involved', text(200), 'popia-categories'),
      count: field(card, 'Number of people who may be affected, if known', text(60), 'popia-count'),
    };
    const out = element('div', '', { className: 'popia-draft' });
    let latest = '';
    const render = () => {
      const draft = buildPopiaDraft(pack, Object.fromEntries(Object.entries(inputs).map(([k, n]) => [k, n.value])));
      latest = popiaText(draft); out.replaceChildren(plain('h2', draft.title));
      for (const section of draft.sections) { out.append(plain('h3', section.heading)); for (const line of section.lines) out.append(plain('p', line)); }
    };
    for (const n of Object.values(inputs)) n.addEventListener('input', render);
    render();
    const copyNote = element('p', '', { role: 'status', className: 'privacy' });
    card.append(out, button('Copy the draft text', async () => { try { await navigator.clipboard.writeText(latest); copyNote.textContent = 'Copied.'; } catch { copyNote.textContent = 'Copying is not available here. Use Download instead.'; } }, 'button secondary'),
      button('Download as a text file', () => { const url = URL.createObjectURL(new Blob([latest], { type: 'text/plain' })); const a = element('a', '', { href: url, download: 'popia-notification-draft.txt' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, 'button secondary'), copyNote,
      button('Back to the incident summary', back, 'button secondary'));
    mount(card);
  }

  // ------------------------------------------------------------------ 2. Supplier payment-change check
  function showCheckStart() {
    const card = screen("Check a supplier's change before you pay");
    card.append(element('p', NOT_A_BLOCK, { className: 'notice' }));
    card.append(button('I have already paid: take me to the bank first', () => bridge.alreadyPaid(), 'button danger'));
    card.append(element('p', 'If money has already left your account, do not use this check. Your bank comes first.', { className: 'privacy' }));
    const supplier = field(card, 'Supplier', text(80), 'chk-supplier');
    const changed = field(card, 'What changed?', choose(CHANGED, 'Choose one'), 'chk-changed');
    const arrived = field(card, 'How did the request arrive?', choose(ARRIVED, 'Choose one'), 'chk-arrived');
    const amount = field(card, 'Amount to be paid (optional)', text(30), 'chk-amount');
    const note = field(card, 'Anything else that looked odd (optional)', text(200), 'chk-note');
    const fieldset = element('fieldset', '', { className: 'tool-set' }); fieldset.append(element('legend', 'Did any of these apply?'));
    const boxes = Object.entries(QUESTIONS).map(([id, label]) => { const c = checkbox(label, `chk-q-${id}`); fieldset.append(c.l); return [id, c.input]; });
    card.append(fieldset);
    const problem = alertBox(); card.append(problem);
    card.append(button('Check for red flags', () => {
      const { value, errors } = normalizeRequest({ supplier: supplier.value, changed: changed.value, arrived: arrived.value, amount: amount.value, note: note.value, flags: boxes.filter(([, n]) => n.checked).map(([id]) => id) });
      if (errors.length) { say(problem, `Please fill in: ${errors.map((e) => ({ supplier: 'the supplier', changed: 'what changed', arrived: 'how it arrived' }[e])).join(', ')}.`); return; }
      showCheckResult(value);
    }), button('Back', () => bridge.showHome(), 'button secondary'));
    mount(card);
  }

  function showCheckResult(request) {
    const card = screen('Red flags, and what to do before paying');
    card.append(element('p', 'VERIFY BEFORE PAYING. Do not pay to the new details yet. Phone the supplier yourself, on a number you already had before this request.', { className: 'notice bad' }));
    card.append(element('p', NOT_A_BLOCK, { className: 'notice' }));
    const facts = element('ul'); for (const line of [`Supplier: ${request.supplier}`, `Changed: ${CHANGED[request.changed]}`, `Arrived by: ${ARRIVED[request.arrived]}`, ...(request.amount ? [`Amount: ${request.amount}`] : [])]) facts.append(plain('li', line));
    card.append(element('h2', 'What you told Mgadi'), facts, element('h2', 'Red flags'));
    const flags = redFlags(request); const list = element('ul', '', { className: 'flags' });
    if (!flags.length) list.append(plain('li', 'No red flags from what you told Mgadi. That does not mean the change is genuine. Verify it anyway.'));
    for (const f of flags) { const li = document.createElement('li'); li.append(plain('strong', `${f.level === 'high' ? 'High' : f.level === 'medium' ? 'Medium' : 'Low'}: `), plain('span', `${f.text} ${f.why}`)); list.append(li); }
    card.append(list);

    card.append(element('h2', 'Record your independent check'));
    card.append(element('p', 'Phone the supplier on a number you already had: from an old invoice, a contract, an earlier payment or your own saved contacts. Not a number from the request. Mgadi does not keep the number.', { className: 'privacy' }));
    const who = field(card, 'Who did you speak to (name and role)?', text(80), 'ver-who');
    const source = field(card, 'Where did the phone number come from?', choose(NUMBER_SOURCE, 'Choose one'), 'ver-source');
    const result = field(card, 'What was the result?', choose(RESULT, 'Choose one'), 'ver-result');
    const when = element('input', '', { type: 'datetime-local' }); const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); when.value = now.toISOString().slice(0, 16); field(card, 'When did you call?', when, 'ver-when');
    const vnote = field(card, 'Short note (optional)', text(140), 'ver-note');
    const mine = checkbox('I made this call myself', 'ver-mine'); card.append(mine.l);
    const problem = alertBox(); const outcome = statusBox(); outcome.hidden = true; const approveZone = element('div'); let verification = null;
    card.append(problem, button('Save my check', () => {
      const parsed = normalizeVerification({ who: who.value, numberSource: source.value, result: result.value, calledMyself: mine.input.checked, calledAt: when.value ? new Date(when.value).toISOString() : '', note: vnote.value });
      if (parsed.errors.length) { say(problem, `Please complete: ${parsed.errors.map((e) => ({ who: 'who you spoke to', numberSource: 'where the number came from', result: 'the result', calledMyself: 'tick that you made the call yourself', calledAt: 'when you called' }[e])).join(', ')}.`); return; }
      say(problem, ''); verification = parsed.value; const v = verdict(verification);
      outcome.hidden = false; outcome.textContent = v.text; outcome.className = `notice ${v.state === 'verified_independent' ? 'good' : 'bad'} tool-status`;
      renderApprove(approveZone, request, verification, v);
    }), outcome, approveZone, button('Start again', showCheckStart, 'button secondary'));
    mount(card);
  }

  function renderApprove(zone, request, verification, v) {
    zone.replaceChildren(element('h2', 'A second person approves'));
    if (v.state === 'denied') { zone.append(element('p', 'Do not ask for approval. Do not pay.', { className: 'notice bad' }), button('I have already paid: take me to the bank first', () => bridge.alreadyPaid(), 'button danger')); return; }
    if (v.state !== 'verified_independent') { zone.append(element('p', 'A second person can be asked only after an independent check that you report as confirmed. Fix the check above first.', { className: 'notice' })); return; }
    zone.append(element('p', 'Choose someone else in your business. Send them the link by a different route from the one the supplier used. They do not need an account. Anyone who holds the link can answer it, and Mgadi cannot tell who that is.', { className: 'privacy' }));
    if (needsCrypto(zone)) return;
    const problem = alertBox(); const pending = {}; let busy = false;
    const go = button('Create a link for the second person', async () => {
      if (busy) return; busy = true; go.disabled = true; say(problem, '');
      try {
        const made = await createRecord('check', { v: 1, type: 'supplier-check', request, verification }, pending);
        showCheckOwner({ ...made, role: 'o', token: made.ownerToken }, { fresh: true });
      } catch (error) { say(problem, whyText(error)); busy = false; go.disabled = false; }
    });
    zone.append(go, problem, storedDetails());
  }

  async function showCheckOwner(link, { fresh = false } = {}) {
    let rec; try { rec = await readRecord(link); } catch (error) { return showLinkProblem(whyText(error)); }
    let payload; try { payload = normalizeCheckPayload(await open(rec, { key: link.key, kind: 'check', id: link.id })); } catch (error) { return showLinkProblem(error.message); }
    if (!payload) return showLinkProblem('This link is damaged or incomplete. Ask the sender for a new one.');
    const card = screen('Supplier check: waiting for the second person');
    card.append(element('p', NOT_A_BLOCK, { className: 'notice' }));
    const contactLink = link.contactToken ? buildLink(location.origin, 'c', link.id, link.contactToken, link.key) : null;
    if (fresh && contactLink) {
      card.append(element('h2', 'Send this link to your second person'));
      copyRow(card, 'Link for the second person', contactLink);
      card.append(element('p', `It works until ${at(rec.expiresAt)} and then is deleted. Anyone holding it can answer it.`, { className: 'privacy' }));
      card.append(element('h2', 'Keep this link to see their answer'));
      copyRow(card, 'Your link to see the answer', buildLink(location.origin, 'o', link.id, link.token, link.key));
    } else card.append(element('p', `This record expires ${at(rec.expiresAt)}.`, { className: 'privacy' }));
    const status = statusBox(); const zone = element('div'); card.append(status, zone, storedDetails(), button('Back to the start', () => bridge.showHome(), 'button secondary')); mount(card);
    let shown = '';
    const render = async (data) => {
      const key = `${data.status}:${data.event?.at ?? ''}`; if (key === shown) return; shown = key;
      if (data.status === 'pending') { status.textContent = 'Waiting for your second person. Mgadi cannot tell whether they have opened the link.'; return; }
      let note = { by: '', note: '' }; try { if (data.event?.note) note = normalizeDecisionNote(await open(data.event.note, { key: link.key, kind: 'check', id: link.id, part: 'decision' })); } catch { /* the note is optional */ }
      const approved = data.status === 'approved';
      status.textContent = `${approved ? 'Approved' : 'Rejected'} by the second person at ${at(data.event.at)} (Mgadi's server clock).${note.by ? ` Name they typed: ${note.by}.` : ''}${note.note ? ` Their note: ${note.note}` : ''} ${approved ? 'This does not release or block any payment: you decide and pay through your own bank.' : 'Do not pay to the new details.'}`;
      status.className = `notice ${approved ? 'good' : 'bad'} tool-status`;
      zone.replaceChildren(button('Create the audit record', async () => {
        const record = await buildCheckAudit({ payload, decision: { status: data.status, at: data.event.at, by: note.by, note: note.note }, checkId: link.id, createdAt: rec.createdAt });
        showAudit(zone, record);
      }, 'button secondary'));
    };
    await render(rec);
    watch(status, async () => { const data = await readRecord(link); await render(data); return data.status === 'pending' ? 'go' : 'stop'; });
  }

  function showAudit(zone, record) {
    const json = JSON.stringify(record, null, 2);
    const out = element('div', '', { className: 'audit' });
    out.append(element('h2', 'Audit record'), element('p', record.statement, { className: 'notice' }), element('p', 'Fingerprint (SHA-256):'), plain('p', record.fingerprint, 'hash'));
    const pre = element('pre', json); pre.className = 'pack-json';
    const download = button('Export the audit record (.json)', () => { const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const a = element('a', '', { href: url, download: 'mgadi-supplier-check.json' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
    const verifyInput = element('input', '', { type: 'file', accept: '.json,application/json', 'aria-label': 'Audit record to verify' }); const result = element('p', '', { role: 'status' });
    verifyInput.addEventListener('change', async () => { try { const ok = await verifyPack(JSON.parse(await verifyInput.files[0].text())); result.textContent = ok ? 'Unchanged: its fingerprint matches.' : 'This record has been changed.'; result.className = ok ? 'notice good' : 'notice bad'; } catch { result.textContent = 'That is not a valid Mgadi record.'; result.className = 'notice bad'; } });
    out.append(download, element('p', 'Mgadi does not keep this record. If you do not export it, it is gone.', { className: 'privacy' }), element('h3', 'Check a saved record'), verifyInput, result, pre);
    zone.replaceChildren(out);
  }

  async function showApprover(link) {
    let rec; try { rec = await readRecord(link); } catch (error) { return showLinkProblem(whyText(error)); }
    let payload; try { payload = normalizeCheckPayload(await open(rec, { key: link.key, kind: 'check', id: link.id })); } catch (error) { return showLinkProblem(error.message); }
    if (!payload) return showLinkProblem('This link is damaged or incomplete. Ask the sender for a new one.');
    const { request, verification } = payload; const v = verdict(verification);
    const card = screen('A payment change to approve');
    card.append(element('p', "Someone sent you this link. Mgadi has not checked who. Do not call any phone number or open any link written inside it: use contact details you already had.", { className: 'notice bad' }), element('p', NOT_A_BLOCK, { className: 'notice' }));
    const facts = element('ul'); for (const line of [`Supplier: ${request.supplier}`, `Changed: ${CHANGED[request.changed]}`, `Arrived by: ${ARRIVED[request.arrived]}`, ...(request.amount ? [`Amount: ${request.amount}`] : []), ...(request.note ? [`Their note: ${request.note}`] : [])]) facts.append(plain('li', line));
    card.append(element('h2', 'The request'), facts, element('h2', 'Red flags'));
    const list = element('ul', '', { className: 'flags' }); for (const f of redFlags(request)) { const li = document.createElement('li'); li.append(plain('strong', `${f.level === 'high' ? 'High' : 'Medium'}: `), plain('span', f.text)); list.append(li); }
    if (!list.children.length) list.append(plain('li', 'None reported. That does not mean the change is genuine.'));
    card.append(list, element('h2', 'The check the sender reports'));
    const vlist = element('ul'); for (const line of [`Spoke to: ${verification.who}`, `Number came from: ${NUMBER_SOURCE[verification.numberSource]}`, `Result: ${RESULT[verification.result]}`, `Called at (as reported): ${formatTime(verification.calledAt)}`, ...(verification.note ? [`Note: ${verification.note}`] : [])]) vlist.append(plain('li', line));
    card.append(vlist, element('p', v.text, { className: `notice ${v.state === 'verified_independent' ? 'good' : 'bad'}` }));
    const status = statusBox(); const zone = element('div'); card.append(zone, status); mount(card);
    const draw = (data) => {
      zone.replaceChildren();
      if (data.status !== 'pending') { status.textContent = `This was ${data.status} at ${at(data.event.at)}. That answer is final and cannot be changed.`; status.className = 'notice tool-status'; return; }
      status.textContent = 'Waiting for your answer.';
      const by = field(zone, 'Your name (optional, shown to the sender)', text(60), 'dec-by'); const note = field(zone, 'A short note (optional)', text(140), 'dec-note');
      zone.append(element('p', 'Approving means you agree the checks look sound. It does not release or block a payment.', { className: 'privacy' }));
      const problem = alertBox(); let busy = false;
      const decide = (choice) => async () => {
        if (busy) return; busy = true; approve.disabled = reject.disabled = true; say(problem, '');
        try {
          const noteText = normalizeDecisionNote({ by: by.value, note: note.value });
          const sealed = noteText.by || noteText.note ? await seal(noteText, { key: link.key, kind: 'check', id: link.id, part: 'decision' }) : undefined;
          await api({ op: 'decide', id: link.id, token: link.token, decision: choice, ...(sealed ? { note: sealed } : {}) });
        } catch (error) { if (error.status !== 409) { say(problem, whyText(error)); busy = false; approve.disabled = reject.disabled = false; return; } }
        draw(await readRecord(link));
      };
      const approve = button('Approve', decide('approved')); const reject = button('Reject', decide('rejected'), 'button danger');
      zone.append(problem, approve, reject);
    };
    draw(rec);
  }

  // ------------------------------------------------------------------ 3. Responder handoff
  function showHandoffCompose(pack, back) {
    const card = screen('Send a summary to someone who is helping');
    const summary = buildResponderSummary(pack);
    card.append(element('p', "You approve exactly what is shared. Mgadi does not send anything itself: it makes a link that you pass on by your own channel, and Mgadi cannot tell whether it was delivered.", { className: 'notice' }));
    const status = statusBox(); status.textContent = STATUS_WORDS.draft; card.append(status);
    card.append(element('h2', 'Preview: this is what the contact will see'));
    const list = element('ul', '', { className: 'preview-box' }); for (const line of summary.lines) list.append(plain('li', line)); card.append(list);
    const from = field(card, 'Your name, shown to the contact (optional)', text(60), 'ho-from');
    const label = field(card, 'Who is this for? (only shown to you)', text(60), 'ho-label');
    const approve = checkbox('I have read this summary and I approve sharing it with the person I choose', 'ho-approve'); card.append(approve.l);
    const problem = alertBox(); const zone = element('div'); const pending = {}; let busy = false;
    const make = button('Create the link', async () => {
      if (busy || !approve.input.checked) return; busy = true; make.disabled = true; say(problem, '');
      try {
        const made = await createRecord('handoff', { v: 1, type: 'handoff', from: from.value, summary }, pending);
        status.textContent = STATUS_WORDS.sent;
        zone.replaceChildren(element('h2', `Send this link to ${label.value.trim() ? label.value.trim().slice(0, 60) : 'your contact'}`));
        copyRow(zone, 'Link for the contact', made.contactLink);
        zone.append(element('p', `It works until ${at(made.expiresAt)} and then is deleted. Anyone holding it can acknowledge it.`, { className: 'privacy' }));
        copyRow(zone, 'Your link to see the status', made.ownerLink);
        const link = { id: made.id, token: made.ownerToken, key: made.key };
        watch(status, async () => { const data = await readRecord(link); if (data.status === 'acknowledged') { status.textContent = `${STATUS_WORDS.acknowledged} (${at(data.event.at)}, Mgadi's server clock)`; status.className = 'notice good tool-status'; return 'stop'; } return 'go'; });
      } catch (error) { say(problem, whyText(error)); busy = false; approve.input.dispatchEvent(new Event('change')); }
    });
    make.disabled = true; approve.input.addEventListener('change', () => { make.disabled = !approve.input.checked || busy; });
    card.append(problem, make, zone);
    needsCrypto(card);
    if (!canSeal()) make.disabled = true;
    card.append(storedDetails(), button('Back to the incident summary', back, 'button secondary'));
    mount(card);
  }

  async function showContact(link) {
    let rec; try { rec = await readRecord(link); } catch (error) { return showLinkProblem(whyText(error)); }
    let payload; try { payload = normalizeHandoffPayload(await open(rec, { key: link.key, kind: 'handoff', id: link.id })); } catch (error) { return showLinkProblem(error.message); }
    if (!payload) return showLinkProblem('This link is damaged or incomplete. Ask the sender for a new one.');
    const card = screen(payload.summary.title);
    card.append(element('p', `Someone shared this summary with you${payload.from ? `, and gave the name ${payload.from}` : ''}. Mgadi has not checked who sent it. Do not call any number or open any link written inside it: use contact details you already had.`, { className: 'notice bad' }));
    const list = element('ul', '', { className: 'preview-box' }); for (const line of payload.summary.lines) list.append(plain('li', line)); card.append(list);
    const status = statusBox(); const zone = element('div'); card.append(zone, status, element('p', ACK_MEANING, { className: 'privacy' })); mount(card);
    const draw = (data) => {
      zone.replaceChildren();
      if (data.status === 'acknowledged') { status.textContent = `Acknowledged at ${at(data.event.at)}.`; status.className = 'notice good tool-status'; return; }
      status.textContent = STATUS_WORDS.sent; const problem = alertBox(); let busy = false;
      const ack = button('Acknowledge', async () => { if (busy) return; busy = true; ack.disabled = true; try { await api({ op: 'ack', id: link.id, token: link.token }); draw(await readRecord(link)); } catch (error) { say(problem, whyText(error)); busy = false; ack.disabled = false; } });
      zone.append(ack, problem);
    };
    draw(rec);
  }

  async function showHandoffOwner(link) {
    let rec; try { rec = await readRecord(link); } catch (error) { return showLinkProblem(whyText(error)); }
    let payload; try { payload = normalizeHandoffPayload(await open(rec, { key: link.key, kind: 'handoff', id: link.id })); } catch (error) { return showLinkProblem(error.message); }
    if (!payload) return showLinkProblem('This link is damaged or incomplete. Ask the sender for a new one.');
    const card = screen('Summary you shared: status');
    const status = statusBox(); card.append(status, element('p', `This record expires ${at(rec.expiresAt)}.`, { className: 'privacy' }), element('h2', 'What was shared'));
    const list = element('ul', '', { className: 'preview-box' }); for (const line of payload.summary.lines) list.append(plain('li', line)); card.append(list, button('Back to the start', () => bridge.showHome(), 'button secondary')); mount(card);
    const draw = (data) => { status.textContent = data.status === 'acknowledged' ? `${STATUS_WORDS.acknowledged} (${at(data.event.at)}, Mgadi's server clock)` : STATUS_WORDS.sent; status.className = `notice ${data.status === 'acknowledged' ? 'good' : ''} tool-status`; };
    draw(rec); watch(status, async () => { const data = await readRecord(link); draw(data); return data.status === 'acknowledged' ? 'stop' : 'go'; });
  }

  // ------------------------------------------------------------------ links
  function showLinkProblem(message) {
    const card = screen('This link cannot be used');
    card.append(element('p', message, { className: 'notice bad' }), element('p', 'Nothing has been changed. A link that is cut short, edited or expired cannot be repaired: ask the sender for a new one.'), button('Go to the start', () => bridge.showHome(), 'button secondary'));
    mount(card);
  }

  // Returns true when the address held a Mgadi link (valid or not), so the caller does not show the home screen over it.
  function openFromHash(hash = location.hash) {
    if (!String(hash).startsWith('#mgadi=')) return false;
    const link = parseLink(hash);
    if (!link) { showLinkProblem('This link is damaged or incomplete. Ask the sender for a new one.'); return true; }
    if (!canSeal()) { showLinkProblem('Opening this link needs a secure connection (https or localhost).'); return true; }
    (async () => {
      let rec; try { rec = await readRecord(link); } catch (error) { showLinkProblem(whyText(error)); return; }
      if (link.role === 'c') return rec.kind === 'check' ? showApprover(link) : showContact(link);
      return rec.kind === 'check' ? showCheckOwner(link) : showHandoffOwner(link);
    })();
    return true;
  }

  return {
    openFromHash,
    homeButton: () => button("Check a supplier's changed bank details before paying", showCheckStart, 'button secondary tool-entry'),
    packButtons: (pack, back) => { const f = document.createDocumentFragment(); f.append(button('Draft a POPIA notification (template)', () => showPopia(pack, back), 'button secondary'), button('Send a summary to a helper', () => showHandoffCompose(pack, back), 'button secondary')); return f; },
    showCheckStart, showPopia, showHandoffCompose,
  };
}
