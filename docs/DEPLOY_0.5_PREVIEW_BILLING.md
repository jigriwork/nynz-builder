# Deploying 0.5.0: preview billing sessions and the 60-credit trial

Order: **database, then worker and web app (one push), then preview host.** Each step is safe while the others still run older code (see the overlap table).

## The switchover, exactly

Old clock-window preview charging ends, and session billing starts, **the moment the migration commits**. That doesn't depend on which worker, web app or preview host is running.

- The previous preview host (0.3.10) and the 0.4.2 terminal call `authorize_sandbox_runtime`. The migration redefines it to hold and meter through the session path, so it no longer charges 6-credit windows.
- Runtime a sandbox already paid for under the old billing is never charged again (`private.legacy_paid_until`):
  - A window charge covers the sandbox until the end of the following 10-minute window.
  - A build's sandbox charge (3 credits) covers its first 600 s from creation.
  - A sandbox with no session starts metering only after that time.
- Preview holds are kept out of the build-hold sweep (`reconcile_credits`), which the old and new workers both run.
- Record the switchover time when the migration finishes:
  ```sql
  select max(created_at) from public.credit_ledger where event_key like 'runtime:%';
  -- must not grow after the push
  ```

## Overlap during the rollout

| Running together | Safe? | Evidence |
| --- | --- | --- |
| New database, old worker, old web, old host | Yes | Rehearsal: the old host's call opens a held session with no window charge, and the old worker's build charge covers its first 600 s |
| New database, new worker and web, old host | Yes | Preview-host harness 6a/6b: old and new host calls on the same sandbox share one session |
| New database, everything new | Yes | Harness 32/32, journey 15/15 |
| New worker, web or host on the old database | **No** | `open_sandbox_session` and `extend_sandbox_session` don't exist yet, so builds and previews would fail. Apply the migration first |

No sandbox runs without paid time or a hold:
- Every preview that is live at the switchover is within time it already paid for (rehearsal: 11 of 11).
- Every visit afterwards places a hold before the runtime is extended.
- A build sandbox is held from creation.

## 0. Preflight (read-only, free)

1. Run the inventory and confirm the expected state:
   ```
   npx tsx scripts/ops/preview-billing-inventory.ts
   ```
   - The 0.5 schema is absent.
   - No builds are in progress.
   - Note the live previews and active holds.
2. Confirm preview-host deploy access:
   - `vercel project inspect preview-host` from `preview-host/` lists project `preview-host`, which owns `preview.nynz.in` and `*.preview.nynz.in`.
   - A non-production `vercel deploy` from `preview-host/` succeeds.
3. CI is green for the commit.

## 1. Database

1. Run `supabase db push --linked`. It applies only `20261106100000_preview_sessions_and_trial.sql`. Production is at `20261105100000`.
   - It ran in 5 ms in the PostgreSQL 17 rehearsal.
   - It is additive, apart from the redefined functions `authorize_sandbox_runtime`, `reserve_credits`, `authorize_provider_spend` and `reconcile_credits`.
2. Verify:
   - The inventory script shows the schema present.
   - The ₹300/day `Free trial daily spend` row exists.
   - Every balance and grant is unchanged.

## 2. Worker and web app

1. Fast-forward `feat/nynz-platform` to the release commit and push. Render deploys the worker and Vercel deploys the web app.
2. Verify:
   - The worker heartbeat reports 0.5.0 on the commit.
   - `/version` reports 0.5.0.
   - Public pages pass.
   - Signed-in smoke checks pass.

## 3. Preview host

1. From `preview-host/`, run `vercel deploy --prod`.
   - No new environment variables are needed.
   - It uses the same Supabase, E2B and preview-signing configuration.
2. Verify:
   - `preview.nynz.in` responds.
   - Per-project hosts are aliased to the new deployment.
   - No `runtime:` ledger rows appear after the switchover.

## Trial rules after the release

- **New accounts:** 60 credits, valid for 7 days (`TRIAL_CREDITS`, `TRIAL_DAYS`), granted on the first request as source `trial`.
- **Existing 25-credit trial grants** (key `trial:<user>`, source promotional):
  - They are kept exactly as issued, with the same remaining credits and expiry dates. Production had 3 such grants, 36 credits remaining.
  - They are not topped up to 60: the trial grant key already exists, so the new grant is a no-op.
  - These accounts count as trial accounts for the daily trial allowance until they have plan, purchased or owner credits or a subscription.
- **Daily trial allowance:**
  - ₹300 per day across all trial-only accounts (`spend_limits` scope `trial`, changeable without a release).
  - It resets at 12:00 am India time.
  - Paid accounts always keep at least ₹700 of the ₹1,000 daily platform cap.

## Rollback

1. Run `supabase/rollback/20261106100000_preview_sessions_down.sql` in one transaction. It:
   - settles open preview sessions at the time they have run so far;
   - restores the old clock-window charge;
   - turns the trial limit off.
2. Redeploy 0.4.2: push `d1a0492` to `feat/nynz-platform`, and run `vercel deploy --prod` of the 0.4.2 preview host.

The rollback was rehearsed: sessions are settled, the old window charge is back, and credits still add up. The new tables and columns stay; 0.4.2 doesn't read them.
