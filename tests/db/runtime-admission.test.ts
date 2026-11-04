import { beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, createUser, outcome, type Db } from "./harness";

let db: Db;
beforeAll(async () => { db = await createDb(); });
const svc = async (sql: string, params: unknown[] = []) => asService(db, async (tx) => (await tx.query<any>(sql, params)).rows[0]);

async function fixture() {
  const user = await createUser(db);
  const project = (await asUser(db, user, async (tx) => (await tx.query<any>("insert into public.projects(owner_id,name) values($1,'Runtime fixture') returning id", [user.id])).rows[0])).id;
  const sandbox = `sandbox-${project}`;
  await svc("select public.register_sandbox($1,$2,null)", [sandbox, project]);
  await svc("update public.platform_resources set state='active' where provider_ref=$1", [sandbox]);
  await svc("update public.projects set active_sandbox_id=$1,status='ready' where id=$2", [sandbox, project]);
  await svc("select public.grant_credits($1,'promotional',100,null,'fixture',null,$2)", [user.id, project]);
  return { user, project, sandbox };
}

describe("paid runtime admission", () => {
  it("publishes a consistent snapshot atomically and refuses cancellation and concurrent edits", async () => {
    const a = await fixture();
    await svc("insert into public.project_files(project_id,path,content) values($1,'index.html','working')", [a.project]);
    await svc("insert into public.published_sites(project_id,owner_id,slug) values($1,$2,$3)", [a.project, a.user.id, `fixture-${a.project.slice(0, 8)}`]);
    const job = (await svc("insert into public.build_jobs(project_id,requested_by,prompt,mode,idempotency_key,status,locked_by) values($1,$2,'publish','publish',$3,'installing','fixture-worker') returning id", [a.project, a.user.id, a.project])).id;
    const revision = (await svc("select public.stage_publish_source($1,'fixture-worker') r", [job])).r;
    const deployment = (await svc("insert into public.deployments(project_id,owner_id,build_id,artifact_prefix,source_revision) values($1,$2,$3,$4,$5) returning id", [a.project, a.user.id, job, `published-sites/${job}`, revision])).id;
    await svc("insert into public.platform_resources(kind,provider_ref,project_id,owner_id,purpose,state) values('deployment_artifact',$1,$2,$3,'publish','active')", [`published-sites/${job}`, a.project, a.user.id]);
    await svc("update public.build_jobs set cancel_requested_at=now() where id=$1", [job]);
    expect(await outcome(svc("select public.complete_publish($1,'fixture-worker',$2)", [job, deployment]))).toMatch(/CANCELLED/);
    expect((await svc("select active_deployment_id from public.published_sites where project_id=$1", [a.project])).active_deployment_id).toBeNull();
    await svc("update public.build_jobs set cancel_requested_at=null where id=$1", [job]);
    await svc("update public.project_files set content='manual edit' where project_id=$1", [a.project]);
    expect(await outcome(svc("select public.complete_publish($1,'fixture-worker',$2)", [job, deployment]))).toMatch(/SOURCE_CHANGED/);
    const refreshed = (await svc("select public.stage_publish_source($1,'fixture-worker') r", [job])).r;
    await svc("update public.deployments set source_revision=$1 where id=$2", [refreshed, deployment]);
    await svc("select public.complete_publish($1,'fixture-worker',$2)", [job, deployment]);
    expect((await svc("select status from public.build_jobs where id=$1", [job])).status).toBe("succeeded");
    expect((await svc("select active_deployment_id from public.published_sites where project_id=$1", [a.project])).active_deployment_id).toBe(deployment);
  });

  it("charges a window once, rejects cross-user access and revokes suspended access", async () => {
    const a = await fixture(), b = await fixture();
    const args = [a.project, a.user.id, a.sandbox];
    const sql = "select public.authorize_sandbox_runtime($1,$2,$3,600,320,4) id";
    const first = await svc(sql, args);
    expect(await svc(sql, args)).toEqual(first);
    expect((await svc("select public.credit_balance($1) b", [a.user.id])).b.available).toBe(96);
    expect(await outcome(svc(sql, [a.project, b.user.id, a.sandbox]))).toMatch(/NOT_PROJECT_OWNER/);
    expect(await outcome(svc(sql, [a.project, a.user.id, b.sandbox]))).toMatch(/NOT_PROJECT_OWNER/);
    expect(await outcome(asUser(db, a.user, (tx) => tx.query(sql, args)))).toMatch(/permission denied/);
    await svc("insert into public.account_status(user_id,status) values($1,'suspended')", [a.user.id]);
    expect(await outcome(svc(sql, args))).toMatch(/NOT_PROJECT_OWNER/);
  });

  it("rolls back allowance changes when the combined provider cap refuses resume", async () => {
    const a = await fixture();
    await svc("insert into public.spend_limits(name,provider,period,limit_paise) values('Refuse resume',null,'day',1)");
    const before = (await svc("select public.credit_balance($1) b", [a.user.id])).b;
    expect(await outcome(svc("select public.authorize_sandbox_runtime($1,$2,$3,600,320,4)", [a.project, a.user.id, a.sandbox]))).toMatch(/SPEND_LIMIT/);
    expect((await svc("select public.credit_balance($1) b", [a.user.id])).b).toEqual(before);
  });

  it("requires an isolated-preview-ready worker before accepting generation", async () => {
    await svc("insert into public.worker_heartbeats(worker_id,status,last_seen_at,capabilities) values('fixture','idle',now(),'{\"generation\":true,\"sandbox\":true}')");
    expect((await svc("select public.generation_ready() ready")).ready).toBe(false);
    await svc("update public.worker_heartbeats set capabilities=capabilities || '{\"preview_origin\":true}'::jsonb where worker_id='fixture'");
    expect((await svc("select public.generation_ready() ready")).ready).toBe(true);
  });

  it("refuses NYNZ platform credentials as a generated-app backend at the database boundary", async () => {
    const a = await fixture();
    expect(await outcome(svc("insert into public.generated_backend_connections(project_id,project_url,publishable_key) values($1,'https://rgrlilmfjurdchcnxolt.supabase.co','browser-safe-fixture')", [a.project]))).toMatch(/PLATFORM_BACKEND_FORBIDDEN/);
  });
});
