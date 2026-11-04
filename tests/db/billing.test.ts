import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createDb, createUser, outcome, type Db } from "./harness";
import { grossWithTax, verifyOrderCheckout, verifySubscriptionCheckout, verifyWebhookSignature } from "../../lib/billing/razorpay";

let db: Db;
const svc = async <T = any>(sql: string, params: unknown[] = []) => asService(db, async (tx) => (await tx.query<any>(sql, params)).rows[0] as T);
const t = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

async function subscriber(plan = "starter") {
  const user = await createUser(db);
  const subId = `sub_${user.id.replace(/-/g, "").slice(0, 14)}`;
  await svc("update public.plans set provider_plan_id='plan_STARTER0000001' where code='starter' and retired_at is null");
  await svc("select public.create_pending_subscription($1,$2,$3)", [user.id, plan, subId]);
  return { user, subId };
}
const sub = (id: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ id, status: "active", plan_id: "plan_STARTER0000001", current_start: t(start), current_end: t(end), ...extra });
const pay = (id: string, amount = 117882) => ({ id, amount, status: "captured", method: "upi", created_at: t("2026-11-05") });
const apply = (eventId: string, type: string, at: string, subscription: object, payment: object | null = null) =>
  svc("select public.apply_subscription_event($1,$2,$3,$4::jsonb,$5::jsonb) r", [eventId, type, at, JSON.stringify(subscription), payment ? JSON.stringify(payment) : null]);
const ent = async (user: string) => (await svc("select public.current_entitlements($1) e", [user])).e;

beforeAll(async () => { db = await createDb(); });

describe("Razorpay signatures", () => {
  const secret = "whsec_test_fixture_secret";
  it("verifies webhook HMAC over the exact raw body", () => {
    const raw = '{"event":"subscription.charged","payload":{}}';
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    expect(verifyWebhookSignature(raw, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(JSON.stringify(JSON.parse(raw), null, 1), signature, secret)).toBe(false);
    expect(verifyWebhookSignature(raw, signature.replace(/.$/, "0"), secret)).toBe(false);
    expect(verifyWebhookSignature(raw, null, secret)).toBe(false);
  });
  it("verifies checkout signatures against server-stored ids", () => {
    const key = "key_secret_fixture";
    const signature = createHmac("sha256", key).update("pay_1|sub_server").digest("hex");
    expect(verifySubscriptionCheckout({ paymentId: "pay_1", storedSubscriptionId: "sub_server", signature }, key)).toBe(true);
    expect(verifySubscriptionCheckout({ paymentId: "pay_1", storedSubscriptionId: "sub_attacker", signature }, key)).toBe(false);
    const orderSig = createHmac("sha256", key).update("order_1|pay_1").digest("hex");
    expect(verifyOrderCheckout({ storedOrderId: "order_1", paymentId: "pay_1", signature: orderSig }, key)).toBe(true);
  });
  it("prices plans excluding GST and keeps tax separate", () => {
    expect(grossWithTax(99900, 1800)).toBe(117882);
    expect(grossWithTax(149900, 1800)).toBe(176882);
  });
});

describe("subscription webhooks", () => {
  it("does not grant access from checkout creation alone", async () => {
    const { user } = await subscriber();
    expect(await ent(user.id)).toMatchObject({ plan_code: "free" });
  });

  it("activates on webhook, grants one allowance per period and splits tax from revenue", async () => {
    const { user, subId } = await subscriber();
    await apply("evt_a1", "subscription.activated", "2026-11-05T00:00:00Z", sub(subId, "2026-11-05", "2026-12-05"));
    expect(await ent(user.id)).toMatchObject({ plan_code: "starter", subscription_status: "active", max_concurrent_builds: 1 });
    await apply("evt_c1", "subscription.charged", "2026-11-05T00:00:01Z", sub(subId, "2026-11-05", "2026-12-05"), pay("pay_A1"));
    expect(await apply("evt_c1", "subscription.charged", "2026-11-05T00:00:01Z", sub(subId, "2026-11-05", "2026-12-05"), pay("pay_A1"))).toEqual({ r: "duplicate" });
    // A different event id for the same payment/period still grants only once.
    await apply("evt_c1b", "subscription.charged", "2026-11-05T00:00:02Z", sub(subId, "2026-11-05", "2026-12-05"), pay("pay_A1"));
    const payment = await svc("select amount_minor,tax_minor,net_minor,status from public.payments where provider_payment_id='pay_A1'");
    expect(payment).toEqual({ amount_minor: 117882, tax_minor: 17982, net_minor: 99900, status: "captured" });
    expect((await svc("select public.credit_balance($1) b", [user.id])).b.included).toBe(400);
    // Renewal grants the next period.
    await apply("evt_c2", "subscription.charged", "2026-12-05T00:00:01Z", sub(subId, "2026-12-05", "2027-01-05"), pay("pay_A2"));
    expect(Number((await svc("select count(*) n from public.credit_grants where user_id=$1", [user.id])).n)).toBe(2);
  });

  it("ignores stale out-of-order status events but keeps later billing periods", async () => {
    const { user, subId } = await subscriber();
    await apply("evt_o2", "subscription.charged", "2026-11-05T00:10:00Z", sub(subId, "2026-11-05", "2026-12-05"), pay("pay_O1"));
    expect(await apply("evt_o1", "subscription.authenticated", "2026-11-05T00:00:00Z", sub(subId, "2026-11-05", "2026-12-05", { status: "authenticated" }))).toEqual({ r: "stale_ignored" });
    expect(await ent(user.id)).toMatchObject({ subscription_status: "active" });
  });

  it("applies documented failure, grace, halt and cancellation behaviour", async () => {
    const { user, subId } = await subscriber();
    const end = new Date(Date.now() + 2 * 86400_000).toISOString();
    await apply("evt_f1", "subscription.charged", new Date(Date.now() - 1000).toISOString(), { ...sub(subId, "2026-11-05", end), current_end: t(end) }, pay("pay_F1"));
    await apply("evt_f2", "subscription.pending", new Date().toISOString(), { ...sub(subId, "2026-11-05", end), status: "pending", current_end: t(end) });
    const pending = await ent(user.id);
    expect(pending).toMatchObject({ plan_code: "starter", subscription_status: "pending" });
    await apply("evt_f3", "subscription.halted", new Date(Date.now() + 1000).toISOString(), { ...sub(subId, "2026-11-05", end), status: "halted" });
    expect(await ent(user.id)).toMatchObject({ plan_code: "free" });
    const other = await subscriber();
    await apply("evt_x1", "subscription.charged", new Date(Date.now() - 1000).toISOString(), { ...sub(other.subId, "2026-11-05", end), current_end: t(end) }, pay("pay_X1"));
    await apply("evt_x2", "subscription.cancelled", new Date().toISOString(), { ...sub(other.subId, "2026-11-05", end), status: "cancelled", current_end: t(end) });
    expect(await ent(other.user.id)).toMatchObject({ plan_code: "starter", subscription_status: "cancelled" });
  });

  it("records unknown subscriptions without granting anything", async () => {
    expect(await apply("evt_u1", "subscription.charged", "2026-11-05T00:00:00Z", sub("sub_UNKNOWN0000000", "2026-11-05", "2026-12-05"), pay("pay_U1"))).toEqual({ r: "unknown_subscription" });
    expect(await svc("select count(*)::int n from public.payments where provider_payment_id='pay_U1'")).toEqual({ n: 0 });
  });
});

describe("top-ups and refunds", () => {
  it("grants purchased credits once, only for the exact amount", async () => {
    const user = await createUser(db);
    await db.query("update public.topup_packs set active=true where code='credits_100'");
    await svc("select public.create_topup_order($1,'credits_100','order_T1')", [user.id]);
    const p = { id: "pay_T1", order_id: "order_T1", amount: 23482, status: "captured" };
    expect(await svc("select public.apply_topup_payment('evt_t0','payment.captured',now(),$1::jsonb) r", [JSON.stringify({ ...p, id: "pay_T0", amount: 100 })])).toEqual({ r: "amount_mismatch" });
    expect(await svc("select public.apply_topup_payment('evt_t1','payment.captured',now(),$1::jsonb) r", [JSON.stringify(p)])).toEqual({ r: "applied" });
    expect(await svc("select public.apply_topup_payment('evt_t2','order.paid',now(),$1::jsonb) r", [JSON.stringify(p)])).toEqual({ r: "applied" });
    expect((await svc("select public.credit_balance($1) b", [user.id])).b.purchased).toBe(100);
  });

  it("authorised refunds are audited and processed once", async () => {
    const owner = await createUser(db, { email: "owner-billing@example.test" });
    await svc("select public.bootstrap_owner($1,$2)", [owner.id, owner.email]);
    const payment = await svc("select id,user_id from public.payments where provider_payment_id='pay_T1'");
    const customer = await createUser(db);
    expect(await outcome(asUser(db, customer, (tx) => tx.query("select public.admin_request_refund($1,100,'refund','false')", [payment.id])))).toMatch(/PERMISSION_DENIED/);
    const refund = await asUser(db, owner, async (tx) => (await tx.query<any>("select public.admin_request_refund($1,23482,'customer request',true) id", [payment.id])).rows[0].id);
    expect(await outcome(asUser(db, owner, (tx) => tx.query("select public.admin_request_refund($1,1,'more','false')", [payment.id])))).toMatch(/LIMIT_EXCEEDED/);
    await svc("select public.record_refund_submission($1,'rfnd_1',true,null)", [refund]);
    expect((await svc("select public.credit_balance($1) b", [payment.user_id])).b.purchased).toBe(0);
    expect(await svc("select public.apply_refund_event('evt_r1',now(),$1::jsonb) r", [JSON.stringify({ id: "rfnd_1", payment_id: "pay_T1", amount: 23482 })])).toEqual({ r: "applied" });
    expect(await svc("select public.apply_refund_event('evt_r2',now(),$1::jsonb) r", [JSON.stringify({ id: "rfnd_1", payment_id: "pay_T1", amount: 23482 })])).toEqual({ r: "already_processed" });
    expect(await svc("select status, refunded_minor::int from public.payments where provider_payment_id='pay_T1'")).toEqual({ status: "refunded", refunded_minor: 23482 });
  });

  it("customers see only their own payments", async () => {
    const stranger = await createUser(db);
    expect(await asUser(db, stranger, async (tx) => (await tx.query("select * from public.payments")).rows.length)).toBe(0);
  });
});
