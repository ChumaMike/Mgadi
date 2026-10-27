# Mgadi: start here

Read `AGENTS.md`, `entry/SOURCE-OF-TRUTH.md` and `team/COORDINATOR-PROMPT.txt` before work. The last of these is Chuma's handover for the coordinator tab and its interview. Worker tabs must take a bounded assignment from the coordinator and read the same current product truth. Do not start the entire coordinator interview in each worker tab.

Repository root is this `build/` directory; the live product root is `entry/`. `rehearsal/` is preparation, not the competition entry. Never replace the entry with rehearsal code. The workspace's `../pitch/` contains presentation artifacts; `presentation/` is their repository snapshot.

Chuma explicitly authorised pushing the Mgadi work to `ChumaMike/Mgadi` and deploying a Vercel project named `mgadi` in the conversation on 27 October 2026. This supersedes the earlier “do not push unless asked” condition for this requested handover and deployment. Do not change repository visibility, force-push, purchase services, trigger real calls or send WhatsApp messages under that authorisation.

Use `team/BOARD.json` for coordinator-owned assignments and `team/handoffs/<task>.txt` for separate worker reports. Do not overwrite another person's uncommitted edits. Current implementation and limitations take precedence over old deck copy. Secrets stay out of files committed to Git, tool output and chat.

Use `npm.cmd test` and `npm.cmd run scoreboard` in `entry/`. Initial Vercel adapters deliberately use rules-only triage; paid AI and callbacks need distributed abuse controls and their own readiness checks. A prepared Vercel configuration is not evidence of a successful cloud deployment. Read `entry/DEPLOYMENT.txt` for exact outstanding access/setup and smoke checks.
