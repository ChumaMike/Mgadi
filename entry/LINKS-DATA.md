# What Mgadi's server keeps for a link, and for how long

**Applies to:** the supplier payment-change check and the responder handoff (branch `feature/popia-supplier-check-handoff`). The POPIA notification draft is made and downloaded in the browser and **sends nothing to any server**.

**Status:** written from the code and its tests on 27–28 October 2026. It has not been reviewed by a lawyer or a privacy practitioner, and it has never been run against a real hosting store (see §7).

## 1. In one paragraph

When an owner asks a second person to approve a supplier change, or sends a helper a summary, the **browser locks the content** (AES-GCM, a fresh 256-bit key) **before anything leaves the device**. The key is put only in the part of the link after the `#`, which browsers never send to a server. Mgadi's server keeps the locked content, a status, times, and one-way fingerprints of two link codes. It **cannot read** what the owner wrote, who the supplier is, the amount, or the summary. Everything about a link is deleted automatically **7 days** after it was made (configurable, never more than 7 days).

## 2. Exactly what is stored, per link

Two entries in the store, and nothing else:

**`l:<id>` — the record** (written once, never changed)

| Field | What it is | Readable by the server? |
|---|---|---|
| `kind` | `check` or `handoff` | Yes |
| `ct`, `iv` | The locked content (AES-GCM ciphertext, at most 6,000 characters) and its one-time IV | **No** (needs the key, which the server never receives) |
| `oh` | SHA-256 of the **owner's** random 128-bit code | It is a fingerprint; the code cannot be recovered from it |
| `ch` | SHA-256 of the **second person's / contact's** random 128-bit code | Same |
| `createdAt`, `expiresAt` | This server's clock, in milliseconds | Yes |

The `id` (16 random characters, chosen by the browser) is the name of the entry.

**`e:<id>` — the answer** (at most one; the first valid answer wins and nothing can change it)

| Field | What it is | Readable by the server? |
|---|---|---|
| `status` | `approved`, `rejected` or `acknowledged` | Yes |
| `at` | This server's clock when the answer arrived | Yes |
| `note` (optional) | The second person's typed name and note, as ciphertext (at most 1,200 characters) | **No** |

That is the whole of it. There is **no** user table, no account, no email address, no phone number, no name, no list of links, no audit trail and no log of who opened what.

## 3. How long

| Thing | How long |
|---|---|
| The record and the answer | **7 days (168 hours) from creation**, then deleted by the store's own expiry. Set by `MGADI_LINK_TTL_HOURS`; the value is clamped to **1 hour – 7 days**, so a mistaken setting cannot make it longer. |
| The answer | Never outlives its record: it gets the record's remaining time. |
| Memory store (local use) | Expired entries stop being served at once. They are physically removed by the first request that arrives at least one minute after the previous clean-up; if nobody calls, they sit unreadable in the server's memory until the next request or a restart. A restart deletes everything at once. |
| Shared store (Upstash-style REST) | Expiry is set natively on each key (`EX`). |
| The caller's internet address | Held **in the running server's memory only** by the rate limiter: up to 1 hour for making links, 10 minutes for opening them, in a map capped at 10,000 entries, per instance. Never written to the store or to a file, and gone when the server restarts. |
| Server logs | Mgadi's code writes none. **The hosting company and the store provider may keep their own technical logs, which Mgadi does not control.** |
| The audit record (supplier check) | **Not kept by Mgadi at all.** The owner's browser builds it and the owner downloads it. If the owner does not save it, it is gone. |
| The POPIA draft | Not kept by Mgadi at all (made and downloaded in the browser). |

There is **no "delete now" button**. A link can only expire. (Not built; see §8.)

## 4. What the server sees while a request is happening, and does not keep

- The request itself: the `id`, the raw code being presented (see below), and the decision. A raw code is sent each time a link is **used** (to read, decide or acknowledge); the server hashes it, compares it with the stored fingerprint and discards it. It is sent in the request body, not in the address.
- The caller's address and browser details, as any web server sees them. Mgadi's code does not store or log these (except the in-memory rate counter above).

## 5. What the server never has

The plaintext (supplier, amount, names, notes, red flags, the helper summary); the key; a raw code (it stores only the fingerprint); evidence files or their fingerprints (these are not in the helper summary either); the owner's incident story, business name or amount; the audit record; the POPIA draft.

Tested by reading the physical store after real use (`test/links.test.js`: nothing readable, no raw code, no key, no sentinel text) and by capturing every request a real browser sends (`scripts/tools-smoke.mjs`: making a link sends no text, no key and no raw code; across the owner's whole session the typed text, the key and the caller's name are never sent).

## 6. Who can read what

| Who | Can see | Cannot see |
|---|---|---|
| **Anyone holding the link** (owner's or the second person's) | The full content, because the key is in the link. The second person's link can also approve/reject (or acknowledge), once. The owner's link can only watch the answer | — |
| **The person or service you send the link through** (WhatsApp, email, SMS, a chat) | The whole link, **including the key and the code**, so they can open it | — |
| **Mgadi's operator / the hosting company / the store provider** | Record kind, sizes, the times, the status, ciphertext, fingerprints, the network details of each request | The content, unless they also obtain the link |
| **Someone on the owner's or the second person's device or browser** | The link in the address bar and **in browser history** (the address stays after opening) | — |
| **An attacker who guesses** | Nothing: ids and codes are 96–128 bits of randomness; a wrong id, a wrong code and an expired link all give the same "not found" answer | — |

## 7. What is configured, and what is not

| Setting | Meaning |
|---|---|
| `MGADI_LINK_TTL_HOURS` | Lifetime of a link in hours. Default 168. Clamped to 1–168. |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` + `KV_REST_API_TOKEN`) | A shared store spoken to over **https only**. If any store call fails the request is **refused** (503), never pretended. |
| none of the above, running locally | A memory store, per process. Fine for a demo on one machine. Links disappear on restart. |
| none of the above, on Vercel | **Links are refused (503 `links_unavailable`)**, because memory is not shared between serverless instances and links would vanish at random. |

- **No store account exists.** Nothing has been created, paid for or deployed. A shared store is something the account owner has to create (it may have a free tier; that is for the owner to check).
- The shared-store code has been exercised **only against a fake** that speaks the same protocol (`test/links.test.js`). It has **never** talked to a real Upstash or Vercel KV store.
- Nothing here sends an email, SMS or notification. **The owner shares the link themselves.** Mgadi cannot tell whether a link was delivered or opened, and says so on screen.

## 8. Limits, stated plainly

1. **No accounts means no identity.** The server can show that *someone holding the link* pressed Approve. It cannot show *who*. The name the second person types is just text.
2. **A link can be forwarded.** Whoever has it can read it and (if it is the second person's) answer first. The first answer is final.
3. **The sharing channel can read the link.** Pick a channel you trust. Do not post a link publicly.
4. **Browser history keeps the link.** A person with access to the device could open it until it expires.
5. **A compromised Mgadi server could serve a changed web page** that sends the key somewhere. Locking content in the browser protects against a server that only *stores*; it does not protect against a server that *serves bad code*. (Integrity is not authenticity; same limit as the offline copy, `SECURITY-REVIEW.md` A08.)
6. **The audit record is a checksum, not a signature.** It shows the record has not changed since it was made. It does not prove who said what, and Mgadi does not hold a copy to compare against. The server's clock time on the answer is the only time Mgadi vouches for, and only as "this server received the answer then".
7. **Per-instance limits.** The rate limits are counted per running instance; on a serverless host this slows a casual flood and no more.
8. **WebCrypto needs https or localhost.** On plain http (for example a phone opening the laptop's address) the screens say sharing is switched off; reading the check and making the POPIA draft still work.
9. **No early deletion**, no revocation of a single link, no notification when an answer arrives. The owner's page checks every 8 seconds while it is open.
10. **Not built:** delivery of links (email/SMS/WhatsApp), approver identity checks, a server-signed attestation, persistent audit storage, translations of the new screens, and any real-store, real-phone or screen-reader test.

## 9. Change this only with agreement

The statements in §2–§5 are product promises. If a change would add a field to either entry, keep something longer, log something, or let the server read content, update this file and `SOURCE-OF-TRUTH.md` in the same change and get the team's agreement first. `test/links.test.js` fails if a readable value, a raw code or the key appears in the store.
