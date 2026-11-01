# NYNZ product roadmap

This file records agreed product work that is intentionally deferred. It is the project memory for future implementation decisions.

## Private beta onboarding

- Keep early access controlled with approved emails or invite codes.
- Add profile access states: `pending`, `active`, and `suspended`.
- Grant a one-time starter credit allowance after activation.
- Add a welcome flow for name, role, use case, and first application idea.
- Add password reset, account recovery, terms acceptance, and acceptable-use consent.
- Add a customer-facing usage and credit history page.
- Add account-level build, token, website import, storage, and sandbox limits.
- Add an in-product support and failed-build reporting path.

Until the product has a full administration surface, use the Supabase dashboard as the temporary operations console for the private beta.

## Superadmin

- User search, access state, plans, credit grants, and suspensions.
- Project and build inspection with safe retry and cancellation controls.
- Provider usage, estimated cost, limits, and failure analytics.
- Invite management and beta cohort controls.
- Audit log for every administrative action.
- Platform status, worker health, preview health, and alerting.

## Managed generated-app backends

- Supabase OAuth or Management API provisioning for a separate project per generated application.
- Migration generation, human-readable review, explicit apply, verification, and rollback.
- Row-level security tests and service-role key isolation.
- Storage, authentication, database, and edge-function configuration.
- Backend usage metering and lifecycle cleanup.

## Production readiness

- Run the build worker on persistent infrastructure with health checks and automatic restart.
- Add durable queues, idempotent retries, structured error codes, tracing, and alerting.
- Add a real billing ledger and credit wallet instead of deriving credits only from token events.
- Add deployment targets and custom domains for generated applications.
- Add dependency, secret, malware, and generated-code security scanning.
