# NYNZ

NYNZ builds React + TypeScript + Vite web applications from a brief. A customer
describes an app, reviews and approves an AI plan, watches a durable build,
uses an isolated private preview, requests focused edits, edits source,
saves and restores versions, connects their own Supabase project, exports the
source or pushes it to GitHub, and (when hosting is configured) publishes a
static production build.

## Architecture

- **Next.js 15 / React 19**: product UI, admin console (`/admin`) and APIs.
- **Supabase**: auth, row-level-security-owned project data, transactional
  build promotion and restores, credit ledger, staff permissions, append-only
  audit history, billing records and private storage.
- **OpenRouter**: planning and generation (required; readiness is checked
  before any request is accepted).
- **E2B**: isolated install, production build, preview and terminal. Every
  sandbox is registered to one project and owner and cleaned up idempotently.
- **Firecrawl**: optional one-page website reference import.
- **Worker** (`scripts/worker.ts`, Render): claims durable jobs, meters spend
  before each provider call, promotes validated builds atomically and runs
  resource/credit reconciliation every 5 minutes.
- **Preview/site host** (`preview-host/`, Vercel): authorises previews per
  request and serves published static sites on their own origins.
- **Razorpay** (optional, test mode): subscriptions, top-ups, signed webhooks.

Generated-app data lives in each customer's own Supabase project, never in the
NYNZ platform database.

## Local setup

```bash
corepack pnpm install
cp .env.example .env.local   # fill in values; never commit them
corepack pnpm dev            # http://localhost:3000
corepack pnpm worker
corepack pnpm preview-gateway
```

## Checks

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test           # unit tests + SQL/RLS tests on the real migrations (in-process Postgres)
corepack pnpm check:brand
corepack pnpm build
```

## Documentation

- [Implementation status for release 0.3](docs/NYNZ_IMPLEMENTATION_STATUS.md)
- [Release and rollback](docs/RELEASE.md)
- [Staff permissions](docs/PERMISSIONS.md) and [ownership and recovery](docs/OWNERSHIP.md)
- [Plans, credits and payments](docs/BILLING.md)
- [Upstream provenance](docs/UPSTREAM.md) and [third-party notices](THIRD_PARTY_NOTICES.md)
