# Release 0.3.5: deployment and rollback

Release preparation is on feat/nynz-platform. The coordinated production
release is authorised. Pushing this branch auto-deploys the Render worker;
complete certificate provisioning and hold build admission during rollout.

## Prerequisites

1. Record the current web, preview-host and worker deployment IDs. Confirm the
   existing Supabase backup/restore mechanism and retain a pre-release backup.
   Do not reset the hosted database.
2. Keep Hostinger authoritative nameservers and the existing wildcard CNAME
   *.preview -> 7896bea1d38b7b8e.vercel-dns-017.com. Use individual Vercel domain
   attachments/certificates, not wildcard certificate validation. No NS
   delegation or apex/email DNS change is needed. Pre-provision existing
   project addresses before switching the preview host.
3. Set PREVIEW_ORIGIN=https://{projectId}.preview.nynz.in on web and worker.
   The new code refuses shared production preview hosts. It also refuses paid
   jobs when the worker reports an invalid preview origin.
   Configure PREVIEW_VERCEL_TOKEN, PREVIEW_VERCEL_PROJECT_ID (the private preview
   project) and PREVIEW_VERCEL_TEAM_ID on web and worker. Use a dedicated
   project-scoped credential where supported, with its expiry recorded and
   rotation scheduled. Never copy the expiring CLI OAuth login into production.
   Web admission registers the owner-checked project address and probes HTTPS
   and explicitly attaches its alias to the current production preview deployment
   before probing HTTPS and reserving credits; an unavailable API or pending certificate refuses
   the request without queueing paid work. Preview-session renewal also checks
   registration. The worker removes deleted-project domains through the
   durable resource cleanup queue. Vercel certificate/API limits apply.
4. Verify DNS/TLS for two UUID project subdomains. Confirm the preview host
   receives each original Host header. The per-project host must not redirect
   every app to the shared preview origin.
5. Set the same dedicated PREVIEW_SIGNING_SECRET on web and preview host through
   the provider's secure environment settings. It must differ from the service
   key. The worker does not sign preview sessions and does not require this key.
   Rotation uses PREVIEW_SIGNING_SECRET_PREVIOUS with a short overlap.
6. Keep E2B_COST_USD_PER_SECOND, USD_TO_INR_RATE and PAISE_PER_CREDIT consistent
   across web, worker and preview host. These are configured estimates, not a
   provider invoice. Verify the real contracted rates before paid testing.

No credential or signing secret should be printed, committed or shared in chat.

## Additive migrations

The existing deployed 0.3 schema is preserved. For an installation that is
behind, apply all migration files in timestamp order, including the 0.3.1
workspace-isolation and staff-account-deletion migrations.

The two original pending migrations are:

1. supabase/migrations/20261104101100_runtime_admission.sql
2. supabase/migrations/20261104101200_restore_revision.sql

An additional blocking accounting/preview-cleanup correction is:

3. supabase/migrations/20261104101300_spend_reconciliation.sql

The unapplied runtime admission signature also records the credit conversion
rate in each debit, needed for exact later correction. The supplementary
migration keeps estimates' actual_paise NULL and status authorized, including
older estimate rows previously marked settled; it does not rewrite the
append-only credit ledger. Historical events without a linked debit and rate
require manual review rather than guessed refunds.

The first adds runtime admission, stricter worker readiness, a platform-backend
guard, and transactional publishing source/completion functions. The second
ensures every successful restore advances its revision, including no-op restores.

The two original migrations and the supplementary correction were applied to
production on 4 November 2026 after checking history and saving a validated
database archive. Production has 17 applied migration versions. Do not replay
these migrations. Disposable-database and existing-data upgrade tests passed.

Use an authorised Supabase database connection and review the CLI migration
plan before applying pending files. Apply in a quiet/controlled release window;
old worker heartbeats lack the new readiness requirement and new jobs may
briefly be refused until the new worker is running. Do not remove ownership
grants, triggers, RLS or audit protections to work around admission failures.

## Coordinated code release

After release approval:

1. Apply the reviewed pending migrations.
2. Push the reviewed branch when ready for the Render automatic deployment.
3. Build/deploy the web app with pnpm stamp before the production build so the
   version and commit are accurate.
4. Install preview-host dependencies and deploy preview-host/ as its separate
   Vercel project. It has its own tsconfig and is checked by pnpm typecheck.
5. Verify the worker reports v0.3.5, the expected commit, OpenRouter readiness,
   sandbox readiness and a valid per-project preview origin.
6. Reopen existing project previews through NYNZ to receive fresh one-time
   exchange links on their isolated project hosts. Source and versions remain.

PREVIEW_HOST_SUFFIX defaults to preview.nynz.in. NYNZ_APP_ORIGIN and
PREVIEW_FRAME_ANCESTORS must identify the real NYNZ app. A shared preview host
returns unavailable under the new production code; this is an intentional
security boundary, not a reason to bypass origin validation.

## Owner verification

The connected production account has already been verified:

- Auth ID: 41080a24-57a9-4686-8d53-c0a3a9e09588
- Email: adib@nynz.in
- Bootstrap result on this pass: already_owner; staff record owner/active.

For an explicit verification rerun:

    pnpm bootstrap:owner --user-id 41080a24-57a9-4686-8d53-c0a3a9e09588 --email adib@nynz.in --check

For an authorised idempotent bootstrap rerun, omit --check. It must never
substitute another account or change verification/password state.

The owner signs in normally at https://www.nynz.in/login, opens Admin console,
uses Back to workspace to return to the builder, and manages staff through
Admin → Team. OWNERSHIP.md and PERMISSIONS.md describe transfer, recovery,
MFA, individual invitations and last-owner protections.

Use the dedicated owner-browser handoff script only when the owner chooses to
sign in themselves. Do not borrow their normal browser profile, reset their
password, manufacture an owner session, or invite real recipients for tests.

## No-cost post-deploy checks

    NYNZ_VERIFY_BASE_URL=https://www.nynz.in pnpm verify:release
    NYNZ_VERIFY_BASE_URL=https://www.nynz.in pnpm verify:workspace
    NYNZ_VERIFY_BASE_URL=https://www.nynz.in pnpm exec tsx scripts/verify-public-pages.ts

verify:workspace signs in a disposable .invalid user, exercises search, edits,
conflict rejection and a downloaded ZIP, then cleans the fixture. It never
queues AI generation. Use individual controlled fixtures for staff workflows;
do not send invitations/password resets to real people unless requested.

Confirm that old Firecrawl public asset paths and legacy APIs return 404.
Check customer-safe errors, the version endpoint, private-route indexing and
the two isolated preview hosts. Inspect the worker's reconciliation summary
before allowing paid jobs.

## Paid verification, if later authorised

Before any additional paid verification:

1. Configure and verify a combined fixed-window spending cap no greater than
   ₹50 across all providers for the entire verification window.
2. Use an explicit expiring owner-testing allowance within its existing budget.
3. Ensure the deployed web, worker and preview host use the new runtime
   admission functions and consistent pricing settings.
4. Check existing outstanding authorisations and shared activity before the
   run; allocations, resumes and pending model calls consume budget.
5. Run the create/edit/controlled-failure/restore/cleanup journey and compare
   provider records with the metering ledger.

E2B runtime credits are provisionally charged as a labelled conservative
allocation estimate. Estimated provider spend remains an outstanding hold,
with actual_paise NULL. Never fabricate an invoice from allocated timeout.
The signed-in, recently authenticated owner can submit documented provider
evidence through admin action provider_spend.reconcile (spendId, actualPaise,
evidence). Its database transaction settles the evidenced amount and corrects
the linked customer debit once; refunds keep original grant expiry. Replays
are idempotent and conflicting evidence is refused. Local database tests cover
authorization, stale authentication, estimate holds, refunds, expiry and
duplicate reconciliation. Production estimates remain pending until genuine
provider evidence is available; test fixtures are never presented as invoices.
An aborted HTTP request may still incur provider charges. Keep its unknown-cost
hold rather than assuming it was free. Do not present a ledger estimate as a
settled invoice or exact profitability.

Paid verification must use the same combined window across preflight retries;
never reset the cap or grant another owner allowance merely to make a run pass.
The owner is excluded from automatic customer welcome-credit grants.

## Payments

Use Razorpay test-mode credentials and register
https://www.nynz.in/api/webhooks/razorpay with the events in BILLING.md. Configure
the Starter/Pro provider plans from Admin → Plans and payments.

Live mode requires explicit enablement, merchant activation and real business,
tax and invoice details. No GSTIN/legal entity is invented. Checkout callbacks
alone cannot activate subscriptions.

## Publishing and GitHub

Publishing needs a site suffix with wildcard DNS on the site host. A separate
registrable domain is recommended to avoid customer sites sharing NYNZ cookies.
Set PUBLISH_SITES_SUFFIX on web/worker/host. Custom domains also need
VERCEL_API_TOKEN, VERCEL_SITES_PROJECT_ID and, if used, VERCEL_TEAM_ID. Verify TXT
ownership, provider attachment and TLS; do not report a domain live merely
because a local record was saved.

GitHub needs a registered App, repository Contents read/write permission,
configured installation/setup callback and GITHUB_APP_ID, GITHUB_APP_SLUG,
GITHUB_APP_PRIVATE_KEY and GITHUB_STATE_SECRET. Scoped installation tokens are
obtained on demand. Do not substitute a broad personal access token or pretend
an unconfigured integration succeeded.

Customer Supabase migration application remains customer-managed unless a
supported privileged integration has been explicitly authorised. The platform
database cannot be used as the generated application's backend.

## Rollback and recovery

Keep the additive schema and all resource/RLS/audit protections.

- Prefer a forward fix if a new admission function fails. Temporarily stop
  accepting builds while repairing it; do not grant customers access to
  platform-managed identifiers.
- A code-only rollback may redeploy the previously recorded compatible 0.3
  web/worker/preview-host artifacts. Keep the newly configured isolated origins
  and signing secrets. Do not roll back to the vulnerable audited e24612b build.
- The additive functions/tables do not require customer data deletion for a
  code rollback. Existing source, conversations, versions, ledgers and audit
  events stay in place.
- If a schema correction is required, use a reviewed forward migration. Never
  drop the sandbox-binding trigger or restore table-wide customer mutations.
- If a data incident requires backup restoration, follow the verified Supabase
  recovery procedure and reconcile provider resources/events afterwards.
  A production backup-restore drill has not been completed by this work.

The older instructions that re-granted broad project writes have been removed
because they reopened SEC-01.
