# NYNZ changelog

Every production deploy carries a version (package.json) and the exact commit,
shown in the site footer, the account menu, the admin header and `/version`.

## 0.3.11

- Homepage hero: live moments from apps people build (a booking, weekly sales, a new order, a new version) float beside the composer on wide screens and rotate above it on phones; a soft glow follows the pointer. Transform and opacity only, paused while typing, static with reduced motion.
- Dashboard: the Made in India line moved from beside Projects to a quiet line under the composer.

## 0.3.10

- Busy or capacity pauses no longer tell customers about NYNZ's internal provider spending limits; they now say NYNZ is very busy and to try again in a few minutes.
- The preview error page shows the real NYNZ logo (embedded, no network request) instead of a plain "N" box.

## 0.3.9

- Fix: the "Watch it happen" section and other homepage grids no longer spill off phone screens; added a strict phone-fit check (scripts/perf/phone-fit.ts).
- "India" in the Made in India line is shown in the national flag colours.
- Dashboard project cards are drawn from each app's own title, heading and colours (no live sandbox per card, no credits used, no preview errors).
- Friendly, specific explanations when a build or preview stops (spending pause, credits, failed checks), with the right action; branded preview error page.
- Homepage demo rebuilt: ask for three real changes and watch the working app update (v1 to v4), then jump back to any version.
- Replaced the generic sparkle icons with the NYNZ mark and meaningful icons.
- Operations: the ₹50 testing spend cap was ended on the owner's instruction because it blocked all previews; audited.

## 0.3.8

- The prompt box no longer draws a second sharp focus ring across its label; the whole composer edge lights up instead (keyboard focus stays clearly visible).

## 0.3.7

- Typing no longer re-renders the homepage, dashboard or builder: each prompt box keeps its own text and the page only updates when it switches between empty and not empty. The homepage typing placeholder writes directly to the box instead of re-rendering the page.
- Paint-heavy effects (rotating border, blurred background motion, text sweep, marquee) pause while you type; the border never rotates on touch devices; the opaque composers no longer use a hidden glass blur.
- New motion using only transform and opacity: heartbeat on the Made in India heart, a slow light ring behind the homepage composer, pop-in prompt panels, lift on starter ideas, bouncing counts and staggered rows in the interactive example, and a soft reveal when a builder preview loads. All respect reduced-motion settings.
- Added scripts/perf/typing-latency.ts to measure typing responsiveness on a simulated mid-range phone.

## 0.3.6

- Compact prompt guidance and a "Help me write my prompt" form on the homepage and dashboard composers; they only fill the box (confirmation before replacing text), never submit or spend credits.
- Six curated starter ideas (booking, inventory and orders, agency CRM, member portal, storefront, personal tracker) replace the previous example and idea lists.
- Questions about who founded or created NYNZ are answered in the project chat with the approved fact, without a build, file change or credits; app-editing requests still use the normal flow.
- The homepage builder showcase is now a labelled interactive example (brief, app, desktop/phone, one focused change); the build-stage loop is labelled as an illustration and respects reduced motion.
- "Made in India with love from Odisha ❤️" on the homepage and next to Projects.
- Fix: accounts with credit history can be deleted; their ledger rows are kept and detached (migration 20261104101400).

## 0.3.4 (4 Nov 2026, release candidate)

- Require isolated production preview hosts and valid worker preview configuration.
- Admit sandbox allocation and preview/terminal resume against credits and combined spend limits.
- Stop active model requests/new sandboxes when cancelled, suspended or their worker lease is lost.
- Fail closed on admission/registry outages; restrict storage cleanup targets and retain retries.
- Publish from a source snapshot and commit deployment/job outcome atomically.
- Advance restore revisions even for no-op restores; test real concurrent saves/restores/resumes.
- Disable dependency install hooks; complete new-app identity; preserve export documentation/notices.
- Add real project file/content search and a no-cost authenticated browser verification journey.
- Typecheck the standalone preview host and add public browser smoke to CI.
- Gate admin page data reads on MFA; retain provider-reported zero-cost usage without substituting an estimate.
- Not deployed; requires the additive migrations and configuration in docs/RELEASE.md.

## 0.3.3 (4 Nov 2026)
- Visible version and commit on every screen and at `/version`; worker reports its version.
- Worker health reports only configuration the worker needs.

## 0.3.2 (4 Nov 2026)
- Admin console and billing page fit phone screens; wide tables scroll inside their cards.

## 0.3.1 (4 Nov 2026)
- Staff personal workspaces are private: the owner's dashboard no longer lists other customers' projects.

## 0.3.0 (4 Nov 2026)
- Resource isolation, staged builds, staff permissions and audit history, admin console, credit ledger,
  billing schema, account security, branding cleanup, backend validation, publishing and GitHub code paths.
