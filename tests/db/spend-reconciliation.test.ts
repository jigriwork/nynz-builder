import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asService, asUser, createDb, createUser, outcome, type Db } from "./harness";

let db: Db;
let owner: Awaited<ReturnType<typeof createUser>>;
const svc = async (sql: string, params: unknown[] = []) => asService(db, async tx => (await tx.query<any>(sql, params)).rows[0]);
beforeAll(async () => {
  db = await createDb(); owner = await createUser(db);
  await db.query("insert into public.staff_members(user_id,email,role,status) values($1,$2,'owner','active')", [owner.id,owner.email]);
});
async function fixture(expired = false) {
  const user = await createUser(db), build = randomUUID(), key = randomUUID();
  const grant = (await svc("select public.grant_credits($1,'promotional',20,now()+interval '1 day','fixture',null,$2) id", [user.id, key])).id;
  await svc("select public.reserve_credits($1,null,$2,10,1)", [user.id, build]);
  const spend = (await svc("select public.authorize_provider_spend('e2b','sandbox',null,1000,$1,$2,$3) id", [build,user.id,key])).id;
  await svc("select public.consume_credits($1,10,$2,'e2b',null,1000,'allocated_runtime_estimate',$3)", [build,key,JSON.stringify({ provider_spend_id:spend,paise_per_credit:100 })]);
  await svc("select public.settle_reservation($1,'done')", [build]);
  await svc("select public.settle_provider_spend($1,1000,'allocated_runtime_estimate')", [spend]);
  if (expired) await svc("update public.credit_grants set expires_at=now()-interval '1 day' where id=$1", [grant]);
  return { user, spend, grant };
}
const reconcile = (spend: number, actual = 210, evidence = "Provider invoice fixture line 1") => asUser(db,owner, async tx => (await tx.query<any>("select public.admin_reconcile_provider_spend($1,$2,$3) r",[spend,actual,evidence])).rows[0].r);

describe("honest estimated spend and invoice correction", () => {
  it("retains an estimate as an unsettled cap hold, then refunds exactly once with immutable evidence", async () => {
    const f = await fixture();
    expect(await svc("select actual_paise,status,estimated_paise from public.provider_spend where id=$1",[f.spend])).toEqual({actual_paise:null,status:"authorized",estimated_paise:1000});
    const before = (await svc("select public.credit_balance($1) b",[f.user.id])).b.available;
    expect(await reconcile(f.spend)).toMatchObject({duplicate:false,refunded_credits:7});
    expect((await svc("select public.credit_balance($1) b",[f.user.id])).b.available).toBe(before+7);
    expect(await reconcile(f.spend)).toMatchObject({duplicate:true,refunded_credits:7});
    expect((await svc("select public.credit_balance($1) b",[f.user.id])).b.available).toBe(before+7);
    expect(await outcome(reconcile(f.spend,110))).toMatch(/DUPLICATE/);
    expect((await svc("select actual_paise,cost_source,status from public.provider_spend where id=$1",[f.spend]))).toEqual({actual_paise:210,cost_source:"provider_invoice",status:"settled"});
    expect(await outcome(svc("update public.provider_spend_reconciliations set actual_paise=0 where spend_id=$1",[f.spend]))).toMatch(/permission denied/);
    expect((await svc("select count(*)::int n from public.admin_audit_log where action='provider_spend.reconciled' and target_id=$1",[String(f.spend)])).n).toBe(1);
  });
  it("requires the recently authenticated owner, never service role or a customer", async () => {
    const f = await fixture();
    expect(await outcome(asUser(db,f.user,tx=>tx.query("select public.admin_reconcile_provider_spend($1,0,'invoice evidence')",[f.spend])))).toMatch(/PERMISSION_DENIED/);
    expect(await outcome(svc("select public.admin_reconcile_provider_spend($1,0,'invoice evidence')",[f.spend]))).toMatch(/permission denied/);
    expect(await outcome(asUser(db,owner,tx=>tx.query("select public.admin_reconcile_provider_spend($1,0,'invoice evidence')",[f.spend]),{amr:[{method:"password",timestamp:1}]}))).toMatch(/REAUTH_REQUIRED/);
  });
  it("records an evidenced cost above the provisional debit without hiding the additional charge", async () => {
    const f = await fixture();
    expect(await reconcile(f.spend,1500)).toMatchObject({additional_credits:5,refunded_credits:0});
    expect((await svc("select public.credit_balance($1) b",[f.user.id])).b.available).toBe(5);
    expect((await svc("select cost_source,amount from public.credit_ledger where event_key=$1",[`spend-correction:${f.spend}`]))).toEqual({cost_source:"provider_invoice",amount:-5});
  });
  it("preserves expiry on refunded allowance and retains unknown costs in the combined cap", async () => {
    const f = await fixture(true);
    await reconcile(f.spend,0);
    expect((await svc("select expires_at < now() expired from public.credit_grants where idempotency_key=$1",[`spend-refund:${f.spend}:${f.grant}`])).expired).toBe(true);
    expect((await svc("select public.credit_balance($1) b",[f.user.id])).b.available).toBe(0);
    await fixture();
    await svc("insert into public.spend_limits(name,period,limit_paise,window_start,window_end) values('Combined verification','window',1,now()-interval '1 minute',now()+interval '1 day')");
    expect(await outcome(svc("select public.authorize_provider_spend('openrouter','model',null,1,null,null,$1)",[randomUUID()]))).toMatch(/SPEND_LIMIT/);
  });
});
