import { beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, createUser, outcome, type Db } from "./harness";

let db: Db;
let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;

async function newProject(user: typeof alice, name = "App") {
  return asUser(db, user, async (tx) => (await tx.query<{ id: string }>("insert into public.projects(owner_id,name) values($1,$2) returning id", [user.id, name])).rows[0].id);
}
async function newJob(projectId: string, user: typeof alice, mode = "create", lock = "worker:1") {
  return asService(db, async (tx) => (await tx.query<{ id: string }>(
    "insert into public.build_jobs(project_id,requested_by,prompt,mode,idempotency_key,status,locked_by,locked_at) values($1,$2,'brief',$3,gen_random_uuid()::text,'generating',$4,now()) returning id",
    [projectId, user.id, mode, lock])).rows[0].id);
}
async function stage(buildId: string, files: Record<string, string>) {
  await asService(db, async (tx) => { for (const [path, content] of Object.entries(files)) await tx.query("insert into public.build_staged_files(build_id,path,content) values($1,$2,$3)", [buildId, path, content]); });
}
async function registerSandbox(sandbox: string, projectId: string, buildId: string | null) {
  return asService(db, (tx) => tx.query("select public.register_sandbox($1,$2,$3)", [sandbox, projectId, buildId]));
}
async function promote(buildId: string, sandbox: string, lock = "worker:1") {
  return asService(db, async (tx) => (await tx.query<{ promote_build: { version_id: string } }>("select public.promote_build($1,$2,$3,'https://p','Build')", [buildId, lock, sandbox])).rows[0].promote_build);
}
async function files(projectId: string) {
  return asService(db, async (tx) => Object.fromEntries((await tx.query<{ path: string; content: string }>("select path,content from public.project_files where project_id=$1 order by path", [projectId])).rows.map((r) => [r.path, r.content])));
}
async function project(projectId: string) {
  return asService(db, async (tx) => (await tx.query<Record<string, any>>("select * from public.projects where id=$1", [projectId])).rows[0]);
}

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db, { email: "alice@example.test" });
  bob = await createUser(db, { email: "bob@example.test" });
});

describe("SEC-01 platform-managed fields", () => {
  it("lets owners rename but not rewrite sandbox, status, preview or version fields", async () => {
    const id = await newProject(alice);
    expect(await outcome(asUser(db, alice, (tx) => tx.query("update public.projects set name='Renamed' where id=$1", [id])))).toBe("OK");
    for (const column of ["active_sandbox_id='sbx-other'", "status='ready'", "preview_url='https://evil'", "active_version_id=null", "source_revision=0", "owner_id=owner_id"]) {
      expect(await outcome(asUser(db, alice, (tx) => tx.query(`update public.projects set ${column} where id=$1`, [id])))).toMatch(/permission denied/);
    }
    expect(await outcome(asUser(db, alice, (tx) => tx.query("insert into public.projects(owner_id,name,status) values($1,'x','ready')", [alice.id])))).toMatch(/permission denied/);
    expect(await outcome(asUser(db, alice, (tx) => tx.query("delete from public.projects where id=$1", [id])))).toMatch(/permission denied/);
  });

  it("blocks direct writes to versions, imports and jobs", async () => {
    const id = await newProject(alice);
    expect(await outcome(asUser(db, alice, (tx) => tx.query("insert into public.versions(project_id,created_by,label) values($1,$2,'fake')", [id, alice.id])))).toMatch(/permission denied/);
    expect(await outcome(asUser(db, alice, (tx) => tx.query("insert into public.website_imports(project_id,requested_by,source_url) values($1,$2,'https://x')", [id, alice.id])))).toMatch(/permission denied/);
    expect(await outcome(asUser(db, alice, (tx) => tx.query("update public.build_jobs set status='succeeded'")))).toMatch(/permission denied/);
    expect(await outcome(asUser(db, alice, (tx) => tx.query("select * from public.platform_resources")))).toMatch(/permission denied/);
  });

  it("isolates two users' projects and files", async () => {
    const id = await newProject(alice, "Private");
    await asService(db, (tx) => tx.query("insert into public.project_files(project_id,path,content) values($1,'src/a.ts','secret')", [id]));
    const seen = await asUser(db, bob, async (tx) => (await tx.query("select * from public.project_files where project_id=$1", [id])).rows.length);
    expect(seen).toBe(0);
    expect(await asUser(db, bob, async (tx) => (await tx.query("update public.projects set name='x' where id=$1 returning id", [id])).rows.length)).toBe(0);
    expect(await outcome(asUser(db, bob, (tx) => tx.query("select public.create_checkpoint($1,'steal')", [id])))).toMatch(/NOT_PROJECT_OWNER/);
  });

  it("refuses cross-project sandbox identifiers even for service-role writes", async () => {
    const a = await newProject(alice);
    const b = await newProject(bob);
    await registerSandbox("sbx-alice", a, null);
    expect(await outcome(asService(db, (tx) => tx.query("update public.projects set active_sandbox_id='sbx-alice' where id=$1", [b])))).toMatch(/SANDBOX_NOT_BOUND/);
    expect(await outcome(registerSandbox("sbx-alice", b, null))).toMatch(/SANDBOX_BOUND_ELSEWHERE/);
    await asService(db, (tx) => tx.query("update public.platform_resources set state='active' where provider_ref='sbx-alice'"));
    await asService(db, (tx) => tx.query("update public.projects set active_sandbox_id='sbx-alice' where id=$1", [a]));
    const forBob = await asService(db, async (tx) => (await tx.query("select * from public.authorize_sandbox_access($1,$2)", [a, bob.id])).rows);
    const forAlice = await asService(db, async (tx) => (await tx.query("select * from public.authorize_sandbox_access($1,$2)", [a, alice.id])).rows);
    expect(forBob).toHaveLength(0);
    expect(forAlice).toEqual([expect.objectContaining({ sandbox_id: "sbx-alice" })]);
    // The authorisation RPC is not callable by customers.
    expect(await outcome(asUser(db, bob, (tx) => tx.query("select * from public.authorize_sandbox_access($1,$2)", [a, alice.id])))).toMatch(/permission denied/);
  });

  it("suspension blocks project access and sandbox authorisation", async () => {
    const carol = await createUser(db);
    const id = await newProject(carol);
    await asService(db, (tx) => tx.query("insert into public.account_status(user_id,status,reason) values($1,'suspended','abuse')", [carol.id]));
    expect(await asUser(db, carol, async (tx) => (await tx.query("select id from public.projects where id=$1", [id])).rows.length)).toBe(0);
    expect(await outcome(asUser(db, carol, (tx) => tx.query("select public.create_checkpoint($1,'x')", [id])))).toMatch(/ACCOUNT_SUSPENDED/);
  });

  it("rate limits atomically per bucket and window", async () => {
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await asService(db, async (tx) => (await tx.query<{ allowed: boolean }>("select * from public.consume_rate_limit('t:1',3,60)")).rows[0].allowed));
    expect(results).toEqual([true, true, true, false]);
  });
});

describe("REL-01/02 staged builds and transactional history", () => {
  it("promotes only validated staged files and keeps the previous preview on failure", async () => {
    const id = await newProject(alice);
    const first = await newJob(id, alice);
    await asService(db, (tx) => tx.query("select public.begin_build_generation($1,'worker:1')", [first]));
    await stage(first, { "src/App.tsx": "v1", "package.json": "{}" });
    await registerSandbox("sbx-1", id, first);
    await promote(first, "sbx-1");
    expect(await files(id)).toEqual({ "package.json": "{}", "src/App.tsx": "v1" });
    const afterFirst = await project(id);
    expect(afterFirst).toMatchObject({ status: "ready", active_sandbox_id: "sbx-1" });
    expect(afterFirst.preview_revision).toBe(afterFirst.source_revision);

    // A second build stages a partial result and fails: canonical source,
    // version pointer and preview stay byte-identical.
    const second = await newJob(id, alice, "edit");
    await asService(db, (tx) => tx.query("select public.begin_build_generation($1,'worker:1')", [second]));
    await stage(second, { "src/App.tsx": "BROKEN" });
    await registerSandbox("sbx-2", id, second);
    await asService(db, (tx) => tx.query("update public.build_jobs set sandbox_id='sbx-2' where id=$1", [second]));
    await asService(db, (tx) => tx.query("select public.finish_build_unsuccessfully($1,'worker:1','failed','BUILD_FAILED','compile error')", [second]));
    expect(await files(id)).toEqual({ "package.json": "{}", "src/App.tsx": "v1" });
    const afterFail = await project(id);
    expect(afterFail).toMatchObject({ status: "ready", active_sandbox_id: "sbx-1", active_version_id: afterFirst.active_version_id, source_revision: afterFirst.source_revision });
    const staged = await asService(db, async (tx) => (await tx.query("select * from public.build_staged_files where build_id=$1", [second])).rows.length);
    expect(staged).toBe(0);
    const failedSandbox = await asService(db, async (tx) => (await tx.query<{ state: string }>("select state from public.platform_resources where provider_ref='sbx-2'")).rows[0].state);
    expect(failedSandbox).toBe("terminating");

    // A successful replacement marks the old sandbox for cleanup.
    const third = await newJob(id, alice, "edit");
    await asService(db, (tx) => tx.query("select public.begin_build_generation($1,'worker:1')", [third]));
    await stage(third, { "src/App.tsx": "v2", "package.json": "{}" });
    await registerSandbox("sbx-3", id, third);
    await promote(third, "sbx-3");
    expect((await files(id))["src/App.tsx"]).toBe("v2");
    const old = await asService(db, async (tx) => (await tx.query<{ state: string; terminate_reason: string }>("select state,terminate_reason from public.platform_resources where provider_ref='sbx-1'")).rows[0]);
    expect(old).toEqual({ state: "terminating", terminate_reason: "replaced" });
  });

  it("refuses to promote over manual edits made during the build", async () => {
    const id = await newProject(alice);
    const job = await newJob(id, alice);
    await asService(db, (tx) => tx.query("select public.begin_build_generation($1,'worker:1')", [job]));
    await asService(db, (tx) => tx.query("insert into public.project_files(project_id,path,content) values($1,'notes.md','mine')", [id]));
    await stage(job, { "src/App.tsx": "generated" });
    await registerSandbox("sbx-race", id, job);
    expect(await outcome(promote(job, "sbx-race"))).toMatch(/SOURCE_CHANGED/);
    expect(await files(id)).toEqual({ "notes.md": "mine" });
  });

  it("rejects promotion by a worker that lost its lease", async () => {
    const id = await newProject(alice);
    const job = await newJob(id, alice);
    await stage(job, { "a.ts": "x" });
    await registerSandbox("sbx-lease", id, job);
    expect(await outcome(promote(job, "sbx-lease", "worker:other"))).toMatch(/LEASE_LOST/);
  });

  it("checkpoints and restores transactionally with revision checks", async () => {
    const id = await newProject(alice);
    await asService(db, (tx) => tx.query("insert into public.project_files(project_id,path,content) values($1,'a.ts','one'),($1,'b.ts','keep')", [id]));
    const checkpoint = await asUser(db, alice, async (tx) => (await tx.query<{ create_checkpoint: string }>("select public.create_checkpoint($1,'Good')", [id])).rows[0].create_checkpoint);
    await asService(db, (tx) => tx.query("update public.project_files set content='two' where project_id=$1 and path='a.ts'", [id]));
    await asService(db, (tx) => tx.query("insert into public.project_files(project_id,path,content) values($1,'c.ts','new')", [id]));
    const rev = (await project(id)).source_revision;
    expect(await outcome(asUser(db, alice, (tx) => tx.query("select public.restore_version($1,$2,$3)", [id, checkpoint, Number(rev) - 1])))).toMatch(/REVISION_CONFLICT/);
    expect(await files(id)).toEqual({ "a.ts": "two", "b.ts": "keep", "c.ts": "new" });
    const result = await asUser(db, alice, async (tx) => (await tx.query<{ restore_version: { restored: number; backup_version_id: string } }>("select public.restore_version($1,$2,$3)", [id, checkpoint, rev])).rows[0].restore_version);
    expect(result.restored).toBe(2);
    expect(await files(id)).toEqual({ "a.ts": "one", "b.ts": "keep" });
    // The pre-restore state was preserved as its own checkpoint.
    const backup = await asService(db, async (tx) => (await tx.query("select path from public.version_files where version_id=$1 order by path", [result.backup_version_id])).rows.map((r: any) => r.path));
    expect(backup).toEqual(["a.ts", "b.ts", "c.ts"]);
    // Bob cannot restore Alice's version into his project.
    const bobs = await newProject(bob);
    expect(await outcome(asUser(db, bob, (tx) => tx.query("select public.restore_version($1,$2,null)", [bobs, checkpoint])))).toMatch(/VERSION_NOT_FOUND/);
  });

  it("refuses restore while a build is writing", async () => {
    const id = await newProject(alice);
    await asService(db, (tx) => tx.query("insert into public.project_files(project_id,path,content) values($1,'a.ts','one')", [id]));
    const v = await asUser(db, alice, async (tx) => (await tx.query<{ create_checkpoint: string }>("select public.create_checkpoint($1,'x')", [id])).rows[0].create_checkpoint);
    await newJob(id, alice);
    expect(await outcome(asUser(db, alice, (tx) => tx.query("select public.restore_version($1,$2,null)", [id, v])))).toMatch(/BUILD_ACTIVE/);
  });

  it("detects concurrent manual edits by content hash", async () => {
    const id = await newProject(alice);
    await asService(db, (tx) => tx.query("insert into public.project_files(project_id,path,content) values($1,'a.ts','base')", [id]));
    const base = await asService(db, async (tx) => (await tx.query<{ content_hash: string }>("select content_hash from public.project_files where project_id=$1", [id])).rows[0].content_hash);
    const save = (content: string) => asUser(db, alice, (tx) => tx.query("select public.save_project_files($1,$2::jsonb)", [id, JSON.stringify([{ path: "a.ts", content, base_hash: base }])]));
    expect(await outcome(save("tab one"))).toBe("OK");
    expect(await outcome(save("tab two"))).toMatch(/FILE_CONFLICT/);
    expect((await files(id))["a.ts"]).toBe("tab one");
  });

  it("deletes a project and queues all of its resources for cleanup", async () => {
    const id = await newProject(alice);
    await registerSandbox("sbx-del", id, null);
    await asUser(db, alice, (tx) => tx.query("select public.request_project_deletion($1)", [id]));
    expect(await project(id)).toBeUndefined();
    const states = await asService(db, async (tx) => (await tx.query<{ kind: string; state: string }>("select kind,state from public.platform_resources where project_id=$1 order by kind", [id])).rows);
    expect(states).toEqual([{ kind: "e2b_sandbox", state: "terminating" }, { kind: "storage_prefix", state: "terminating" }]);
  });

  it("recovers stale jobs without discarding the working preview", async () => {
    const id = await newProject(alice);
    const job = await newJob(id, alice);
    await asService(db, (tx) => tx.query("update public.build_jobs set locked_at=now()-interval '10 minutes', attempt_count=3, sandbox_id='sbx-stale' where id=$1", [job]));
    await registerSandbox("sbx-stale", id, job);
    await asService(db, (tx) => tx.query("select * from public.recover_stale_build_jobs(120)"));
    const row = await asService(db, async (tx) => (await tx.query<{ status: string; error_code: string }>("select status,error_code from public.build_jobs where id=$1", [job])).rows[0]);
    expect(row).toEqual({ status: "failed", error_code: "WORKER_INTERRUPTED" });
    const sandbox = await asService(db, async (tx) => (await tx.query<{ state: string }>("select state from public.platform_resources where provider_ref='sbx-stale'")).rows[0].state);
    expect(sandbox).toBe("terminating");
  });
});
