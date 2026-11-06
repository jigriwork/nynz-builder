/**
 * Checkout readiness without Razorpay credentials: signed Razorpay-shaped
 * webhooks sent over HTTP to the real NYNZ route (through the middleware and
 * its origin check) on a local app and database, with locally generated
 * test-mode secrets. Covers a successful subscription payment (plan and
 * credits once), replays, renewal, cancellation, a failed and a successful
 * top-up, and a bad signature. Razorpay's own API and delivery are not
 * exercised.
 *
 *   npx tsx tests/e2e/checkout/run.ts <supabase-workdir>
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const workdir = process.argv[2];
const local = Object.fromEntries(execFileSync("supabase", ["status", "-o", "env", "--workdir", workdir], { encoding: "utf8" }).split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(local.API_URL)) throw new Error("Refusing to run: Supabase API is not local");
const APP = "http://127.0.0.1:3800";
const WEBHOOK_SECRET = `local-${randomBytes(12).toString("hex")}`;
const RUN = randomBytes(6).toString("hex");
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: local.DB_URL });
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); console.log(results.at(-1)); };
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

async function send(event: string, payload: Record<string, unknown>, opts: { id?: string; secret?: string; createdAt?: Date } = {}) {
  const body = JSON.stringify({ event, created_at: unix(opts.createdAt || new Date()), payload });
  const signature = createHmac("sha256", opts.secret || WEBHOOK_SECRET).update(body).digest("hex");
  const r = await fetch(`${APP}/api/webhooks/razorpay`, { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": signature, "x-razorpay-event-id": opts.id || `evt_${randomUUID().slice(0, 12)}` }, body });
  return { status: r.status, body: await r.json().catch(() => ({})) as { outcome?: unknown } };
}
const balance = async (user: string) => (await db.query("select public.credit_balance($1) b", [user])).rows[0].b as { included: number; purchased: number; available: number };
const ent = async (user: string) => (await db.query("select public.current_entitlements($1) e", [user])).rows[0].e as { plan_code: string; subscription_status: string | null };

async function main() {
  await db.connect();
  const env = { ...process.env, NODE_ENV: "development" as const, NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL: APP, PREVIEW_SIGNING_SECRET: "local-checkout-only-0123456789abcdef0123456789",
    RAZORPAY_KEY_ID: "rzp_test_localonly", RAZORPAY_KEY_SECRET: `local-${randomBytes(12).toString("hex")}`, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET, BILLING_LIVE_ENABLED: "" };
  const app: ChildProcess = spawn("npx", ["next", "dev", "-p", "3800", "-H", "127.0.0.1"], { env, stdio: "ignore", detached: true });
  try {
    for (let i = 0; i < 180; i += 1) { if ((await fetch(`${APP}/login`).catch(() => null))?.ok) break; await new Promise((r) => setTimeout(r, 1000)); }
    // A customer who started checkout for Starter (what /api/billing/checkout records after Razorpay creates the subscription).
    const { data: u } = await admin.auth.admin.createUser({ email: `checkout-${Date.now()}@example.com`, password: `Pw-${randomUUID()}`, email_confirm: true });
    const user = u.user!.id;
    const subId = `sub_${randomBytes(7).toString("hex")}`;
    await db.query("update public.plans set provider_plan_id='plan_LOCALSTARTER01' where code='starter' and retired_at is null");
    await db.query("select public.create_pending_subscription($1,'starter',$2)", [user, subId]);
    check("starting checkout alone grants nothing", (await ent(user)).plan_code === "free" && (await balance(user)).included === 0);

    const start = new Date(), end = new Date(Date.now() + 30 * 86400_000);
    const subscription = (status = "active", s = start, e = end) => ({ entity: { id: subId, status, plan_id: "plan_LOCALSTARTER01", current_start: unix(s), current_end: unix(e) } });
    const payment = (id: string, amount = 117882) => ({ entity: { id, amount, status: "captured", method: "upi", created_at: unix(new Date()) } });
    const badPayment = `pay_bad_${RUN}`;
    const firstPayment = `pay_ok1_${RUN}`;
    const renewalPayment = `pay_ok2_${RUN}`;
    const bad = await send("subscription.charged", { subscription: subscription(), payment: payment(badPayment) }, { secret: "wrong-secret" });
    check("a webhook with a bad signature is refused and changes nothing", bad.status === 400 && (await balance(user)).included === 0);
    const charged = await send("subscription.charged", { subscription: subscription(), payment: payment(firstPayment) }, { id: `evt_charged_1_${RUN}` });
    const after = await balance(user);
    check("a successful payment gives the Starter plan and its 400 credits", charged.status === 200 && (await ent(user)).plan_code === "starter" && after.included === 400, `${charged.status} ${JSON.stringify(charged.body.outcome)}; included ${after.included}`);
    const replay = await send("subscription.charged", { subscription: subscription(), payment: payment(firstPayment) }, { id: `evt_charged_1_${RUN}` });
    const replay2 = await send("subscription.charged", { subscription: subscription(), payment: payment(firstPayment) }, { id: `evt_charged_1_redelivered_${RUN}` });
    check("replaying the webhook (same event id, or a new id for the same payment) adds nothing", replay.status === 200 && replay2.status === 200 && (await balance(user)).included === 400, `${JSON.stringify(replay.body.outcome)}, ${JSON.stringify(replay2.body.outcome)}`);
    const { rows: [paid] } = await db.query("select amount_minor,tax_minor,net_minor from public.payments where provider_payment_id=$1", [firstPayment]);
    check("the payment is recorded once with GST separated", Number(paid?.amount_minor) === 117882 && Number(paid?.tax_minor) === 17982 && Number(paid?.net_minor) === 99900);

    // Renewal and cancellation.
    const next = new Date(end.getTime() + 30 * 86400_000);
    await send("subscription.charged", { subscription: subscription("active", end, next), payment: payment(renewalPayment) }, { createdAt: new Date(Date.now() + 1000) });
    const grants = Number((await db.query("select count(*) n from public.credit_grants where user_id=$1 and source='plan_included'", [user])).rows[0].n);
    check("a renewal for the next period grants that period's credits once", grants === 2);
    const cancel = await send("subscription.cancelled", { subscription: subscription("cancelled", end, next) }, { createdAt: new Date(Date.now() + 2000) });
    const e = await ent(user);
    check("cancellation is recorded; access continues to the end of the paid period", cancel.status === 200 && e.subscription_status === "cancelled" && e.plan_code === "starter", JSON.stringify(e));

    // Top-ups: a failed payment gives nothing; a captured one gives credits once.
    await db.query("update public.topup_packs set active=true where code='credits_100'");
    const order = `order_${randomBytes(7).toString("hex")}`;
    await db.query("select public.create_topup_order($1,'credits_100',$2)", [user, order]);
    const topup = (id: string, status: string) => ({ payment: { entity: { id, order_id: order, amount: 23482, status, notes: { nynz_kind: "topup", nynz_user: user, nynz_pack: "credits_100" } } } });
    const failedPayment = `pay_fail1_${RUN}`;
    const topupPayment = `pay_top1_${RUN}`;
    const failed = await send("payment.failed", topup(failedPayment, "failed"));
    check("a failed top-up payment gives no credits", failed.status === 200 && (await balance(user)).purchased === 0, JSON.stringify(failed.body.outcome));
    await send("payment.captured", topup(topupPayment, "captured"), { id: `evt_top_1_${RUN}` });
    await send("payment.captured", topup(topupPayment, "captured"), { id: `evt_top_1_${RUN}` });
    await send("order.paid", topup(topupPayment, "captured"));
    check("a captured top-up gives its 100 credits once, despite replays", (await balance(user)).purchased === 100, `purchased ${(await balance(user)).purchased}`);
  } finally {
    try { if (app.pid) process.kill(-app.pid, "SIGKILL"); } catch { /* gone */ }
    await db.end();
  }
  const failedCount = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failedCount}/${results.length} checks passed`);
  process.exit(failedCount ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
