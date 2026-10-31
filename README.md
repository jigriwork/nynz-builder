# NYNZ

NYNZ is an AI application-building platform for React + TypeScript web apps. A
user signs in, creates a project, describes an app, reviews build progress,
opens an isolated live preview, requests focused changes, saves/restores
versions, and exports runnable source.

## Architecture

- **Next.js 15 / React 19** — responsive product UI and authenticated APIs
- **Supabase** — SSR auth, RLS-owned projects, files, conversations, versions,
  durable build jobs, private storage, usage and admin diagnostics
- **Sarvam 105B** — configurable structured planning and file generation
- **Firecrawl** — bounded public website research stored as untrusted reference
- **E2B** — isolated install, production build and preview on a separate origin
- **Long-lived worker** — claims durable jobs with `FOR UPDATE SKIP LOCKED`

Generated applications are currently scoped to React + TypeScript + Vite.
Generated-app databases are separate from the NYNZ platform database.

## Local setup

```bash
corepack pnpm install
cp .env.example .env.local
corepack pnpm dev
corepack pnpm worker
```

The web app runs at `http://localhost:3000`. Apply the versioned migration in
`supabase/migrations` to the exact configured project before signing in.

Required secrets are `SARVAM_API_KEY`, `FIRECRAWL_API_KEY`, `E2B_API_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`. They are server-only. The browser receives only the
Supabase project URL and publishable key.

## Verification

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm verify:integrations  # consumes small live provider usage
```

See [implementation details](docs/IMPLEMENTATION.md), [upstream provenance](docs/UPSTREAM.md),
and the [continuation checklist](docs/CHECKLIST.md).
