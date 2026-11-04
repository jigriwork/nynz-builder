import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay integration (https://razorpay.com/docs, checked 2026-11-04):
 *  - Webhooks: X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret);
 *    the raw body must be verified before parsing. x-razorpay-event-id is
 *    unique per event and is used for deduplication. Delivery order is not
 *    guaranteed.
 *  - Subscription checkout: razorpay_signature = HMAC-SHA256(
 *    `${razorpay_payment_id}|${subscription_id}`, key secret), where
 *    subscription_id is the id stored on our server.
 *  - Order checkout (top-ups): HMAC-SHA256(`${order_id}|${razorpay_payment_id}`, key secret).
 * A verified checkout signature only proves the browser saw a payment; the
 * subscription becomes active solely from webhooks (or server reconciliation).
 */
export type RazorpayConfig = { keyId: string; keySecret: string; webhookSecret: string; mode: "test" | "live" };

export function razorpayConfig(env: Record<string, string | undefined> = process.env): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId || !keySecret || !webhookSecret) return null;
  const mode = keyId.startsWith("rzp_live_") ? "live" : "test";
  // Live keys are refused unless live billing is explicitly enabled after merchant/tax readiness.
  if (mode === "live" && env.BILLING_LIVE_ENABLED !== "true") return null;
  return { keyId, keySecret, webhookSecret, mode };
}

function safeEqualHex(expected: string, supplied: string) {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(supplied || ""), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const hmac = (secret: string, message: string | Buffer) => createHmac("sha256", secret).update(message).digest("hex");

export function verifyWebhookSignature(rawBody: string | Buffer, signature: string | null, secret: string) {
  if (!signature || !secret) return false;
  return safeEqualHex(hmac(secret, rawBody), signature);
}

export function verifySubscriptionCheckout(input: { paymentId: string; storedSubscriptionId: string; signature: string }, keySecret: string) {
  return safeEqualHex(hmac(keySecret, `${input.paymentId}|${input.storedSubscriptionId}`), input.signature);
}

export function verifyOrderCheckout(input: { storedOrderId: string; paymentId: string; signature: string }, keySecret: string) {
  return safeEqualHex(hmac(keySecret, `${input.storedOrderId}|${input.paymentId}`), input.signature);
}

export class RazorpayClient {
  constructor(private readonly config: RazorpayConfig, private readonly fetcher: typeof fetch = fetch) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(`https://api.razorpay.com/v1${path}`, {
      method, signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Basic ${Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString("base64")}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      let code = "";
      try { code = JSON.parse(text)?.error?.code || ""; } catch { /* ignore */ }
      throw new Error(`Razorpay ${method} ${path.split("?")[0]} failed (${response.status}${code ? ` ${code}` : ""})`);
    }
    return JSON.parse(text) as T;
  }

  createPlan(input: { name: string; amountMinor: number; description?: string }) {
    return this.call<{ id: string }>("POST", "/plans", { period: "monthly", interval: 1, item: { name: input.name, amount: input.amountMinor, currency: "INR", description: input.description } });
  }
  createSubscription(input: { planId: string; totalCount: number; notes: Record<string, string> }) {
    return this.call<{ id: string; status: string; short_url?: string }>("POST", "/subscriptions", { plan_id: input.planId, total_count: input.totalCount, customer_notify: 1, notes: input.notes });
  }
  fetchSubscription(id: string) {
    return this.call<Record<string, unknown> & { id: string; status: string; plan_id: string; current_start: number | null; current_end: number | null }>("GET", `/subscriptions/${encodeURIComponent(id)}`);
  }
  cancelSubscription(id: string, atCycleEnd: boolean) {
    return this.call<{ id: string; status: string }>("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
  }
  changePlan(id: string, planId: string) {
    return this.call<{ id: string }>("PATCH", `/subscriptions/${encodeURIComponent(id)}`, { plan_id: planId, schedule_change_at: "cycle_end", customer_notify: 1 });
  }
  createOrder(input: { amountMinor: number; receipt: string; notes: Record<string, string> }) {
    return this.call<{ id: string; amount: number; currency: string }>("POST", "/orders", { amount: input.amountMinor, currency: "INR", receipt: input.receipt, notes: input.notes });
  }
  refund(paymentId: string, amountMinor: number, notes: Record<string, string>) {
    return this.call<{ id: string; status: string }>("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountMinor, notes });
  }
  listPayments(fromUnix: number, count = 100, skip = 0) {
    return this.call<{ items: Array<{ id: string; amount: number; status: string; order_id: string | null; invoice_id: string | null; created_at: number }> }>("GET", `/payments?from=${fromUnix}&count=${count}&skip=${skip}`);
  }
}

/** Gross amount charged for a tax-exclusive price. */
export function grossWithTax(priceMinor: number, taxRateBps: number) {
  return priceMinor + Math.round((priceMinor * taxRateBps) / 10_000);
}
