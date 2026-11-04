# NYNZ changelog

Every production deploy carries a version (package.json) and the exact commit,
shown in the site footer, the account menu, the admin header and `/version`.

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
