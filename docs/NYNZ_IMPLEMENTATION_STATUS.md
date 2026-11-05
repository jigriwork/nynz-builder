# NYNZ implementation status

## Current release: 0.3.6 (live)

Reconciled 4 November 2026 against recorded production evidence. Web 0.3.6 was
built from commit `5196ba3`; database fix `5dd8004` (migration
20261104101400). The preview host is still the 0.3.5 deployment, and the worker
reports 0.3.6. Since the 0.3.5 baseline (`cb7b7f9`), no preview-host, worker,
preview, sandbox or billing code changed; 0.3.6 changed the homepage,
dashboard, builder submit path and chat route (`/api/projects/[id]/builds`),
plus one additive migration.

| Item | Status | Evidence (release, date) |
|---|---|---|
| Owner/admin console, desktop and phone | Remains working from 0.3.5 | 0.3.5 owner-session report, 4 Nov 2026. Production audit history shows the owner session (sign-in 11:56 UTC) saving the ₹50 cap, the owner allowance and the full team workflow (invite, role changes, suspend, reactivate, remove, revoke) at 11:57–11:59 UTC. 0.3.6 did not change admin pages; dashboard changes re-checked on production at desktop and phone width with a disposable account. |
| Team management with fixtures | Remains working from 0.3.5 | Same audit records (4 Nov 2026, 11:57–11:59 UTC). No team code changed in 0.3.6. |
| ₹50 combined cap and owner allowance | Remains in force | Cap "Release verification ₹50 (all providers)" active from 4 Nov 11:56 to 7 Nov 11:57 UTC; 50 owner-testing credits granted. |
| Automatic per-project preview HTTPS | Remains working from 0.3.5 | Re-observed 4 Nov 2026 on 0.3.6: all 7 active project hosts (`<projectId>.preview.nynz.in`) present individual valid certificates (each certificate names only its own host, valid to 2 Feb 2027) and return 401 without a session. |
| Cross-project preview isolation | Remains working from 0.3.5 (not re-run) | Passed in the 0.3.5 report (4 Nov 2026). Preview host and preview session code unchanged since then. Re-running needs a signed-in owner or fixture session per project. |
| Real create/edit/reopen/failure/restore/export journey (42 checks) | Remains working from 0.3.5 (not re-run) | 0.3.5 report, 4 Nov 2026. Production records match: 30 credits consumed in 10 entries from the 50-credit allowance with all holds released; sandboxes terminated as "replaced", "build failed" and "project deleted"; 4 verification projects, storage folders and preview domains removed. The individual check log was not committed and the build rows were deleted with the projects. The 0.3.6 chat-route change was re-checked live: a normal app edit still returns 202 and queues a build. |
| Resource cleanup | Remains working | 0.3.5 journey resources all terminated; reconciliation runs every 5 minutes. |

No regression was found.

### Spending and open holds

- Provider-reported OpenRouter spend in the ₹50 window: ₹6.44 (5 calls, 0.3.5 journey).
- Open estimate holds, not confirmed spend: five E2B runtime holds from the 0.3.5 journey (₹18.39 total) and two OpenRouter holds of ₹2.39 each: #11 from the 0.3.6 chat check (13:28 UTC; aborted on cancellation) and #15 from the 0.3.7 functional check (14:07 UTC; a planning call the verification script failed to cancel, after which deleting the test account also removed its usage record). None has a provider request ID, and no OpenRouter management key or E2B invoice is available here. They stay counted against spending caps until the owner reconciles them with provider evidence (admin action provider_spend.reconcile). They are not released or reported as confirmed spending.

### Still unavailable

Payments, publishing and GitHub remain off until their external configuration
exists. Real invitation and password-reset email delivery to a real recipient
has not been tested.

---

# Historical: release 0.3.4 candidate notes (superseded by the table above)

Date: 4 November 2026 (Asia/Kolkata).
Branch: `feat/nynz-platform`.
Implementation commits: `a49753b` (runtime/isolation/recovery/product checks) and `0105025` (admin page MFA and reported zero-cost accounting).
Starting implementation: `97db14a`; both historical audits describe `e24612b`.

## Resumable builds (unreleased, branch fix/build-recovery)

Not deployed. Migration `20261105100000_resumable_builds.sql` is not applied to production.

| Area | State | Evidence |
| --- | --- | --- |
| StudioMark root cause | Identified | Production records (read-only): builds 5120d4b5 and 1872988b stopped at batch 4 of 4 after three identical requests, each returning exactly 12,000 output tokens; worker log "OpenRouter response reached its output limit"; edit 4aa57eed hit the same cap. 261 credits went through the ledger for the project, about 144 of them on cut-off responses. |
| Step checkpoints, Resume, Start over | Implemented, verified locally | tests/db/resumable-builds.test.ts (10), tests/unit/build-recovery.test.ts, tests/e2e/studiomark/run.ts (30/30) |
| Worker restart mid-build | Verified locally | e2e: worker killed after 4 saved files; recovered build requested none of them again |
| Follow-ups keep the brief | Verified locally | e2e: plan and edit requests carry ORIGINAL PRODUCT BRIEF; all eight screens unchanged after the edit |
| Compile repair, last working version | Verified locally | e2e: compiler error repaired from its output; Stop and failures left the live version unchanged |
| Credits | Verified locally | e2e: estimate and hold shown before approval; refusal before any code; mid-build shortfall stopped before the next paid step; no response charged twice; holds released |
| Chained Resume (resume fails again) | Verified locally | DB chain test; generator test (every file produced and paid once across three runs); e2e: 13 → 14 → 16 files, the last Resume requested only Reports.tsx |
| Migration on existing data | Rehearsed locally | tests/db/resumable-upgrade.test.ts and scripts/rehearse-resumable-migration.sh (PostgreSQL 17.11, 62 builds, 79 ledger rows, 4 ms): builds, projects, ledger, reservations and balances unchanged; previous worker still works |
| Deployment | Not done | Order: database, worker, web; see docs/DEPLOY_0.4_RESUMABLE_BUILDS.md |
| Real provider and E2B behaviour | Not verified | Local runs used a scripted provider and a local sandbox stand-in; paid live test deferred |

## Release disposition

The existing 0.3 implementation was retained and checked. This increment closes additional isolation, runtime-budget, cleanup, cancellation, restore-concurrency and publishing-transaction gaps, and adds working file search and generation identity validation.

**0.3.4 is committed locally and has not been pushed or deployed.** Its two new migrations have been applied successfully to disposable databases, including an upgrade fixture. They have not been applied to production. A production RPC probe confirmed the runtime migration is absent.

The deployed 0.3 release and the local 0.3.4 candidate are different environments. Historical production verification in earlier release notes is not proof that this increment is deployed.

Fresh public production version check returned **0.3.3 / 97db14a** from https://www.nynz.in/version.

Status meanings:

- **Implemented and verified**: named tests or browser checks passed; environment stated.
- **Implemented, awaiting configuration**: code and fixtures exist; external setup prevents a live workflow.
- **Remaining**: engineering or operational verification is incomplete.
- **Superseded**: a documented replacement resolved the original finding.

## Completion checklist

- [x] Read both audits and revalidate against the newer implementation.
- [x] Preserve existing customer data and provider configuration.
- [x] Verify the exact owner's ID/email against connected Supabase Auth.
- [x] Run the privileged idempotent owner bootstrap and confirm owner/active.
- [x] Preserve server-owned resource bindings and test cross-user boundaries.
- [x] Refuse shared production preview origins and invalid origin configuration.
- [x] Reserve estimated bounded E2B allocation cost before sandbox creation.
- [x] Admit preview and terminal resume against allowance and combined spending limits.
- [x] Abort model requests and new sandboxes on cancellation, suspension or lost lease.
- [x] Preserve canonical source and preview on failed generation.
- [x] Test parallel saves, restores, credit reservations and resume deduplication.
- [x] Fail closed on rate-limit/account-state lookup errors.
- [x] Prevent orphan deletion when resource-registry lookup fails.
- [x] Preserve project README, existing export notes and licence files.
- [x] Add generation title/description/favicon/package validation and real file search.
- [x] Typecheck both the application and independently deployed preview host.
- [x] Run lint, tests, production build and no-cost browser journeys.
- [x] Prepare additive migrations and release/rollback instructions.
- [ ] Configure isolated preview DNS and environment settings, then approve production release.
- [ ] Complete owner-session browser verification, payment sandbox integration and paid create/edit verification.
- [ ] Complete the remaining accounting and operational work listed below.

## Owner and access

Production Supabase project: `rgrlilmfjurdchcnxolt`.

On this pass, Supabase Auth confirmed that ID `41080a24-57a9-4686-8d53-c0a3a9e09588` belongs to the confirmed email `adib@nynz.in`. The bootstrap returned `already_owner` and the staff record returned `owner / active`. The bootstrap's server-side function records the assignment/run and an audit event.

No substitute owner, duplicate login, password reset, email-verification change, or client metadata privilege was created.

- Exact admin URL: https://www.nynz.in/admin
- Workspace URL: https://www.nynz.in/dashboard
- Account menu → **Admin console** opens administration.
- Console header → **Back to workspace** returns to the ordinary builder.
- Admin → **Team** → **Add a team member** accepts email, optional name, role, capabilities and reason.
- Existing users accept their pending invitation through the account menu; new users activate their individual account through Supabase's invitation flow.
- The Team table supports resend/revoke, permission changes, MFA requirements, suspension/reactivation and removal of staff access.
- Acceptance requires the intended verified email. Removing staff access preserves the person's customer account.
- Only owners can appoint owners or grant owner-level capabilities. Last-owner protection and ownership transfer/recovery are documented in OWNERSHIP.md and PERMISSIONS.md.

Verified scope: production owner identity/bootstrap; database fixtures for roles, invitations, verified-email acceptance, expiry, revocation, escalation prevention, recent authentication, MFA, last-owner protection, audit records and ordinary owner workspace access.

Remaining verification: the real owner's signed-in browser journey and real invitation-email delivery. No owner session was available and no real recipient received a test invitation or reset message.

## Current-state audit mapping

| Finding | Current disposition | Evidence and limits |
|---|---|---|
| SEC-01: customer-editable sandbox identifiers | Implemented and verified in database fixtures | Column grants, server resource registry, binding trigger, ownership RPC and cross-project tests retained. |
| REL-01: failed builds overwrite working source | Implemented and verified in fixtures | Build staging and transactional promotion retained; failures preserve source/version/preview. No fresh paid production generation in this pass. |
| REL-02: non-transactional restore/checkpoint | Implemented and verified | Transactional snapshots/restores plus hash/revision checks. New migration advances revision even for no-op restores; real parallel PostgreSQL test passes. |
| REL-03: leaked resources | Implemented and verified in fixtures; live inventory reconciliation remaining | Replacement/deletion/failure/cancellation/idle cleanup retained. Registry failures now stop orphan deletion; invalid broad storage targets are refused; cleanup errors retain retry state. |
| BILL-01: no billing/entitlements | Implemented, awaiting Razorpay configuration | Versioned plans, subscription/payment/refund/top-up tables, signed idempotent webhooks and customer billing UI; no live or test-provider transaction executed. |
| ADM-01: no owner/console | Implemented; exact owner verified in production | Owner/active confirmed. Real-data admin pages and staff controls exist. Owner browser verification remains. |
| SEC-02: unrestricted install hooks | Partly implemented and verified | Initial, repair and publish installs use --ignore-scripts. Sandboxes remain isolated. Full package screening, restrictive egress policy and a live compatibility run remain. |
| BILL-02: incomplete/non-atomic accounting | Partly implemented and verified | Atomic allowance reservations and spending caps; E2B allocation/resume admission added. Actual invoice reconciliation and automatic correction of runtime estimates remain. |
| GEN-01: broken Sarvam fallback | Superseded with evidence | Customer planning/generation require OpenRouter; readiness refuses unsupported configuration before a reservation. Sarvam code/configuration is preserved but not advertised as a working customer-flow fallback. |
| AUTH-01: recovery/suspension/session controls | Implemented and fixture/browser verified in supported scope | Recovery pages, expired-link messages, suspension, staff-session revocation and MFA exist. Real email delivery, terms/consent and customer account deletion/export remain. |
| SEC-03: upload validation | Partly implemented | Signature/active-SVG checks and quotas exist; malware scanning remains. |
| SEC-04: weak admission/rate limits | Implemented, with abuse-control gaps | Atomic limiter covers active operations and now fails closed during errors. CAPTCHA/device/IP risk controls remain. |
| REL-04: cancellation only between stages | Implemented and fixture verified | Two-second control polling aborts HTTP requests and terminates the new sandbox on cancellation/suspension/lease loss. Provider-side billing after HTTP abort cannot be assumed to stop. Live stage-by-stage latency verification remains. |
| OBS-01: limited monitoring | Partly implemented | Real worker/queue/reconciliation/spend health shown. Alert delivery, distributed tracing and backup restore drill remain. |
| SEC-05: preview signing coupled to service key | Implemented; external settings required | Dedicated required signing secret, rotation, host-bound single-use exchange, HttpOnly cookie and clean redirect retained. This workspace lacks the signing secret; hosted environment configuration was not changed. |
| PROD-01: legacy endpoints | Implemented and verified | Removed in preceding 0.3 commits; public browser smoke confirms removed paths/assets return 404. |
| CLAIM-01: unsupported product claims | Implemented in existing release | NYNZ copy describes supported scope; no new production-readiness claim made. |
| File search | Implemented and browser verified | Filename and content search opens the matching source file; replaces the previous placeholder button. |
| ZIP import | Remaining | GitHub source import is available in code; ZIP import has not been added or advertised as completed. |
| Separate generated-app origins | Implemented, awaiting DNS/configuration | Production requires a UUID project hostname. Shared-origin mode is refused. Configure wildcard hosting before deploying this change. |

## Branding/provenance audit mapping

| Audit items | Current disposition |
|---|---|
| 1–2: titles, canonical/social/manifest metadata | Implemented; 34/34 public-page browser checks passed locally. |
| 3: icon master artwork | Existing approved NYNZ artwork preserved; normalisation remains a design decision. |
| 4: NYNZ public identity | Retained and browser verified. |
| 5–7, 9–10, 12–13: public logos, dormant marketing/CLI/helpers/handlers/livecast | Removed in existing 0.3 source; removal checks pass. |
| 8: inherited CSS | Superseded after tracing: live style rules retained with truthful provenance; unused marketing components removed. |
| 11, 17: provider/raw database errors | Customer-safe codes/correlation IDs retained; rate/account admission now fails closed. |
| 14–15: generated identity | New deterministic metadata completion and inherited-badge rejection tested. Existing customer projects are not rewritten. |
| 16: export README overwrite | Actual downloaded ZIP preserves README; unit fixtures also preserve existing export notes and licence files. |
| 18: session-bearing URLs | One-time exchange, clean redirect, host-only HttpOnly cookie and redaction retained; production shared hosts are refused. |
| 19–20: build paths, client bundles/maps | Client/public checks pass; server artifacts remain internal. Exhaustive deployed map/log review remains. |
| 21: Git identity information | Historical records retained. Future author-address choice remains the owner's decision; no history rewritten. |
| 22: required notices/provenance | LICENSE, THIRD_PARTY_NOTICES.md and UPSTREAM.md preserved. |

The two original audit files are historical evidence. Their findings are mapped here; they have not been edited to imply that the old audited commit already contained these fixes.

## Credits, spending and payments

Customer allowance, provider usage, provider balances and company payments/expenses remain distinct records.

Model calls reserve credits and shared spending headroom before requests, use model/input/output-specific rates, send a matching provider price ceiling, and settle returned costs using provider generation IDs when available. A provider-reported zero cost remains zero; an omitted cost uses a labelled estimate. Retries and aborted calls retain conservative unknown-cost provider holds; unused customer reservations are released.

E2B creation reserves its configured lifetime before allocation. Successful/uncertain allocations are counted using that bounded runtime estimate. Preview/terminal resume uses an atomic per-sandbox time window; twenty parallel proxy instances were verified to charge it once. Repeated connections in one window are covered by a conservative two-timeout allocation estimate. These estimates can exceed measured runtime. They are labelled **allocated_runtime_estimate**, not provider invoices.

**Remaining:** automatic reconciliation/refund of overestimated E2B allocations, paused-storage costs, provider invoice ingestion, shared expenses and payment fees. Operators must reconcile vendor statements and apply reasoned audited credit corrections; this is not complete actual-cost accounting or proven profitability.

Owner testing uses the existing explicit expiring grant/budget model. No testing grant or hidden bypass was added on this pass.

Starter: ₹999/month excluding GST. Pro: ₹1,499/month excluding GST. Money is stored in paise and tax separately. Allowances, versioning and grace rules are documented in BILLING.md.

Payment state: **not configured; no real payment and no provider test-mode checkout performed**. Razorpay test key ID/secret/webhook secret are missing locally. Live mode remains gated; merchant, legal entity, GSTIN and tax invoice details are still external prerequisites. No business/tax identity was fabricated.

## Publishing, customer backends and GitHub

- Publishing implementation builds immutable frontend artifacts in E2B and serves them separately from previews. New snapshot/completion RPCs check cancellation, ownership, lease and source revision, then activate the deployment and succeed the job in one transaction. Fixture tests cover cancellation/concurrent edits. Publish/update/rollback/unpublish/domain records and static artifact controls exist.
- Live publishing is unavailable until the site suffix/wildcard DNS and hosting configuration exist. Custom-domain attachment needs Vercel credentials/project ID and verified DNS/TLS. None were invented or purchased.
- Customer Supabase URL/key validation, migration review/table checks, disconnect and rotation exist. New checks refuse the platform database as a customer backend at API and database boundaries. The controlled two-user RLS template fixture passes. SQL application remains the customer's documented step without a customer-authorised privileged integration.
- GitHub App import/export/sync, scoped installation tokens, secret exclusion and conflict handling exist and have fixture tests. A GitHub App and its private key/state configuration are missing; no live sync was simulated.

## Verification performed on this pass

| Check | Actual result |
|---|---|
| Application plus standalone preview-host typecheck | Pass |
| ESLint | Pass |
| Unit/database suite | 147 passed; 7 real-concurrency tests skipped in this command and run separately |
| PostgreSQL 17 multi-connection suite | 7 passed: parallel allowance reservations, plan concurrency, duplicate events, shared cap, manual saves, restores, resume deduplication |
| Branding check | Pass |
| Production build | Pass; existing Browserslist-age and Tailwind screen-variant warnings remain |
| Public browser journey on local production build | 34/34 passed |
| Release API/ownership smoke against local production app and connected Supabase | 28/28 passed |
| Authenticated customer browser journey | 12/12 passed against local production app with disposable accounts in connected Supabase |
| Exact production owner bootstrap | ID/email confirmed; already_owner; owner/active |
| Admin page MFA gate | Fixtures confirm required MFA redirects before service-role data queries; satisfied sessions retain access |
| Runtime migration presence in production | Absent; not applied by this work |
| Paid generation, Firecrawl scraping, E2B allocation, publishing, payment transaction | Not run |

The customer browser journey covered sign-in, project creation, source save, content search, manual edit persistence, stale-write rejection, real ZIP download/README preservation, admin denial, dashboard return and project deletion. All created workspace fixture accounts were cleaned up, including one interrupted initial test run.

CI now installs/typechecks the preview host, runs the real database/concurrency suite, builds and runs the public browser smoke. The new CI workflow has not yet executed remotely because this candidate has not been pushed.

**Additional paid provider spending: ₹0.** No subscription/service purchase, real invitation/reset email or payment was made.

## External setup and release blockers

1. Done in 0.3.5: configure a supported wildcard host/DNS setup for *.preview.nynz.in and PREVIEW_ORIGIN=https://{projectId}.preview.nynz.in on web/worker. Verify two project hosts independently. Do not deploy the stricter origin enforcement with shared production settings.
2. Done in 0.3.5: set/check the same dedicated preview signing secret on the web and preview host through secure configuration. It is missing locally; no secret value belongs in Git/chat.
3. Done in 0.3.5: apply the two pending additive migrations and coordinate web, worker and preview-host deployment after approval; see RELEASE.md. A push auto-deploys Render.
4. Done in 0.3.5 (MFA enrolment not exercised): run the real owner's console/team/MFA journeys using their own session; do not reset their password for verification.
5. Supply Razorpay test keys and register the signed webhook; complete test renewals/failures/refunds before considering live billing.
6. Configure publishing DNS/site suffix and custom-domain hosting credentials.
7. Register/configure the GitHub App.
8. Before any paid verification, activate a combined fixed-window cap of at most ₹50, verify rates/FX and ensure the worker/web/preview host all use the same accounting settings. No paid verification has been claimed.

## Remaining engineering/operational work

Automatic actual-cost reconciliation for runtime estimates and aborted requests; dependency screening/egress restrictions; malware scanning; live cancellation timing; alerts/tracing/backup drill; terms/consent and customer account deletion/export; ZIP import if product scope requires it; authoritative font/dependency licence inventory; real customer-backend auth/storage verification.

These remaining items and missing external integrations prevent an unconditional production-readiness or paid-launch claim.

## Official documentation consulted

Provider behavior was checked against current official documentation; no paid calls were required:

- [E2B sandbox lifecycle](https://docs.e2b.dev/sandbox)
- [npm install / ignore-scripts](https://docs.npmjs.com/cli/v11/commands/npm-install/)
- [OpenRouter API](https://openrouter.ai/docs/api/reference/overview)
- [OpenRouter provider price ceilings](https://github.com/OpenRouterTeam/docs/blob/main/guides/routing/provider-selection.mdx)
- [Supabase invitation API](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail)
- [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test)
- [Firecrawl scraping](https://docs.firecrawl.dev/api-reference/endpoint/scrape)
- [Firecrawl credit usage](https://docs.firecrawl.dev/api-reference/endpoint/credit-usage)
- [GitHub installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Vercel custom-domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
