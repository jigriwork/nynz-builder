/**
 * Upgrade rehearsal for 20261105100000_resumable_builds.sql on existing data.
 *
 * The seed mirrors production's shape as probed read-only on 2026-11-05 (58
 * builds across create/edit/restart and succeeded/failed/cancelled, approved
 * plans appended to prompts, builds marked generation_complete, no staged
 * files, settled and released credit reservations with reserve/consume/
 * release ledger rows, promotional and owner-testing grants), plus a queued
 * build to cover a deploy that lands while a build waits. Credit rows are
 * written through the real credit functions. No customer data is used.
 *
 * Used by tests/db/resumable-upgrade.test.ts (in-process Postgres, every CI
 * run) and scripts/rehearse-resumable-migration.sh (disposable PostgreSQL 17).
 */
export type Exec = (sql: string, params?: unknown[]) => Promise<Array<Record<string, any>>>;
export const UNTIL = "20261104101500_project_cards.sql";
export const MIGRATION = "20261105100000_resumable_builds.sql";

const U = { owner: "10000000-0000-4000-8000-000000000001", a: "10000000-0000-4000-8000-000000000002", b: "10000000-0000-4000-8000-000000000003" };
const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const APPROVED = (summary: string) => ({ approval: "approved", revision: 1, summary, steps: ["Screens", "Data"], manifest: { plan: { summary, steps: ["Screens", "Data"] }, message: "Ready", files: [{ path: "src/App.tsx", purpose: "App" }] } });

export async function seed(exec: Exec) {
  for (const [id, email] of [[U.owner, "owner@rehearsal.test"], [U.a, "a@rehearsal.test"], [U.b, "b@rehearsal.test"]]) {
    await exec("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, email]);
  }
  await exec("select public.grant_credits($1,'owner_testing',500,null,'Owner testing',null,'rh:owner')", [U.owner]);
  await exec("select public.grant_credits($1,'promotional',70,now()+interval '2 days','Promo',null,'rh:a1')", [U.a]);
  await exec("select public.grant_credits($1,'promotional',50,null,'Promo',null,'rh:a2')", [U.a]);
  await exec("select public.grant_credits($1,'promotional',25,now()+interval '30 days','Welcome trial credits',null,'rh:b1')", [U.b]);

  const users = [U.owner, U.a, U.b];
  const shapes: Array<[string, string, string | null, boolean]> = [
    ["create", "succeeded", null, false], ["create", "failed", "GENERATION_INCOMPLETE", false], ["create", "failed", "BUILD_VALIDATION_FAILED", true],
    ["create", "failed", "INSUFFICIENT_CREDITS", false], ["create", "cancelled", "CANCELLED", false], ["edit", "succeeded", null, true],
    ["edit", "failed", "GENERATION_INCOMPLETE", false], ["edit", "cancelled", "CANCELLED", false], ["restart", "succeeded", null, false], ["restart", "failed", "WORKER_INTERRUPTED", false],
  ];
  let n = 0;
  for (let p = 0; p < 10; p += 1) {
    const owner = users[p % 3];
    const project = uuid(1000 + p);
    await exec("insert into public.projects(id,owner_id,name,status) values($1,$2,$3,'ready')", [project, owner, `Rehearsal ${p}`]);
    await exec("insert into public.project_files(project_id,path,content) values($1,'src/App.tsx',$2),($1,'index.html','<div id=root></div>')", [project, `export default function App(){return <h1>${p}</h1>}`]);
    await exec("insert into public.versions(project_id,created_by,label) values($1,$2,'Build')", [project, owner]);
    for (let k = 0; k < 6; k += 1) {
      const [mode, status, code, complete] = shapes[(p + k) % shapes.length];
      const id = uuid(++n);
      const brief = `Build app ${p}-${k} with screens and data`;
      const prompt = mode === "restart" ? "Restart the preview" : k % 3 === 0 ? brief : `${brief}\n\nUSER APPROVED PLAN (follow this scope):\nApp ${p}\n1. Screens\n2. Data`;
      const plan = mode === "restart" ? null : k % 3 === 0 ? { approval: "required", revision: 1 } : APPROVED(`App ${p}`);
      await exec(`insert into public.build_jobs(id,project_id,requested_by,prompt,mode,idempotency_key,status,plan,error_code,error_message,generation_complete,attempt_count,started_at,finished_at,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,now(),now(),now() - make_interval(mins => $12))`,
        [id, project, owner, prompt, mode, `rh-${id}`, status, plan ? JSON.stringify(plan) : null, code, code ? "Earlier wording" : null, complete, 600 - n]);
      // Credit history through the real functions: reserve, consume, settle.
      if (mode !== "restart" && (k + p) % 2 === 0) {
        await exec("select public.reserve_credits($1,$2,$3,5,10)", [owner, project, id]);
        await exec("select public.consume_credits($1,2,$2,'openrouter','google/gemini-3.8-flash',175,'provider_reported','{}')", [id, `openrouter:rh-${id}`]);
        await exec("select public.settle_reservation($1,$2)", [id, status]);
      }
    }
  }
  // A plan cancelled before any charge (released reservation).
  await exec("select public.reserve_credits($1,$2,$3,5,10)", [U.b, uuid(1009), uuid(900)]);
  await exec("insert into public.build_jobs(id,project_id,requested_by,prompt,mode,idempotency_key,status,plan) values($1,$2,$3,'Plan only','create','rh-plan-only','cancelled','{\"approval\":\"awaiting\",\"revision\":1}')", [uuid(900), uuid(1009), U.b]);
  await exec("select public.settle_reservation($1,'plan cancelled')", [uuid(900)]);
  // A build waiting in the queue while the deploy happens (with its hold).
  await exec("select public.reserve_credits($1,$2,$3,20,10)", [U.a, uuid(1001), uuid(901)]);
  await exec("insert into public.build_jobs(id,project_id,requested_by,prompt,mode,idempotency_key,status,plan) values($1,$2,$3,$4,'edit','rh-queued','queued',$5)",
    [uuid(901), uuid(1001), U.a, "Add a footer\n\nUSER APPROVED PLAN (follow this scope):\nFooter\n1. Footer", JSON.stringify(APPROVED("Footer"))]);
}

export async function snapshot(exec: Exec) {
  const one = async (sql: string) => (await exec(sql))[0];
  return {
    counts: await one(`select (select count(*) from public.build_jobs)::int builds, (select count(*) from public.projects)::int projects,
      (select count(*) from public.project_files)::int files, (select count(*) from public.versions)::int versions,
      (select count(*) from public.build_staged_files)::int staged, (select count(*) from public.credit_grants)::int grants,
      (select count(*) from public.credit_reservations)::int reservations, (select count(*) from public.credit_ledger)::int ledger`),
    builds: await exec("select id,status,mode,error_code,error_message,prompt,plan::text plan,generation_complete,attempt_count,locked_by,finished_at::text from public.build_jobs order by id"),
    projects: await exec("select id,owner_id,name,status,active_version_id,source_revision,preview_revision,last_error from public.projects order by id"),
    ledger: await exec("select id,user_id,entry_type,amount,event_key,metadata::text metadata from public.credit_ledger order by id"),
    reservations: await exec("select id,status,amount,consumed from public.credit_reservations order by id"),
    balances: await exec("select id, public.credit_balance(id)::text balance from auth.users order by id"),
  };
}

export type Check = { name: string; ok: boolean; detail?: string };

/** Compares before/after and checks the backfill. */
export async function verify(exec: Exec, before: Awaited<ReturnType<typeof snapshot>>): Promise<Check[]> {
  const after = await snapshot(exec);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const checks: Check[] = [
    { name: "row counts unchanged", ok: same(before.counts, after.counts), detail: JSON.stringify(after.counts) },
    { name: "existing builds unchanged (status, prompt, plan, errors)", ok: same(before.builds, after.builds) },
    { name: "projects unchanged", ok: same(before.projects, after.projects) },
    { name: "credit ledger unchanged", ok: same(before.ledger, after.ledger), detail: `${after.ledger.length} rows` },
    { name: "credit reservations unchanged", ok: same(before.reservations, after.reservations) },
    { name: "every credit balance unchanged", ok: same(before.balances, after.balances) },
  ];
  const builds = await exec("select prompt, request, resumable, checkpoint, resume_of from public.build_jobs");
  checks.push({ name: "request backfilled for every build", ok: builds.every((b) => typeof b.request === "string" && b.request.length > 0) });
  checks.push({ name: "request is the customer's text without the appended plan", ok: builds.every((b) => b.request === String(b.prompt).split("\n\nUSER APPROVED PLAN")[0] && !String(b.request).includes("USER APPROVED PLAN")) });
  checks.push({ name: "no existing build becomes resumable or gets a checkpoint", ok: builds.every((b) => b.resumable === false && b.checkpoint === null && b.resume_of === null) });
  checks.push({ name: "no project gets a brief until a new plan is approved", ok: (await exec("select count(*)::int n from public.projects where brief is not null"))[0].n === 0 });
  return checks;
}

/**
 * After the migration: the previous worker's calls still behave as before,
 * and the new functions work on records created before the migration.
 */
export async function exercise(exec: Exec): Promise<Check[]> {
  const checks: Check[] = [];
  // The previous worker claims the queued build and fails it without checkpoints.
  const [claimed] = await exec("select id from public.claim_build_job('old-worker:1')");
  checks.push({ name: "previous worker can claim the build queued during the deploy", ok: claimed?.id === uuid(901) });
  await exec("insert into public.build_staged_files(build_id,path,content) values($1,'src/App.tsx','partial')", [uuid(901)]);
  await exec("select public.begin_build_generation($1,'old-worker:1')", [uuid(901)]);
  checks.push({ name: "previous worker's start still clears unrecorded staged files", ok: (await exec("select count(*)::int n from public.build_staged_files where build_id=$1", [uuid(901)]))[0].n === 0 });
  await exec("insert into public.build_staged_files(build_id,path,content) values($1,'src/App.tsx','partial')", [uuid(901)]);
  await exec("select public.finish_build_unsuccessfully($1,'old-worker:1','failed','GENERATION_INCOMPLETE','x')", [uuid(901)]);
  const [legacy] = await exec("select status,resumable,(select count(*)::int from public.build_staged_files where build_id=$1) staged from public.build_jobs where id=$1", [uuid(901)]);
  checks.push({ name: "a build without recorded steps fails as before (not resumable, staging cleared)", ok: legacy.status === "failed" && legacy.resumable === false && legacy.staged === 0 });
  await exec("select public.settle_reservation($1,'failed')", [uuid(901)]);

  // A build the previous worker had fully generated and then failed in validation keeps its files for Resume.
  const [complete] = await exec("select id,project_id,requested_by,request from public.build_jobs where generation_complete and status='failed' and mode='create' limit 1");
  await exec("update public.build_jobs set status='validating', locked_by='old-worker:2' where id=$1", [complete.id]);
  await exec("insert into public.build_staged_files(build_id,path,content) values($1,'src/App.tsx','generated')", [complete.id]);
  await exec("select public.finish_build_unsuccessfully($1,'old-worker:2','failed','BUILD_VALIDATION_FAILED','x')", [complete.id]);
  const [kept] = await exec("select resumable from public.build_jobs where id=$1", [complete.id]);
  checks.push({ name: "a fully generated build that fails validation keeps its files for Resume", ok: kept.resumable === true });
  const resumedId = "30000000-0000-4000-8000-000000000001";
  await exec("select public.reserve_credits($1,$2,$3,5,10)", [complete.requested_by, complete.project_id, resumedId]);
  const [resumed] = await exec("select (public.resume_build($1,$2,$3,$4)).*", [complete.id, resumedId, complete.requested_by, `resume:${complete.id}`]);
  checks.push({ name: "Resume works on a build created before the migration", ok: resumed?.id === resumedId && resumed.generation_complete === true && resumed.request === complete.request && resumed.resume_of === complete.id });
  const staged = (await exec("select count(*)::int n from public.build_staged_files where build_id=$1", [resumedId]))[0].n;
  checks.push({ name: "its files moved to the resumed build", ok: staged === 1 });
  await exec("update public.build_jobs set status='cancelled' where id=$1", [resumedId]);
  await exec("select public.settle_reservation($1,'rehearsal')", [resumedId]);

  // The brief is recorded from an approved build created before the migration.
  const [approved] = await exec("select id,project_id,request from public.build_jobs where mode='create' and plan->>'approval'='approved' order by created_at limit 1");
  await exec("delete from public.project_files where project_id=$1", [approved.project_id]);
  await exec("select public.record_approved_request($1)", [approved.id]);
  const [brief] = await exec("select brief from public.projects where id=$1", [approved.project_id]);
  checks.push({ name: "brief recorded from a pre-migration approved build", ok: brief.brief?.original === approved.request && Array.isArray(brief.brief?.plan?.steps) });

  // A build inserted by the previous web app (no request column) still works.
  await exec("insert into public.build_jobs(id,project_id,requested_by,prompt,mode,idempotency_key,status) values('30000000-0000-4000-8000-000000000002',$1,$2,'Old web request','edit','rh-old-web','queued')", [approved.project_id, U.owner]);
  const [oldWeb] = await exec("select request from public.build_jobs where id='30000000-0000-4000-8000-000000000002'");
  checks.push({ name: "builds inserted by the previous web app are accepted (request left empty)", ok: oldWeb.request === null });
  await exec("update public.build_jobs set status='cancelled' where id='30000000-0000-4000-8000-000000000002'");

  // Success of a pre-migration project without a brief does not error.
  const [edit] = await exec("select id from public.build_jobs where mode='edit' and status='failed' limit 1");
  await exec("update public.build_jobs set status='succeeded' where id=$1", [edit.id]);
  checks.push({ name: "build success on a project without a brief runs the new trigger cleanly", ok: true });
  return checks;
}
