# Mobile design and presenter flow

Branch feature/mobile-first-navy-teal includes main 538ac42 and preserves its current voice, accessibility and release fixes. Shared mobile-theme.css restores white cards, navy text and teal accents across the guide, tools, evidence, handoff and voice pages.

Text report → in-app guidance invitation → bank selection → feedback → accept/deny selected-file access → manual evidence collection → explicit review → downloadable SHA-256 incident record. Guided assistance is labelled; it does not claim a real phone call. Read-aloud is optional. Evidence file bytes are not uploaded or included in the pack. The saved incident survives refresh until explicitly cleared.

Build and 307 unit tests pass (executor Node 24.22.1; repository deployment target remains Node 22.x). HTTPS mobile walkthrough verified text report, pickup, bank selection, unreachable-bank feedback, denial without opening a picker, manual selection of a real fictional file, SHA-256 fingerprint, inventory restoration after refresh, review and pack creation. Download click was attempted but browser download-event confirmation timed out; do not claim an independently verified downloaded browser artifact. Unit tests verify generated-pack checksums and detection of edits.

Static phone preview does not host server-only AI or sharing APIs. Node/Vercel server security and provider configuration remain intact; use the main app directly on a phone there. Full real-device, real-call and screen-reader testing remains outstanding.

Logo follow-up: render the original raster logo through an inline SVG viewport to remove only outer white space while keeping the complete M and wordmark visible. A three-column phone header keeps the bank button on the same row. The guidance screen now includes the animated visual companion, synchronised with optional read-aloud states, plus a link to the existing Anthropic TalkBack screen. Illustrative gestures remain explicitly distinct from reviewed SASL. Vercel project creation was rejected with 403 for the selected user team; no API key was stored or live deployment performed there.
