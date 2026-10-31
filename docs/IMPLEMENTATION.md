# NYNZ implementation status

## Supported generated application scope

NYNZ currently targets React + TypeScript + Vite web applications. Preview data
is temporary unless the generated app is explicitly connected to its own
Supabase project. NYNZ platform database keys are never supplied to generated
apps or sandboxes.

## Runtime architecture

- Next.js handles authenticated UI and short API operations.
- Supabase Auth + RLS enforce project ownership. Versioned SQL lives in
  `supabase/migrations`.
- Build requests are durable `build_jobs`. `pnpm worker` claims them with
  `FOR UPDATE SKIP LOCKED`, calls Sarvam, persists files, and runs them in E2B.
- Firecrawl imports are server-side, URL-gated, bounded, and stored as untrusted
  reference content.
- E2B previews use a separate origin and receive generated project files only.

## Generated application databases

Use `POST /api/projects/:id/backend` with that generated application's dedicated
Supabase project URL and browser-safe publishable key. Service-role and secret
keys are rejected. The worker supplies only these dedicated values to E2B as
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; they are not included in
source exports. The customer project must have its own RLS migration. Automatic
project provisioning is intentionally not implemented because it requires a
Supabase management token and may create billable resources.

## Deployment

Run the web process and at least one long-lived worker. A serverless request is
not used as a background worker. Set variables from `.env.example`; keep
service-role and provider keys server-only. No paid service, top-up, DNS, or
public deployment is enabled by this repository.

## Current external blockers

- The workspace is linked to `rgrlilmfjurdchcnxolt`. Both versioned migrations
  are applied. Live checks passed for authentication, the profile trigger,
  owner CRUD, two-user RLS isolation, restricted queue writes, private storage,
  worker queue claiming, generated-file persistence, and cleanup. Supabase's
  database security advisor reports no findings.
- Live Sarvam model discovery, structured generation, streaming, and native tool
  calling passed. A bounded Firecrawl public-page scrape also passed.
- E2B sandbox creation, file I/O, commands, host lookup, and cleanup passed, but
  its preview host returns HTTP 403 because this account forces an
  `e2b-traffic-access-token` header even when the SDK receives `secure: false`.
  Browser iframes cannot add that header. Public preview ingress must be enabled
  for the E2B project, or production must use a dedicated authenticated preview
  proxy on an isolated origin. Builds now fail clearly and clean up their
  sandbox instead of recording an unusable preview as ready.
