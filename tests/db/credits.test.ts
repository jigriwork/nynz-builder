import { beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, createUser, outcome, type Db } from "./harness";

let db: Db;
let owner: Awaited<ReturnType<typeof createUser>>;
const svc = async <T = any>(sql: string, params: unknown[] = []) => asService(db, async (tx) => (await tx.query<any>(sql, params)).rows[0] as T);
const balance = async (user: string) => (await svc("select public.credit_balance($1) b", [user])).b;

async function setupCustomer(credits: number) {
  const user = await createUser(db);
  const project = await asUser(db, user, async (tx) => (await tx.query<{ id: string }>("insert into public.projects(owner_id,name) values($1,'p') returning id", [user.id])).rows[0].id);
  if (credits) await svc("select public.grant_credits($1,'plan_included',$2,now()+interval '30 days','plan',null,$3)", [user.id, credits, `plan-${user.id}`]);
  return { user, project };
}
async function job(user: string, project: string) {
  return (await svc("insert into public.build_jobs(project_id,requested_by,prompt,idempotency_key) values($1,$2,'x',gen_random_uuid()::text) returning id", [project, user])).id as string;
}

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, { id: "41080a24-57a9-4686-8d53-c0a3a9e09588", email: "adib@nynz.in" });
  await svc("select public.bootstrap_owner($1,'adib@nynz.in')", [owner.id]);
});

describe("credit ledger", () => {
  it("reserves before work, consumes actual cost, and releases the remainder", async () => {
    const { user, project } = await setupCustomer(100);
    const build = await job(user.id, project);
    await svc("select public.reserve_credits($1,$2,$3,40,2)", [user.id, project, build]);
    expect(await balance(user.id)).toMatchObject({ included: 100, reserved: 40, available: 60 });
    await svc("select public.consume_credits($1,12,'evt-1','openrouter','m',1200,'provider_reported')", [build]);
    expect(await svc("select public.consume_credits($1,12,'evt-1','openrouter','m',1200,'provider_reported') r", [build])).toEqual({ r: { duplicate: true } });
    await svc("select public.settle_reservation($1,'succeeded')", [build]);
    expect(await balance(user.id)).toMatchObject({ included: 88, reserved: 0, used: 12, available: 88 });
  });

  it("refuses work without sufficient credits and enforces concurrency", async () => {
    const { user, project } = await setupCustomer(10);
    expect(await outcome(svc("select public.reserve_credits($1,$2,$3,50,2)", [user.id, project, await job(user.id, project)]))).toMatch(/INSUFFICIENT_CREDITS/);
    const rich = await setupCustomer(1000);
    const p2 = (await svc("insert into public.projects(owner_id,name) values($1,'p2') returning id", [rich.user.id])).id;
    await svc("select public.reserve_credits($1,$2,$3,10,1)", [rich.user.id, rich.project, await job(rich.user.id, rich.project)]);
    expect(await outcome(svc("select public.reserve_credits($1,$2,$3,10,1)", [rich.user.id, p2, await job(rich.user.id, p2)]))).toMatch(/CONCURRENCY_LIMIT/);
  });

  it("prevents concurrent overspending across projects", async () => {
    const { user, project } = await setupCustomer(100);
    const p2 = (await svc("insert into public.projects(owner_id,name) values($1,'p2') returning id", [user.id])).id;
    const [a, b] = [await job(user.id, project), await job(user.id, p2)];
    const results = await Promise.all([
      outcome(svc("select public.reserve_credits($1,$2,$3,70,5)", [user.id, project, a])),
      outcome(svc("select public.reserve_credits($1,$2,$3,70,5)", [user.id, p2, b])),
    ]);
    expect(results.sort()).toEqual(["INSUFFICIENT_CREDITS", "OK"]);
    expect((await balance(user.id)).available).toBe(30);
  });

  it("extends a reservation only from available credits and absorbs overruns instead of going negative", async () => {
    const { user, project } = await setupCustomer(50);
    const build = await job(user.id, project);
    await svc("select public.reserve_credits($1,$2,$3,20,2)", [user.id, project, build]);
    expect(await svc("select public.ensure_reservation_headroom($1,45) ok", [build])).toEqual({ ok: true });
    expect(await svc("select public.ensure_reservation_headroom($1,60) ok", [build])).toEqual({ ok: false });
    const r = await svc("select public.consume_credits($1,70,'evt-over','openrouter','m',7000,'provider_reported') r", [build]);
    expect(r.r).toEqual({ charged: 50, absorbed: 20 });
    expect((await balance(user.id)).available).toBe(0);
  });

  it("deduplicates late responses after settlement", async () => {
    const { user, project } = await setupCustomer(30);
    const build = await job(user.id, project);
    await svc("select public.reserve_credits($1,$2,$3,10,2)", [user.id, project, build]);
    await svc("select public.settle_reservation($1,'cancelled')", [build]);
    await svc("select public.settle_reservation($1,'cancelled')", [build]);
    const late = await svc("select public.consume_credits($1,5,'late-1','openrouter','m',500,'provider_reported') r", [build]);
    expect(late.r).toEqual({ charged: 5, absorbed: 0 });
    expect(await svc("select public.consume_credits($1,5,'late-1','openrouter','m',500,'provider_reported') r", [build])).toEqual({ r: { duplicate: true } });
    expect((await balance(user.id)).available).toBe(25);
  });

  it("expires grants and releases reservations of finished or deleted builds", async () => {
    const { user, project } = await setupCustomer(0);
    await svc("select public.grant_credits($1,'promotional',10,now()+interval '1 second','promo',null,$2)", [user.id, `promo-${user.id}`]);
    const build = await job(user.id, project);
    await svc("select public.reserve_credits($1,$2,$3,5,2)", [user.id, project, build]);
    await svc("update public.build_jobs set status='failed' where id=$1", [build]);
    await db.query("update public.credit_grants set expires_at=now()-interval '1 second' where user_id=$1", [user.id]);
    const result = await svc("select public.reconcile_credits() r");
    expect(result.r.released).toBeGreaterThanOrEqual(1);
    expect(await balance(user.id)).toMatchObject({ reserved: 0, available: 0, promotional: 0 });
    const types = (await asService(db, async (tx) => (await tx.query<{ entry_type: string }>("select entry_type from public.credit_ledger where user_id=$1 order by id", [user.id])).rows)).map((r) => r.entry_type);
    expect(types).toEqual(["grant", "reserve", "release", "expire"]);
  });

  it("customers see only their own history and cannot write it", async () => {
    const a = await setupCustomer(5);
    const b = await setupCustomer(5);
    expect(await asUser(db, a.user, async (tx) => (await tx.query("select * from public.credit_ledger")).rows.length)).toBe(1);
    expect(await asUser(db, b.user, async (tx) => (await tx.query("select * from public.credit_grants where user_id=$1", [a.user.id])).rows.length)).toBe(0);
    expect(await outcome(asUser(db, a.user, (tx) => tx.query("select public.grant_credits($1,'purchased',1000,null,'x',null,'self')", [a.user.id])))).toMatch(/permission denied/);
    expect(await outcome(asUser(db, a.user, (tx) => tx.query("update public.credit_grants set remaining=9999")))).toMatch(/permission denied/);
    expect(await outcome(db.query("delete from public.credit_ledger"))).toMatch(/APPEND_ONLY/);
  });
});

describe("staff credit adjustments", () => {
  it("records actor, reason, expiry; prevents duplicates; enforces role limits", async () => {
    const { user } = await setupCustomer(0);
    const id = await asUser(db, owner, async (tx) => (await tx.query("select public.admin_grant_credits($1,25,'promotional',now()+interval '10 days','goodwill','idem-0001') id", [user.id])).rows[0]);
    expect(id).toBeTruthy();
    expect(await outcome(asUser(db, owner, (tx) => tx.query("select public.admin_grant_credits($1,25,'promotional',null,'goodwill','idem-0001')", [user.id])))).toMatch(/DUPLICATE/);
    const audit = await svc("select actor_id, reason, after from public.admin_audit_log where action='credits.granted' order by id desc limit 1");
    expect(audit).toMatchObject({ actor_id: owner.id, reason: "goodwill" });
    expect(audit.after.amount).toBe(25);

    const support = await createUser(db, { email: "support-credits@example.test" });
    const inv = await asUser(db, owner, async (tx) => (await tx.query<any>("select public.admin_invite_staff($1,'','support','{}','hire') r", [support.email])).rows[0].r);
    await asUser(db, support, (tx) => tx.query("select public.accept_staff_invitation($1)", [inv.invitation_id]));
    expect(await outcome(asUser(db, support, (tx) => tx.query("select public.admin_grant_credits($1,500,'promotional',null,'too much','idem-0002')", [user.id])))).toMatch(/LIMIT_EXCEEDED/);
    expect(await outcome(asUser(db, support, (tx) => tx.query("select public.admin_grant_credits($1,150,'promotional',null,'goodwill','idem-0003')", [user.id])))).toBe("OK");
    expect(await outcome(asUser(db, support, (tx) => tx.query("select public.admin_grant_credits($1,10,'promotional',null,'self','idem-0004')", [support.id])))).toMatch(/SELF_MODIFICATION/);
    expect(await outcome(asUser(db, support, (tx) => tx.query("select public.admin_debit_credits($1,10,'oops','idem-0005')", [user.id])))).toMatch(/PERMISSION_DENIED/);
  });

  it("owner testing credits are explicit, expiring and budgeted", async () => {
    expect(await outcome(asUser(db, owner, (tx) => tx.query("select public.admin_grant_credits($1,100,'owner_testing',null,'testing','own-0001')", [owner.id])))).toMatch(/INVALID_STATE/);
    expect(await outcome(asUser(db, owner, (tx) => tx.query("select public.admin_grant_credits($1,400,'owner_testing',now()+interval '7 days','testing','own-0002')", [owner.id])))).toBe("OK");
    expect(await outcome(asUser(db, owner, (tx) => tx.query("select public.admin_grant_credits($1,200,'owner_testing',now()+interval '7 days','more','own-0003')", [owner.id])))).toMatch(/LIMIT_EXCEEDED/);
    expect((await balance(owner.id)).owner_testing).toBe(400);
  });
});

describe("platform spend caps", () => {
  it("blocks provider calls that would exceed a combined cap before they are sent", async () => {
    await db.query("update public.spend_limits set active=false");
    await db.query("insert into public.spend_limits(name,period,window_start,window_end,limit_paise) values('Verification ₹50','window',now()-interval '1 minute',now()+interval '1 day',5000)");
    const first = await svc("select public.authorize_provider_spend('openrouter','model','m',3000,null,null,'call-1') id");
    await svc("select public.settle_provider_spend($1,2500,'provider_reported')", [first.id]);
    await svc("select public.record_provider_spend('e2b','sandbox',null,1000,'estimate',null,null,'sbx-1')");
    expect(await outcome(svc("select public.authorize_provider_spend('openrouter','model','m',2000,null,null,'call-2')"))).toMatch(/SPEND_LIMIT/);
    expect(await outcome(svc("select public.authorize_provider_spend('openrouter','model','m',1500,null,null,'call-3')"))).toBe("OK");
    const spent = await svc("select sum(coalesce(actual_paise,estimated_paise))::int s from public.provider_spend where status<>'voided'");
    expect(spent.s).toBeLessThanOrEqual(5000);
  });

  it("only owner-level staff can change limits, with audit", async () => {
    const reader = await createUser(db, { email: "reader-limits@example.test" });
    const inv = await asUser(db, owner, async (tx) => (await tx.query<any>("select public.admin_invite_staff($1,'','readonly','{}','hire') r", [reader.email])).rows[0].r);
    await asUser(db, reader, (tx) => tx.query("select public.accept_staff_invitation($1)", [inv.invitation_id]));
    expect(await outcome(asUser(db, reader, (tx) => tx.query("select public.admin_set_spend_limit(null,'x',null,'day',100,80,true,null,null,'raise')")))).toMatch(/PERMISSION_DENIED/);
    expect(await outcome(asUser(db, owner, (tx) => tx.query("select public.admin_set_spend_limit(null,'Daily',null,'day',100000,80,true,null,null,'set cap')")))).toBe("OK");
  });
});

describe("account deletion with credit history", () => {
  it("deletes the account and keeps its ledger rows detached; the ledger stays append-only", async () => {
    const { user, project } = await setupCustomer(20);
    const build = await job(user.id, project);
    await svc("select public.reserve_credits($1,$2,$3,5,2)", [user.id, project, build]);
    await svc("select public.consume_credits($1,3,'evt-del','openrouter','m',300,'provider_reported')", [build]);
    const before = Number((await db.query<{ n: number }>("select count(*)::int n from public.credit_ledger where user_id=$1", [user.id])).rows[0].n);
    expect(before).toBeGreaterThan(0);
    expect(await outcome(db.query("delete from auth.users where id=$1", [user.id]))).toBe("OK");
    expect((await db.query<{ n: number }>("select count(*)::int n from public.credit_ledger where event_key='evt-del' and user_id is null")).rows[0].n).toBe(1);
    expect(await outcome(db.query("update public.credit_ledger set amount=0 where event_key='evt-del'"))).toMatch(/APPEND_ONLY/);
    expect(await outcome(db.query("delete from public.credit_ledger where event_key='evt-del'"))).toMatch(/APPEND_ONLY/);
  });
});

describe("other append-only tables sharing the ledger guard", () => {
  it("provider spend reconciliations still refuse updates and deletes with the append-only error", async () => {
    const spend = (await db.query<{ id: number }>("insert into public.provider_spend(provider,kind,estimated_paise,event_key) values('openrouter','model',100,'recon-guard') returning id")).rows[0].id;
    await db.query("insert into public.provider_spend_reconciliations(spend_id,actual_paise,evidence,actor_id) values($1,90,'invoice line 42 reconciled',gen_random_uuid())", [spend]);
    expect(await outcome(db.query("update public.provider_spend_reconciliations set actual_paise=1 where spend_id=$1", [spend]))).toMatch(/APPEND_ONLY/);
    expect(await outcome(db.query("delete from public.provider_spend_reconciliations where spend_id=$1", [spend]))).toMatch(/APPEND_ONLY/);
  });
});
