# NYNZ changelog

Every production deploy carries a version (package.json) and the exact commit,
shown in the site footer, the account menu, the admin header and `/version`.

## 0.5.3: cleaner invite-only label

- The signup screen's "Invite only" pill with a star icon is replaced by the plain lime uppercase label the sign-in page already uses ("NYNZ BUILDER", "CREATE YOUR WORKSPACE").
- Account emails (invitations, password resets) now come from NYNZ <support@nynz.in> through Hostinger SMTP: `smtp.hostinger.com:465`, authenticating as hello@nynz.in, DKIM-signed for nynz.in. This is a Supabase setting, not part of the app.

## 0.5.2: invite requests reach NYNZ, and reset and invitation links finish signing in

- `/api/waitlist` is now public in the middleware. Before, "Request an invite" got "Not found" in 0.5.1.
- Password-reset and invitation emails are requested by NYNZ's server, so Supabase puts their session after "#" in the link. Supabase doesn't allow template changes on the free tier with its default sender, so the fix is in NYNZ: `/auth/callback` now hands these links to `/auth/complete`. That page starts the session in the browser, clears the tokens from the address bar and continues to "Choose a new password" or "Choose your password". It works on any device.
- Evidence: tests/e2e/auth-links/run.ts, 8 checks (waitlist, reset, invitation, used link).

## 0.5.1: invite-only signups and working email links

- Signups are invite-only while NYNZ is in testing. "Create one" now shows a thank-you with the NYNZ logo, explains the private testing phase and asks for an email to receive an invite (`/api/waitlist`, table `signup_waitlist`). Staff see requests under Admin, then Waitlist, and invite with one click (the existing audited customer invitation). Set `NEXT_PUBLIC_SIGNUPS_OPEN=true` to reopen signups in the app; Supabase Auth signups are also turned off.
- Supabase Auth URL settings: the Site URL was `http://localhost:3000` with no allowed redirect URLs, so confirmation links led to an unreachable localhost page. It is now `https://www.nynz.in`, with `/auth/callback` allowed.
- Supabase Auth: public signups are turned off; admin invitations still work. Email templates are unchanged (see 0.5.2).

## 0.5.0: preview billing sessions and the revised trial (deployed 2026-11-05 at 557df2e; switchover 17:10:59 UTC)

- One billing session per sandbox: the build's sandbox and its later preview are the same runtime and are charged once. The first 600 s are held when the sandbox is created; every preview or terminal visit tops up the hold before runtime is extended (refused if the account cannot cover it); the actual running time is charged once when the sandbox stops (shutdown record, provider pause time, or NYNZ's visit record) and the rest of the hold is released. A visit after a pause opens a new segment. Duplicate visits and settlements do not double-charge. Missing evidence is charged as a labelled estimate and later reconciled with refunds only. Replaces the fixed 10-minute clock windows and the separate 600 s build-sandbox charge.
- Recorded sessions replayed: Saffron Loom 15 → 4 credits (904 s), Kesari Threads 15 + 15 → 5 + 5 (936 s, 1,059 s), StudioMark 15 → 6 (1,206 s).
- Trial: 60 credits for 7 days (TRIAL_CREDITS, TRIAL_DAYS), granted as source "trial". A separate daily trial spending limit (spend_limits scope "trial", ₹300 to start) counts only trial-only accounts; paid accounts keep the rest of the ₹1,000 platform cap. New trial requests are refused upfront with a clear message when the day's trial allowance is used up. Preview holds never occupy a build-concurrency slot.
- Switchover: clock-window charging ends the moment the migration commits. The previous host's `authorize_sandbox_runtime` now holds and meters through sessions, and runtime already paid under the old billing (the following window after a window charge, the first 600 s after a build charge) is never charged again. Preview holds are kept out of the build-hold sweep that every worker runs.
- A visit that opened a segment but could not reach the sandbox (for example deleted while paused) is closed with no charge. Lock order is the same for visits and settlements, so they never deadlock. No settlement or retry is charged beyond a sandbox's recorded end. Measured runtime cost is labelled `configured_rate_estimate`; the fallback is `runtime_estimate`.
- Builder: when today's trial allowance is used up, a lasting card replaces the toast. It shows when building reopens (12:00 am India time), that the project is safe and nothing was charged, and "Choose a plan" only when checkout is configured. The preview error page and build stop card use the same reopen time.
- Existing 25-credit trial grants keep their balances and expiry dates (the 60-credit grant is a no-op for them) and count toward the trial allowance.
- Evidence:
  - The real preview host driven against local Supabase and a fake E2B: tests/e2e/preview-host/run.ts, 32 checks.
  - New-customer journey: 15 checks.
  - Release rehearsal on production-shaped previews, holds and grants: scripts/rehearse-preview-billing.sh, 19 checks, including overlap and rollback.
  - DB, unit and concurrency tests.
  - Deploy guide: docs/DEPLOY_0.5_PREVIEW_BILLING.md.

## 0.4.2: honest build-complete replies (deployed 2026-11-05 at d1a0492)

- A finished build or edit no longer posts the plan's proposal ("Here is the proposed plan… before I write code") as its completion reply (seen on Kesari Threads and Saffron Loom). The reply is written from the completed result: the app's name and the approved steps for a new app, the change summary and the files updated for an edit, coverage notes, and a pointer to the Preview tab.
- The proposal is posted as its own chat entry when the plan is ready, so it keeps its earlier place next to the plan card.
- Only a published build gets a completion reply; failed, stopped and still-running builds never show one.
- Evidence: tests/fixtures/saffron-loom/completion.json, tests/unit/completion-message.test.ts, StudioMark local proof (43 checks).

## 0.4.1: styling, honest plan checks and credit labels (committed on branch fix/0.4.1, not deployed)

Findings from the approved 0.4.0 production validation (Kesari Threads, project 2ea4dcd1):

- Styling: the stylesheet was written in the last step while screens were only visible as import/export lines, so 61 class names (38 of 45 on the landing page) had no styles. A stylesheet step now receives the class names every screen uses and a compact markup outline. After every build and every edit, class names used in markup but defined nowhere are found and filled by one bounded, resumable styles step (edits check only the files they changed). Class names inside template literals and conditionals are detected.
- Plan check: it now reads focused source evidence (changed files first, ranked lines with controls, labels and options) instead of an outline, and answers built, missing or unclear. Anything it cannot verify is shown as "Couldn't confirm" (please check in the preview), never as "Not built yet". Reproduced on the Kesari Threads edit, where the return form, the Returns filters and the dashboard cards were wrongly flagged.
- Credit history: each charge now names the step it paid for (the label is set before each request; 0.4.0 showed the previous step). Planning, compile repairs and the preview environment have their own labels.
- Evidence: tests/fixtures/kesari-threads (generated fictional app, both versions, and the edit's plan check), tests/unit/styles-and-coverage.test.ts, tests/e2e/kesari-styles/run.ts (before/after screenshots), and the StudioMark recovery proof (36 checks).

## 0.4.0: resumable builds (committed on branch fix/build-recovery, not deployed)

- Root cause of the StudioMark failures (2026-11-04): a late step asked for four full screens in one response with a 12,000-token cap; every attempt was cut off at exactly 12,000 tokens and the identical request was sent three times. A failed build then deleted its finished files, and "Try again" replanned and regenerated everything.
- Builds run in steps sized to the output limit (20,000 tokens, about two screens per step). Each finished step is saved with its files in one transaction (record_build_step). Complete files are kept from a cut-off response; only missing files are retried, split into smaller requests, then given a larger allowance; identical requests are never resent and attempts are capped.
- Failed or stopped builds keep finished steps and offer Resume, which continues from the first unfinished step at most once per failed build (resume_build). Start over is a separate, confirmed action. Worker restarts continue from saved steps.
- Edits run file by file, so large changes no longer have to fit in one response. Follow-ups carry the original brief, approved plan and applied changes (projects.brief).
- The result is checked against the approved plan before it is marked complete; anything missing is listed as "Not built yet".
- Plans show an estimated credit range and the amount held at approval. A credit shortfall stops before the next paid step with work saved. Stop is checked before every paid request and explains the final charge. Credit history separates credits used (with the build step), unused holds released and credits restored, without provider names or costs.
- A resumed build that fails again resumes from its newest checkpoint; across chained Resumes every finished file is produced and charged once.
- Migration rehearsed on production-shaped builds and credits (in-process Postgres and PostgreSQL 17): existing builds, projects, ledger, reservations and balances unchanged; the previous worker keeps working. Deployment order and rollback: docs/DEPLOY_0.4_RESUMABLE_BUILDS.md.
- Local proof: tests/e2e/studiomark/run.ts (34 checks) against a local Supabase stack with a scripted provider.

## 0.3.18

- Fix the admin Credits page crashing on retained ledger entries for deleted accounts. Show "Deleted account" without a broken user link and preserve all credit history.
- Add a server-rendering regression check for deleted-account and empty ledger states.

## 0.3.17

- Browser-tab icon is a fully opaque black square with the lime N. Safari painted a coloured backing behind the transparent rounded corners, which showed as a lime edge.

## 0.3.16

- Pricing, About, Sign in and policy pages show the share image when their links are shared, and titles no longer repeat NYNZ ("About NYNZ").

## 0.3.15

- Favicon and app icons: a black rounded tile with the lime N (no glow), larger N so it reads in browser tabs. Generated by scripts/brand/generate-icons.mjs.
- Link previews (WhatsApp, X, LinkedIn, iMessage, Slack): new share image with the real NYNZ logo, "Your idea. A working app.", an example prompt and Made in India; same image for X.
- Every public page now shares its own title, description and address instead of the homepage's (lib/seo.ts).
- Search: clearer title and description, organisation logo for Google (structured data), large image previews allowed.
- Installable app: manifest with id, scope, 192/512 and maskable icons; iPhone home-screen settings.

## 0.3.14

- Logo: a little more space between the N mark and the word NYNZ, so it no longer reads as "NNYNZ". The original logo file is unchanged; the site uses public/brand/nynz-wordmark-spaced.png.

## 0.3.13

- Starter ideas are a tidy grid of matching cards with an icon each (two columns on phones, three on wider screens).
- Launch ripples on phones grow mostly up and down, so the screen edge never cuts them.
- Made in India badge keeps its bright text but has a softer tricolour edge, no side glow and a gentler shine.

## 0.3.12

- Removed the floating app cards, phone ticker and pointer glow from the homepage hero.
- Launch ripples: thin outlines shaped like the chat box pulse outward from behind it on the homepage and the projects page (transform and opacity only, paused while typing, off with reduced motion).
- Made in India is now a proud badge just below the chat box on both pages: bright text, bold tricolour India, saffron-to-green edge, a slow shine and the beating heart. Fits on one line on phones.

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
