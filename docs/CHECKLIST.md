# Implementation checklist

## Implemented

- [x] Supabase SSR auth and protected product routes
- [x] Project create, rename, delete and reopen
- [x] Persistent conversations, files, build jobs and errors
- [x] Sarvam structured plan/file generation with bounded retries and timeouts
- [x] Durable worker with cancellation and duplicate-request protection
- [x] E2B file write, install, production build, preview, expiry and restart
- [x] Firecrawl import with SSRF checks, redirect validation and daily limits
- [x] Code editor/file rail and preview-first builder
- [x] Version snapshots and restore
- [x] ZIP export excluding environment files and dependencies
- [x] Usage events, daily budgets and protected admin diagnostics
- [x] Dedicated generated-app Supabase connection boundary
- [x] Unit tests for paths, URLs, secret boundaries, RLS and durable queue
- [x] Desktop and mobile browser inspection of homepage and builder fixture

## Live verification pending

- [ ] Apply migration to `rgrlilmfjurdchcnxolt`
- [ ] Verify sign-in/sign-out and two-user isolation against that project
- [ ] Run account-specific Sarvam model discovery and structured generation
- [ ] Run one Firecrawl scrape and one E2B preview/cleanup check
- [ ] Complete live end-to-end create/edit/reopen/restore/export/restart scenarios
- [ ] Connect a separate generated-app Supabase project and test durable data

The pending checks require access to the specified Supabase project and the
three provider keys. Mocked tests are not counted as live evidence.
