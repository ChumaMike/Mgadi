# Mgadi design system

The look of Mgadi lives in three stylesheets, loaded in this order: `styles.css` (the original controls and offline behaviour), `experience.css` (the calm ivory-and-forest presentation, journey steps, voice panel) and **`design.css`** (the tokens and shared components below). `design.css` loads last, so it is the place to change how the home screen, status chips, step tracker and optional groups look. Icons come from one small module, `public/shared/icons.js`, drawn with DOM calls (no image files, no string-built markup, so the strict content security policy still applies).

This describes how the interface is built. It is not an accessibility conformance claim.

## Tokens (`:root` in `design.css`)

| Group | Tokens | Notes |
|---|---|---|
| Surfaces | `--ds-surface` ivory, `--ds-card`, `--ds-soft`, `--ds-line`, `--ds-line-strong` | A warm light page, never a dark one |
| Text | `--ds-ink`, `--ds-muted` | |
| Brand | `--ds-brand` forest, `--ds-teal`, `--ds-teal-soft`, `--ds-emerald` | The logo is navy and teal, so teal is the accent |
| Status (pairs) | `--ds-ok-*`, `--ds-warn-*`, `--ds-danger-*`, `--ds-info-*`, `--ds-neutral-*` (`-bg`, `-ink`, `-line`) | Amber (`warn`) is for warnings only |
| Space | `--ds-space-1` .25rem to `--ds-space-7` 3rem | 4px base |
| Shape | `--ds-radius-s` 10px, `-m` 16px, `-l` 22px, `-pill` | |
| Type | `--ds-text-xs` .78rem, `-s` .9, `-m` 1, `-l` 1.15, `-xl` 1.4, `-hero` fluid | All in `rem`, so the text-size setting (up to 200%) scales everything |
| Targets | `--ds-target` 48px | Controls people tap are at least 44px; 48px is the design floor |
| Motion | `--ds-ease` 160ms | Removed by "Reduce movement" and by the device's reduce-motion setting |

High contrast (`html[data-contrast='true']`) swaps every token for black, white and dark forest and gives boxes a 2px black border. Text size, contrast and reduced motion are the person's settings, not a theme: no account is needed.

## Contrast actually measured (WCAG relative-luminance ratio)

| Pair | Ratio |
|---|---:|
| text on page / on card | 13.4:1 / 14.3:1 |
| muted text on page / card / soft | 5.9:1 / 6.3:1 / 5.6:1 |
| white on forest (primary button) | 11.8:1 |
| white on teal (supplier-check button, current step) | 6.0:1 |
| white on emerald (step done) | 5.3:1 |
| white on danger red (bank button) | 6.3:1 |
| ok / warn / danger / info / neutral ink on their background | 7.6 / 8.8 / 7.4 / 8.1 / 8.8:1 |

All are above 4.5:1. Axe also runs a colour-contrast check on every audited screen and in high-contrast mode; passing it is evidence, not proof.

## Components

| Component | Class | Used for | Notes |
|---|---|---|---|
| Action card | `.action-card`, `--urgent`, `--calm` | The two doors on the home screen | Red edge = emergency, teal edge = prevention. The edge is decoration: every card has a heading and words |
| Situation row | `.situation-card` (inside `.incident-choices`) | The five "what happened" choices | 50 to 54px tall, icon + words + arrow |
| Secondary row | `.secondary-item` (`secondaryItem()` in `app.js`) | Talk, documents, incident pack, settings, pack actions | One control, one line saying what it does |
| Continue card | `.continue-card` | Shown only while an incident is open on the page | Says nothing is saved in the browser |
| Status banner | `.ds-status--ok / warn / danger / info` | Supplier verdict (Confirmed / Unverified / Rejected), "already paid", pack state | Always a symbol plus words. Never colour alone |
| Chip | `.ds-chip` (+ `--ok / warn / danger / info`) | Evidence source kind and fingerprint | |
| Step tracker | `.ds-steps` | Supplier check: Describe, Review, Record | `aria-current="step"`; finished steps carry "(done)" for screen readers |
| Optional group | `details.ds-optional` | Parts of a form that most people can skip | Closed by default so the short path stays short |
| Key/value list | `.ds-kv` | "What you told Mgadi" | Stacks on narrow screens |

Rules: no inline styles (policy), text set with `textContent` (never parsed as HTML), every icon `aria-hidden` with a text label beside it, every control reachable by keyboard with a 3px focus ring, and nothing is built only for a mouse.

## States, and where each one lives

The last column says what is actually tested. "Not tested" means the state exists in the product but no automated check looks at it.

| State | How it looks and where | Tested by |
|---|---|---|
| **Loading** | "Checking safely…" screen with a button to use the guide on the phone now; "Reading the file on this device…" status line | The triage timeout and fallback: `test/triage-client.test.js`. The wording of both screens: not tested |
| **Error** | A `role="alert"` box (`.notice.bad`) that says what to fix in words ("Please fill in: the supplier, what changed, how it arrived."), never colour alone; connection problems say "Nothing was sent." | `a11y-smoke`, `tools-smoke` |
| **Empty** | A sentence, not a blank: "Choose at least one detail above to compare.", "You have not chosen any detail yet.", "No evidence files were fingerprinted. Keep the original messages and proof of payment." | Not tested |
| **Offline / update** | A status line (`#offline-status`) at the top when something needs attention and at the bottom when all is well; a sticky banner when a newer version is ready | `pwa-smoke`, `update-smoke` |
| **Focus** | A 3px forest outline with an amber halo on every control; the skip link sits above the sticky header; focus moves to the new screen's heading; scrolled-to content stays clear of the header and the update banner (`scroll-padding-top`) | `ux-smoke` (ring drawn, keyboard reaches the choices), `experience-smoke` (focused controls stay clear of the header) |
| **Disabled** | A control that cannot be used says why next to it (for example voice that is not set up says so and offers text guidance) | `voice-smoke` |

## Breakpoints

Phone first (no media query). Adjustments at 600px (header and spacing), 760px (the two doors sit side by side, secondary rows in two columns) and 900px (voice panel docks beside the page). Widths from 320 to 1920px are tested for sideways scrolling.

## What is not tokenised yet

`styles.css` and `experience.css` still contain older literal colours (counted: 66 hex colours in `styles.css` and 56 in `experience.css`) and sizes. They render consistently with the tokens but are not yet expressed through them. Migrating them is mechanical and has no behaviour risk, but was not done in this pass, so a colour changed in `design.css` will not recolour every older screen.
