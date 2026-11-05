# Deploying 0.4.0: resumable builds

Order matters: **database, then worker, then web app.** The preview host does not change.

Every step below is free except the optional live build at the end, which is deferred until the owner approves a paid test.

## Why this order

| Combination during the rollout | Safe? | Evidence |
| --- | --- | --- |
| New database + previous worker + previous web | Yes | Rehearsal: the previous worker claims, starts and fails builds exactly as before |
| New database + new worker + previous web | Yes | Builds from the previous web have no `request` or brief; the worker falls back to the prompt and the first approved build |
| New worker + previous database | **No** | The worker calls `record_build_step`, which does not exist yet; builds would fail |
| New web + previous worker | **No** | Resume would be offered, and the previous worker would regenerate every file of a resumed build and charge for it again |

**Render auto-deploys the worker on every push to `feat/nynz-platform`.** So apply the migration before pushing or merging this branch.

## 0. Preflight (read-only, free)

1. **Builds in progress.** Confirm no builds are running. If some are, either wait for them or accept them; the rehearsal covers a queued build during the deploy.
   ```sql
   select status, count(*) from public.build_jobs
   where status not in ('succeeded','failed','cancelled') group by 1;
   ```
2. **Render worker environment.** In the Render dashboard, check `nynz-build-worker`:
   - `OPENROUTER_BATCH_OUTPUT_TOKENS` is unset or at least 20000. A lower value makes steps smaller (one screen each), which costs more input.
   - `OPENROUTER_BASE_URL` and `NYNZ_LOCAL_FIXTURE_SANDBOX` are unset.
   - `OPENROUTER_REQUEST_TIMEOUT_MS` is unset (default 240000) or at least 240000.
3. **Optional rehearsal on production in a transaction that is always rolled back.** It needs the database password.
   ```sql
   begin;
   \i supabase/migrations/20261105100000_resumable_builds.sql
   select count(*) filter (where request is null) as missing_request,
          count(*) filter (where resumable)       as resumable
   from public.build_jobs;          -- expect 0, 0
   rollback;
   ```

## 1. Database

1. Run `supabase db push --linked`. It applies only `20261105100000_resumable_builds.sql`; production is at `20261104101500`. Enter the database password when asked.
2. Verify through the API. Each check should come back present, or with the expected empty result:
   - `rpc record_build_step` exists.
   - `build_jobs.request` and `projects.brief` exist.
   - No build has an empty `request`.

The migration is additive:
- New columns and one partial unique index.
- A one-time backfill of `build_jobs.request`.
- Replaced bodies for `begin_build_generation` and `finish_build_unsuccessfully`, with the same signatures.
- New functions and one trigger.

It took 4 ms on 62 production-shaped builds.

## 2. Worker

1. Merge `fix/build-recovery` into `feat/nynz-platform` and push. Render deploys the worker automatically.
2. Verify:
   - The heartbeat reports `version: 0.4.0` and the new commit.
   - `generation_ready` is true.
   - The Render log shows `started ... generation openrouter, sandbox ready`.

## 3. Web app

1. Run `pnpm deploy:web`. It stamps the version and deploys to production.
2. Verify (free):
   - `/version` reports `0.4.0`.
   - `verify-public-pages` passes.
   - A signed-in builder page loads.
   - `GET /api/projects/<id>/builds` returns `resumable` and `checkpoint`.
   - The billing page shows the new credit labels.

## 4. Live check (deferred, paid)

When the owner approves a capped paid test:
- Use the owner account and a new project. Never use StudioMark.
- Run one medium build and one follow-up edit.
- Confirm:
  - the estimate and the amount held appear before approval,
  - steps are saved,
  - the credit history labels are right,
  - holds are released.

## Rollback

1. **Web first.** Use Vercel instant rollback to the previous production deployment. This removes Resume from the UI.
2. **Worker second.** Use Render rollback to the previous deploy. Do this only after the web rollback, so no resumed build reaches the previous worker.
3. **Database stays.** The changes are additive, and the previous worker and web were rehearsed against them. Saved progress for failed builds stays in `build_staged_files` until a later build of the same project succeeds.
