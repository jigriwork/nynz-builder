# Release 0.3: deployment and rollback

Branch `feat/nynz-platform`. Pushing this branch auto-deploys the Render
worker (`render.yaml: autoDeploy: true`), so do not push until steps 1–2 are
ready. Never run `supabase db reset` against the hosted project.

## 0. Before you start

- Back up: Supabase dashboard → Database → Backups (confirm the latest daily
  backup or create a manual one if your plan allows), and note the current
  Vercel and Render deployment IDs for rollback.
- Pause new builds briefly (optional): there is no maintenance switch; deploy
  in a quiet period. Running builds are recovered by the worker if interrupted.

## 1. Environment variables (no values in chat or Git)

Generate a 48-byte random secret for previews (`openssl rand -base64 48`).

| Where | Add or change |
|---|---|
| Vercel web app | `PREVIEW_SIGNING_SECRET` (new, required), `NEXT_PUBLIC_SITE_URL=https://www.nynz.in`, `NEXT_PUBLIC_APP_URL=https://www.nynz.in`, `PREVIEW_ORIGIN` (keep `https://preview.nynz.in` until step 6, then `https://{projectId}.preview.nynz.in`) |
| Vercel preview host | `PREVIEW_SIGNING_SECRET` (same value), `NYNZ_APP_ORIGIN=https://www.nynz.in`, `PREVIEW_HOST_SUFFIX=preview.nynz.in`, `PREVIEW_FRAME_ANCESTORS=https://www.nynz.in https://nynz.in`; later `PUBLISH_SITES_SUFFIX` |
| Render worker | `PREVIEW_SIGNING_SECRET` (same value) and confirm `OPENROUTER_API_KEY` is set |
| Optional | Razorpay test keys, `OPENROUTER_MANAGEMENT_KEY`, GitHub App and publishing variables (see `.env.example`) |

## 2. Database migrations (additive)

Apply in order with the Supabase CLI from a machine that has the database
password (`supabase link --project-ref rgrlilmfjurdchcnxolt`, then
`supabase db push`), or paste each file into the SQL editor in order:

1. `20261104100000_resource_isolation.sql`
2. `20261104100100_account_controls.sql`
3. `20261104100200_staged_builds.sql`
4. `20261104100300_staff_and_audit.sql`
5. `20261104100400_credits_and_spend.sql`
6. `20261104100500_operations.sql`
7. `20261104100600_billing.sql`
8. `20261104100700_admin_reports.sql`
9. `20261104100800_integrations.sql`

They were tested on an empty database and on a copy of the pre-0.3 schema with
production-shaped data (`tests/db/upgrade.test.ts`): every user, project, file,
conversation, version and usage row is preserved; a sandbox referenced by more
than one project is detached (that project restarts its preview). Customer
writes to platform-managed project fields stop immediately, so deploy step 3
right after.

## 3. Deploy code

1. Push the branch (Render worker redeploys; Vercel builds the web app if
   connected to this branch, otherwise `vercel --prod` for the web project).
2. Deploy the preview host project from `preview-host/` with its new variables.
3. Confirm the worker logs `generation openrouter, sandbox ready, preview signing ready`.

Previews opened before the release use old URL tokens and will ask the owner to
reopen the preview once.

## 4. Owner bootstrap

```
pnpm bootstrap:owner --user-id 41080a24-57a9-4686-8d53-c0a3a9e09588 --email adib@nynz.in --check
pnpm bootstrap:owner --user-id 41080a24-57a9-4686-8d53-c0a3a9e09588 --email adib@nynz.in
```

## 5. Verify

```
NYNZ_VERIFY_BASE_URL=https://www.nynz.in pnpm verify:release
NYNZ_VERIFY_BASE_URL=https://www.nynz.in pnpm exec tsx scripts/verify-public-pages.ts
```

Then the manual owner checks printed by `verify:release`. Before any paid
build test, add a spending limit in Admin → Providers: period "Fixed window",
₹50, covering the test window. Every provider call is checked against it before
it is sent.

## 6. Separate preview origins (needs DNS)

Add the wildcard domain `*.preview.nynz.in` to the preview host project in
Vercel (wildcards require the domain's nameservers to point at Vercel, or a
Vercel-supported wildcard setup), then set
`PREVIEW_ORIGIN=https://{projectId}.preview.nynz.in` on the web app and worker.
Until then all previews share `preview.nynz.in`: still authorised per request
and per owner, but one browser can hold only one preview session at a time.

## 7. Publishing (needs DNS)

Choose a separate registrable domain for customer sites (recommended, so sites
can never share cookies with nynz.in), add `*.<domain>` and `sites.<domain>`
to the preview host project, set `PUBLISH_SITES_SUFFIX=<domain>` on the web
app, worker and preview host. For custom domains also set `VERCEL_API_TOKEN`
and `VERCEL_SITES_PROJECT_ID` (and `VERCEL_TEAM_ID` if applicable) on the web app.

## 8. Payments and GitHub (external setup)

- Razorpay: test-mode keys, webhook URL and events in `docs/BILLING.md`, then
  Admin → Plans and payments → "Create in Razorpay" for Starter and Pro.
- GitHub: create a GitHub App with Repository permission "Contents: read and
  write", Setup URL `https://www.nynz.in/api/github/callback`, "Request user
  authorization during installation" off; set `GITHUB_APP_ID`,
  `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_STATE_SECRET`.

## Rollback

- Code: redeploy the previous Vercel deployments (web and preview host) and the
  previous Render deploy (`e24612b`).
- Database: the 0.3 migrations are additive, but old code expects to update
  `projects.status` and `active_sandbox_id` directly. If code must be rolled
  back after step 2, run this in the SQL editor to restore the old customer
  grants (it does not delete any 0.3 data):

```sql
grant insert, update, delete on public.projects to authenticated;
grant insert, update, delete on public.versions, public.version_files, public.website_imports to authenticated;
drop trigger if exists projects_sandbox_binding on public.projects;
```

  Re-apply `20261104100000_resource_isolation.sql` before rolling forward again.
  This rollback reopens audit finding SEC-01, so keep it as short as possible.
