# Mobile design handoff

Branch feature/mobile-first-navy-teal, based on main 52d10db. Shared mobile-theme.css restores white cards, navy type and teal accents across the welcome, forms, evidence, handoff, voice workspace, TalkBack, gestures and access explanation. Voice captions and actions stack into a readable mobile column. Existing features, high contrast, enlarged text and reduced motion remain. No provider configuration changes.

Build passed. 294/300 unit checks passed; the six failures also occur on unchanged upstream main. Its unbuilt vendor asset causes a seventh baseline failure. Translation coverage inventory regenerated. Mobile browser reviewed home and text entry without page overflow. Full real-device and real-call testing remains outstanding.

mobile-preview.html is for static preview hosting; Node/Vercel frame protections remain unchanged. Use the main app directly on a phone in production.
