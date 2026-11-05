import { beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, createUser, outcome, type Db } from "./harness";

/** Real migrations, real SQL: checkpoints, Resume, the durable brief and credits. */
let db: Db;
let alice: Awaited<ReturnType<typeof createUser>>;
let bob: Awaited<ReturnType<typeof createUser>>;

const q = <T = Record<string, any>>(sql: string, params: unknown[] = []) => asService(db, async (tx) => (await tx.query<T>(sql, params)).rows);

async function newProject(user: typeof alice) {
  return asUser(db, user, async (tx) => (await tx.query<{ id: string }>("insert into public.projects(owner_id,name) values($1,'StudioMark') returning id", [user.id])).rows[0].id);
}
async function newJob(projectId: string, user: typeof alice, mode = "create", lock = "worker:1") {
  const plan = { approval: "approved", summary: "StudioMark", steps: ["Landing", "Reports"], manifest: { files: [{ path: "src/a.tsx" }, { path: "src/b.tsx" }, { path: "src/c.tsx" }] }, estimate: { low: 10, high: 30, reserve: 12 } };
  const [row] = await q<{ id: string }>(
    "insert into public.build_jobs(project_id,requested_by,prompt,request,mode,idempotency_key,status,locked_by,locked_at,plan) values($1,$2,$3,$4,$5,gen_random_uuid()::text,'generating',$6,now(),$7) returning id",
    [projectId, user.id, "Build StudioMark\n\nUSER APPROVED PLAN (follow this scope):\n...", "Build StudioMark with demo login, variants and reports", mode, lock, plan]);
  await q("select public.begin_build_generation($1,$2)", [row.id, lock]);
  return row.id;
}
const step = (build: string, done: string[], files: Record<string, string>, lock = "worker:1", note: object | null = null) =>
  q("select public.record_build_step($1,$2,$3,$4,$5) as c", [build, lock, done, JSON.stringify(Object.entries(files).map(([path, content]) => ({ path, content }))), note ? JSON.stringify(note) : null]);
const staged = async (build: string) => Object.fromEntries((await q<{ path: string; content: string }>("select path,content from public.build_staged_files where build_id=$1 order by path", [build])).map((r) => [r.path, r.content]));
const job = async (build: string) => (await q("select * from public.build_jobs where id=$1", [build]))[0];
const grant = (user: typeof alice, amount: number) => q("select public.grant_credits($1,'promotional',$2,null,'test',null,gen_random_uuid()::text)", [user.id, amount]);

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db, { email: "alice@example.test" });
  bob = await createUser(db, { email: "bob@example.test" });
  await grant(alice, 200);
});

describe("checkpoints", () => {
  it("records each finished step with its files in one transaction and refuses a stale lease", async () => {
    const project = await newProject(alice);
    const build = await newJob(project, alice);
    const [{ c }] = await step(build, ["src/a.tsx"], { "src/a.tsx": "A" }, "worker:1", { label: "a.tsx" });
    expect(c.done).toEqual(["src/a.tsx"]);
    await step(build, ["src/b.tsx", "src/a.tsx"], { "src/b.tsx": "B" });
    expect((await job(build)).checkpoint.done).toEqual(["src/a.tsx", "src/b.tsx"]);
    expect(await staged(build)).toEqual({ "src/a.tsx": "A", "src/b.tsx": "B" });
    expect(await outcome(step(build, ["src/c.tsx"], { "src/c.tsx": "C" }, "worker:other"))).toMatch(/LEASE_LOST/);
    expect(await staged(build)).not.toHaveProperty("src/c.tsx");
  });

  it("keeps recorded progress when a requeued build starts generating again", async () => {
    const project = await newProject(alice);
    const build = await newJob(project, alice);
    await step(build, ["src/a.tsx"], { "src/a.tsx": "A" });
    // Worker restart: the stale build is requeued and claimed by a new worker.
    await q("update public.build_jobs set status='generating', locked_by='worker:2', locked_at=now() where id=$1", [build]);
    await q("select public.begin_build_generation($1,'worker:2')", [build]);
    expect(await staged(build)).toEqual({ "src/a.tsx": "A" });
  });

  it("keeps an edit's staged base across a restart", async () => {
    const project = await newProject(alice);
    const build = await newJob(project, alice, "edit");
    await step(build, [], { "src/a.tsx": "old A", "src/b.tsx": "old B" }, "worker:1", { base: true });
    expect((await job(build)).checkpoint.base_staged).toBe(true);
    await q("update public.build_jobs set locked_by='worker:2' where id=$1", [build]);
    await q("select public.begin_build_generation($1,'worker:2')", [build]);
    expect(Object.keys(await staged(build))).toEqual(["src/a.tsx", "src/b.tsx"]);
  });
});

describe("failure keeps finished work and Resume continues it", () => {
  it("marks a failed build resumable, keeps its files and resumes exactly once", async () => {
    const project = await newProject(alice);
    const build = await newJob(project, alice);
    await step(build, ["src/a.tsx", "src/b.tsx"], { "src/a.tsx": "A", "src/b.tsx": "B" });
    await q("select public.note_build_failure_step($1,'worker:1',$2)", [build, JSON.stringify({ paths: ["src/c.tsx"], reason: "cut off", label: "c.tsx" })]);
    await q("select public.finish_build_unsuccessfully($1,'worker:1','failed','GENERATION_INCOMPLETE','Resume continues')", [build]);
    const failed = await job(build);
    expect(failed.resumable).toBe(true);
    expect(failed.checkpoint.failed_step.label).toBe("c.tsx");
    expect(await staged(build)).toEqual({ "src/a.tsx": "A", "src/b.tsx": "B" });

    // Someone else cannot resume it.
    expect(await outcome(q("select public.resume_build($1,gen_random_uuid(),$2,'resume:x')", [build, bob.id]))).toMatch(/NOT_FOUND/);
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const [a] = await q<{ id: string }>("select (public.resume_build($1,$2,$3,$4)).id", [build, first, alice.id, `resume:${build}`]);
    // A second click returns the same build instead of starting another one.
    const [b] = await q<{ id: string }>("select (public.resume_build($1,$2,$3,$4)).id", [build, second, alice.id, `resume:${build}`]);
    expect(a.id).toBe(first);
    expect(b.id).toBe(first);
    const resumed = await job(first);
    expect(resumed.status).toBe("queued");
    expect(resumed.resume_of).toBe(build);
    expect(resumed.checkpoint.done).toEqual(["src/a.tsx", "src/b.tsx"]);
    expect(resumed.checkpoint.failed_step).toBeUndefined();
    expect(resumed.plan.approval).toBe("approved");
    expect(resumed.request).toBe("Build StudioMark with demo login, variants and reports");
    expect(await staged(first)).toEqual({ "src/a.tsx": "A", "src/b.tsx": "B" });
    expect(await staged(build)).toEqual({});
    expect((await job(build)).resumable).toBe(false);
    expect((await q("select count(*)::int n from public.build_jobs where resume_of=$1", [build]))[0].n).toBe(1);
  });

  it("chains: a resumed build that fails again resumes from its newest checkpoint with all work kept", async () => {
    const project = await newProject(alice);
    const a = await newJob(project, alice);
    await step(a, ["src/a.tsx"], { "src/a.tsx": "A" });
    await q("select public.finish_build_unsuccessfully($1,'worker:1','failed','GENERATION_INCOMPLETE','x')", [a]);
    const b = crypto.randomUUID();
    await q("select (public.resume_build($1,$2,$3,$4)).id", [a, b, alice.id, `resume:${a}`]);
    // The resumed build runs, finishes one more step, then fails again.
    await q("update public.build_jobs set status='generating', locked_by='worker:2', locked_at=now() where id=$1", [b]);
    await q("select public.begin_build_generation($1,'worker:2')", [b]);
    expect(await staged(b)).toEqual({ "src/a.tsx": "A" });
    await step(b, ["src/b.tsx"], { "src/b.tsx": "B" }, "worker:2");
    await q("select public.note_build_failure_step($1,'worker:2',$2)", [b, JSON.stringify({ paths: ["src/c.tsx"], reason: "cut off", label: "c.tsx" })]);
    await q("select public.finish_build_unsuccessfully($1,'worker:2','failed','GENERATION_INCOMPLETE','x')", [b]);
    expect((await job(b)).resumable).toBe(true);
    expect((await job(b)).checkpoint.done).toEqual(["src/a.tsx", "src/b.tsx"]);
    // Resuming the first build again only returns the build that already
    // resumed it; it never starts another one from the older checkpoint.
    const [again] = await q<{ id: string }>("select (public.resume_build($1,gen_random_uuid(),$2,'resume:again')).id", [a, alice.id]);
    expect(again.id).toBe(b);
    expect((await q("select count(*)::int n from public.build_jobs where resume_of=$1", [a]))[0].n).toBe(1);
    const c = crypto.randomUUID();
    await q("select (public.resume_build($1,$2,$3,$4)).id", [b, c, alice.id, `resume:${b}`]);
    const resumed = await job(c);
    expect(resumed.resume_of).toBe(b);
    expect(resumed.checkpoint.done).toEqual(["src/a.tsx", "src/b.tsx"]);
    expect(resumed.checkpoint.resumed_from).toBe(b);
    expect(resumed.checkpoint.failed_step).toBeUndefined();
    expect(await staged(c)).toEqual({ "src/a.tsx": "A", "src/b.tsx": "B" });
    expect(await staged(a)).toEqual({});
    expect(await staged(b)).toEqual({});
    expect((await job(b)).resumable).toBe(false);
  });

  it("refuses to resume after the project files changed", async () => {
    const project = await newProject(alice);
    const build = await newJob(project, alice);
    await step(build, ["src/a.tsx"], { "src/a.tsx": "A" });
    await q("select public.finish_build_unsuccessfully($1,'worker:1','failed','GENERATION_INCOMPLETE','x')", [build]);
    await q("insert into public.project_files(project_id,path,content) values($1,'src/manual.tsx','edited')", [project]);
    expect(await outcome(q("select public.resume_build($1,gen_random_uuid(),$2,'resume:y')", [build, alice.id]))).toMatch(/SOURCE_CHANGED/);
  });

  it("keeps progress when the customer stops the build, and nothing for a build with no finished step", async () => {
    const project = await newProject(alice);
    const stopped = await newJob(project, alice);
    await step(stopped, ["src/a.tsx"], { "src/a.tsx": "A" });
    await q("select public.finish_build_unsuccessfully($1,'worker:1','cancelled','CANCELLED','Stopped')", [stopped]);
    expect((await job(stopped)).resumable).toBe(true);
    const empty = await newJob(await newProject(alice), alice);
    await q("select public.finish_build_unsuccessfully($1,'worker:1','failed','GENERATION_INCOMPLETE','x')", [empty]);
    expect((await job(empty)).resumable).toBe(false);
  });
});

describe("durable brief", () => {
  it("stores the original brief at approval and every approved change, then marks it applied", async () => {
    const project = await newProject(alice);
    const create = await newJob(project, alice);
    await q("select public.record_approved_request($1)", [create]);
    let brief = (await q("select brief from public.projects where id=$1", [project]))[0].brief;
    expect(brief.original).toBe("Build StudioMark with demo login, variants and reports");
    expect(brief.plan.steps).toEqual(["Landing", "Reports"]);
    await q("insert into public.project_files(project_id,path,content) values($1,'src/App.tsx','app')", [project]);
    await q("update public.build_jobs set status='succeeded', locked_by=null where id=$1", [create]);
    const edit = await newJob(project, alice, "edit");
    await q("update public.build_jobs set request='Add a dark theme', plan=plan || '{\"summary\":\"Dark theme\"}' where id=$1", [edit]);
    await q("select public.record_approved_request($1)", [edit]);
    await q("select public.record_approved_request($1)", [edit]);
    brief = (await q("select brief from public.projects where id=$1", [project]))[0].brief;
    expect(brief.original).toBe("Build StudioMark with demo login, variants and reports");
    expect(brief.changes).toHaveLength(1);
    expect(brief.changes[0]).toMatchObject({ request: "Add a dark theme", status: "approved" });
    await q("update public.build_jobs set status='succeeded' where id=$1", [edit]);
    brief = (await q("select brief from public.projects where id=$1", [project]))[0].brief;
    expect(brief.changes[0].status).toBe("applied");
    // Customers cannot rewrite their brief directly.
    expect(await outcome(asUser(db, alice, (tx) => tx.query("update public.projects set brief='{}' where id=$1", [project])))).toMatch(/permission denied/);
  });

  it("keeps resumable progress when only the preview is restarted", async () => {
    const project = await newProject(alice);
    const failed = await newJob(project, alice);
    await step(failed, ["src/a.tsx"], { "src/a.tsx": "A" });
    await q("select public.finish_build_unsuccessfully($1,'worker:1','failed','GENERATION_INCOMPLETE','x')", [failed]);
    const restart = await newJob(project, alice, "restart", "worker:9");
    await q("update public.build_jobs set status='succeeded' where id=$1", [restart]);
    expect((await job(failed)).resumable).toBe(true);
    expect(await staged(failed)).toEqual({ "src/a.tsx": "A" });
  });

  it("clears leftover resumable progress once a later build succeeds", async () => {
    const project = await newProject(alice);
    const failed = await newJob(project, alice);
    await step(failed, ["src/a.tsx"], { "src/a.tsx": "A" });
    await q("select public.finish_build_unsuccessfully($1,'worker:1','failed','GENERATION_INCOMPLETE','x')", [failed]);
    const later = await newJob(project, alice);
    await q("update public.build_jobs set status='succeeded' where id=$1", [later]);
    expect((await job(failed)).resumable).toBe(false);
    expect(await staged(failed)).toEqual({});
  });
});

describe("credits on resume", () => {
  it("charges a finished step once, even if its usage event is reported again", async () => {
    const project = await newProject(alice);
    const build = crypto.randomUUID();
    const before = (await q("select public.credit_balance($1) b", [alice.id]))[0].b;
    await q("select public.reserve_credits($1,$2,$3,12,5)", [alice.id, project, build]);
    await q("select public.consume_credits($1,6,'openrouter:gen-same','openrouter','m',600,'provider_reported','{\"step\":\"a.tsx\"}')", [build]);
    const again = (await q("select public.consume_credits($1,6,'openrouter:gen-same','openrouter','m',600,'provider_reported','{}') r", [build]))[0].r;
    expect(again.duplicate).toBe(true);
    const settled = (await q("select public.settle_reservation($1,'failed') r", [build]))[0].r;
    expect(settled).toMatchObject({ consumed: 6, released: 6 });
    const after = (await q("select public.credit_balance($1) b", [alice.id]))[0].b;
    expect(Number(before.available) - Number(after.available)).toBe(6);
    const rows = await q<{ entry_type: string; amount: number; metadata: any }>("select entry_type,amount,metadata from public.credit_ledger where build_id=$1 order by id", [build]);
    expect(rows.map((r) => r.entry_type)).toEqual(["reserve", "consume", "release"]);
    expect(rows[1].metadata.step).toBe("a.tsx");
    expect(rows[2].metadata.released).toBe(6);
  });
});
