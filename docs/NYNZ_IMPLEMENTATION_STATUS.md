# NYNZ release 0.3: implementation status

**Date:** 4 November 2026 (Asia/Kolkata)
**Branch:** `feat/nynz-platform` (local; not pushed). Base: `e24612b`.
**Commits:** `e71b8a9` isolation and preview sessions · `726dea5` staged builds, ledger, staff and billing schema · `6721aef` admin console, team, account security, billing UI · `c7389d7` inherited-surface removal, metadata, safe errors · `83b9235` backends, publishing, GitHub · final commit: verification scripts, CI and documentation.
**Production state:** nothing in this release has been deployed or applied. A read-only probe on 4 Nov 2026 confirmed none of the nine 0.3 migrations exist on Supabase project `rgrlilmfjurdchcnxolt`. See [RELEASE.md](RELEASE.md).

## Status key

- **Verified** = implemented and verified by automated tests in this workspace (real SQL migrations on in-process Postgres, unit tests, local production build and browser smoke test). Not yet verified in production because nothing is deployed.
- **Awaiting config** = implemented; live operation needs external setup that does not exist yet.
- **Remaining** = not done.
- **Superseded** = finding replaced by a different, evidenced decision.

## Owner

| Item | State |
|---|---|
| ID ↔ email | Verified read-only against production: user `41080a24-57a9-4686-8d53-c0a3a9e09588` is `adib@nynz.in`, email confirmed, not banned, no MFA factor, currently `profiles.role = member`. `pnpm bootstrap:owner … --check` passes; a mismatched email is refused (exit 3). |
| Owner assigned? | **No, not in any hosted environment.** The bootstrap needs migration `20261104100300` first. Assignment is tested (exact match, idempotent, mismatch/unverified refusal, logging) on the real migrations locally. |
| Admin URL | `https://www.nynz.in/admin` (after release). Non-staff receive 404. |
| Back to workspace | "Back to workspace" in the console header → `/dashboard`. The owner keeps the normal builder; the account menu shows "Admin console". |
| Adding team members | Admin → Team → "Add a team member": email, optional name, role, optional capabilities, reason. Existing accounts accept in-app (Account menu → Staff invitation); new addresses get a Supabase activation email and choose their own password. Resend/revoke from the Invitations table; Manage → role, capabilities, require 2FA, suspend/reactivate, remove. Details: [PERMISSIONS.md](PERMISSIONS.md), [OWNERSHIP.md](OWNERSHIP.md). |

## Current-state audit findings

| ID | Finding | State | Evidence |
|---|---|---|---|
| SEC-01 | Owners could rewrite `active_sandbox_id`; terminal/preview trusted it | Verified | Column grants (name/description only); server-owned `platform_resources`; trigger refuses unbound sandboxes even for service role; `authorize_sandbox_access` used by terminal and proxy; terminal checks sandbox metadata. `tests/db/isolation-and-builds.test.ts`, `tests/unit/preview-token.test.ts` |
| REL-01 | Failed generation mutated canonical source | Verified (SQL); worker path not run live | Build-scoped staging, `promote_build` single transaction, failure keeps source/version/preview byte-identical; manual edits during a build block promotion |
| REL-02 | Non-transactional restore/checkpoint | Verified | `create_checkpoint`, `restore_version` (lock, revision check, backup checkpoint, integrity check), `save_project_files` hash conflicts |
| REL-03 | Leaked sandboxes/storage | Verified (logic); live E2B reconciliation not run | Registry, termination on replace/fail/cancel/delete/idle, recursive storage cleanup, orphan scan by metadata, retries. `tests/unit/reconcile.test.ts` |
| BILL-01 | No billing/entitlements | Verified (logic); **Awaiting config** (Razorpay test keys) | Plans with versions, subscriptions, payments with tax split, refunds, top-ups, out-of-order/duplicate webhook handling. `tests/db/billing.test.ts` |
| ADM-01 | No owner/admin console | Verified locally | Staff model, audit, console pages; owner assignment pending release |
| SEC-02 | Unrestricted `npm install` lifecycle scripts | **Remaining** | Not changed; needs a paid live build to validate `--ignore-scripts` compatibility |
| BILL-02 | Incomplete, non-atomic metering | Verified, with gaps | Reservation + headroom + platform caps checked **before** each provider call; actual cost consumed idempotently; model-aware pricing. Gaps: E2B idle/resume time and provider invoices are manual entries |
| GEN-01 | Sarvam fallback unusable | Verified | OpenRouter required; worker advertises readiness; API refuses before reserving credits |
| AUTH-01 | No recovery/suspension/session control | Verified (browser for recovery pages; SQL for suspension/sessions); email delivery unverified | Forgot/reset/set-password, expired/reused link messages, suspension in RLS/APIs/queue/previews/sites, session revocation, MFA. Remaining: terms/AUP consent, account deletion/export |
| SEC-03 | Upload checks by MIME only | Partial | Magic-byte checks, active-SVG rejection, UTF-8/JSON checks, 50 MB project quota. Malware scanning remaining |
| SEC-04 | Weak rate limits | Verified | Atomic limiter on project creation, builds, restarts, imports, uploads, saves, terminal, preview sessions, exports, publishing, GitHub, checkout, password reset, admin actions. CAPTCHA/IP risk scoring remaining; Supabase limits sign-in/sign-up |
| REL-04 | Cancellation not propagated | Partial | Queued and awaiting-approval work cancels immediately with hold released; in-flight provider calls/commands still finish |
| OBS-01 | Little monitoring | Partial | Overview shows worker freshness, queue age, cleanup failures, last reconciliation, spend vs limits. Alerts, tracing, backup drill remaining |
| SEC-05 | Preview signing used service key | Verified | Dedicated required secret, rotation via `_PREVIOUS`, host-bound single-use exchange, HttpOnly host-only cookie, clean redirect, redaction |
| PROD-01 | Legacy endpoints compiled | Verified | All legacy handlers deleted; unsupported `/api/*` returns 404 (browser check) |
| CLAIM-01 | "Production-ready"/"Systems operational" | Verified | Copy replaced; public pricing page states scope |
| Feature: file search | Button only opens Code tab | **Remaining** | |
| Feature: ZIP import | Missing | **Remaining** (GitHub import added instead) | |
| Feature: separate origins per generated app | Shared `preview.nynz.in` | **Awaiting config** | Code supports `{projectId}` hosts and binds tokens to host; needs `*.preview.nynz.in` wildcard |

## Branding and provenance audit findings

| # | Finding | State |
|---|---|---|
| 1–2 | Title and missing metadata | Verified: title template, canonical, OG/Twitter image, manifest, theme colour, apple icon, robots, sitemap (browser check) |
| 3 | Icons from one master artwork | Remaining (design decision); existing icons kept, apple icon added from `app/icon.png` |
| 4 | Live pages already NYNZ | Retained; automated in `scripts/verify-public-pages.ts` |
| 5 | Public Firecrawl logos | Verified removed (404 locally) |
| 6–7, 13 | Dormant landing, hero, livecast | Verified removed |
| 8 | Header/icons/`styles/fire.css`/`design-system` | Components removed. **Superseded for CSS:** `styles/fire.css` and `styles/design-system/**` are imported by `app/globals.css` (live), so rules were kept, the file renamed `styles/base.css` and inherited marketing comments removed |
| 9 | `create-open-lovable` CLI | Verified removed |
| 10 | `lib/build-validator.ts` | Verified removed |
| 11 | "Firecrawl is not configured" | Verified: vendor-neutral messages; provider details only in logs |
| 12 | Legacy handlers in server build | Verified removed |
| 14–15 | Generation identity | Prompt rules added; automated post-generation identity validation remaining |
| 16 | Export README overwrite | Verified: project README preserved, notes in `NYNZ_EXPORT.md` |
| 17 | Raw database errors | Verified for all API routes (stable codes + correlation IDs, redacted logs) |
| 18 | Session token in URL | Verified: one-time exchange token, cookie, clean redirect, log redaction |
| 19 | Server build paths/source maps | Partial: CI builds in a standard path; server artifacts remain internal |
| 20 | Client bundle | Pass (local browser smoke) |
| 21 | Personal data in Git history | Remaining owner decision (`.mailmap`/no-reply addresses); history not rewritten |
| 22 | Licence/provenance | Verified preserved; `docs/UPSTREAM.md` updated truthfully; `THIRD_PARTY_NOTICES.md` added; brand check enforces both |

Also removed after import tracing: unused UI kits and helpers (245 files) and 57 unused dependencies.

## Payments

Test/live state: **not configured** (no Razorpay keys in this workspace). Live keys are refused unless `BILLING_LIVE_ENABLED=true`. No GSTIN, legal entity, invoice data or real payment was created. Starter ₹999 and Pro ₹1,499 excl. GST are seeded as plan versions; allowances and grace behaviour are in [BILLING.md](BILLING.md).

## Credits and provider accounting

Covered: customer grants (included, purchased, promotional, owner testing, adjustments), reservations, consumption, release, expiry, staff grant limits, duplicate prevention, customer-visible history, platform spend caps (all providers or per provider; day, month or fixed window), OpenRouter provider-reported cost, price-table estimates labelled as such, E2B build time and Firecrawl pages as estimates. Provider balances: Firecrawl via API; OpenRouter key usage via API (account balance needs a management key); E2B, Sarvam, Supabase, Vercel, Render are dated manual entries. Not covered: E2B idle/resume time, automatic invoice ingestion, payment fees. No profit figure is computed.

## Publishing, backends, GitHub

- **Publishing:** implemented (isolated build, artifact validation, immutable deployments, update, rollback, unpublish, retention, suspended-owner blocking, custom-domain TXT verification). **Awaiting config:** a site domain with wildcard DNS on the preview/site host (`PUBLISH_SITES_SUFFIX`), and Vercel API credentials for custom-domain TLS. The UI shows "not available yet" until then.
- **Customer Supabase:** key validated against the exact project, rotation recorded, secret keys refused, migration review and table verification; RLS template verified with a two-user fixture. Applying SQL remains the customer's step (NYNZ holds no admin credentials). Live two-user check against a real customer project not run (none connected).
- **GitHub:** implemented (App install with signed state, scoped tokens, export with conflict detection and secret exclusion, transactional import). **Awaiting config:** a GitHub App (see RELEASE.md §8).

## Checks performed

| Check | Result |
|---|---|
| `pnpm typecheck` (now includes tests and preview host) | Pass |
| `pnpm lint` | Pass |
| `pnpm test` | Pass: 117 tests in 17 files (63 run the real migrations, including an upgrade over production-shaped pre-0.3 data) |
| `pnpm check:brand` | Pass (and verified to fail on injected violations) |
| `pnpm build` | Pass |
| `scripts/verify-public-pages.ts` on local production build | Pass: 34/34 browser checks |
| `pnpm bootstrap:owner --check` against production | Pass (read-only); mismatch correctly refused |
| `pnpm verify:release` (post-deploy, authenticated journeys) | **Not run**: requires the release to be deployed |
| Paid generation, E2B, Firecrawl calls | **Not run** |

Concurrency note: PGlite runs one connection, so "concurrent" credit and restore tests exercise the locking logic sequentially; row locks guarantee the behaviour on Postgres but true parallel load was not tested.

**Additional provider spending in this work: ₹0.** Only free calls were made (OpenRouter public model price list, read-only Supabase queries).

## Exact blockers and remaining setup

1. Your authorisation to release: set env vars, apply the nine migrations, push/deploy, run the owner bootstrap ([RELEASE.md](RELEASE.md)). The Supabase database password is not in this workspace, so the CLI cannot apply migrations from here.
2. `PREVIEW_SIGNING_SECRET` on the web app, preview host and worker (required; previews stop without it).
3. Wildcard DNS for per-app preview origins and for published sites; Vercel API token for custom domains.
4. Razorpay test keys, webhook secret and webhook registration; later merchant activation, legal entity, GSTIN and invoice details for live mode.
5. GitHub App registration.
6. Optional: `OPENROUTER_MANAGEMENT_KEY` for account balance.
7. Remaining engineering: SEC-02 install hardening, malware scanning, in-flight cancellation, monitoring/alerts and backup drill, file search, ZIP import, terms/consent, account deletion/export, E2B idle metering.

This release is **not production-ready by virtue of a passing build**. Its verified scope is the automated test suite and local browser checks above; production behaviour must be confirmed with `pnpm verify:release` and the owner checklist after deployment, and a ₹50 fixed-window spend cap should be set before any paid verification.
