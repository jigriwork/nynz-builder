import { NextResponse } from "next/server";
import { createAdmin } from "@/lib/supabase/server";
import { razorpayConfig, verifyWebhookSignature } from "@/lib/billing/razorpay";
import { logServerError } from "@/lib/http/errors";

export const dynamic = "force-dynamic";

/**
 * Razorpay webhook. The signature is verified over the exact raw body before
 * parsing; events are deduplicated by x-razorpay-event-id and applied through
 * idempotent database functions that tolerate out-of-order delivery. Processing
 * errors return 500 so Razorpay retries; a retry is safe.
 */
export async function POST(request: Request) {
  const config = razorpayConfig();
  if (!config) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-razorpay-signature"), config.webhookSecret)) return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  let event: { event: string; created_at: number; payload: Record<string, { entity: Record<string, any> }> };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const eventId = request.headers.get("x-razorpay-event-id") || `${event.event}:${event.created_at}:${event.payload?.payment?.entity?.id || event.payload?.subscription?.entity?.id || "unknown"}`;
  const at = new Date((event.created_at || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const admin = createAdmin();
  try {
    let outcome = "ignored";
    if (event.event.startsWith("subscription.") && event.payload?.subscription?.entity) {
      const { data, error } = await admin.rpc("apply_subscription_event", { p_event_id: eventId, p_event_type: event.event, p_event_created_at: at, p_subscription: event.payload.subscription.entity, p_payment: event.payload.payment?.entity || null });
      if (error) throw error; outcome = data;
    } else if (["payment.captured", "payment.failed", "order.paid"].includes(event.event) && event.payload?.payment?.entity?.notes?.nynz_kind === "topup") {
      const { data, error } = await admin.rpc("apply_topup_payment", { p_event_id: eventId, p_event_type: event.event, p_event_created_at: at, p_payment: event.payload.payment.entity });
      if (error) throw error; outcome = data;
    } else if (event.event === "refund.processed" && event.payload?.refund?.entity) {
      const { data, error } = await admin.rpc("apply_refund_event", { p_event_id: eventId, p_event_created_at: at, p_refund: event.payload.refund.entity });
      if (error) throw error; outcome = data;
    }
    return NextResponse.json({ received: true, outcome });
  } catch (error) {
    const ref = logServerError("razorpay-webhook", error);
    return NextResponse.json({ error: "processing failed", ref }, { status: 500 });
  }
}
