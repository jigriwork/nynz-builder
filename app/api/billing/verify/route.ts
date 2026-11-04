import { z } from "zod";
import { json, requireUser } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/http/errors";
import { requirePayments } from "@/lib/billing/session";
import { verifyOrderCheckout, verifySubscriptionCheckout } from "@/lib/billing/razorpay";

/**
 * Checks the browser checkout signature against the ids stored on our server.
 * This only records that the customer completed checkout; plan access and
 * credits are granted solely by verified webhooks.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = z.union([
    z.object({ kind: z.literal("subscription"), razorpay_payment_id: z.string().max(64), razorpay_subscription_id: z.string().max(64), razorpay_signature: z.string().max(128) }),
    z.object({ kind: z.literal("topup"), razorpay_payment_id: z.string().max(64), razorpay_order_id: z.string().max(64), razorpay_signature: z.string().max(128) }),
  ]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Invalid payment confirmation");
  const payments = requirePayments();
  if ("error" in payments) return payments.error;
  const admin = createAdmin();
  const input = parsed.data;
  if (input.kind === "subscription") {
    const { data: sub } = await admin.from("subscriptions").select("id,provider_subscription_id").eq("user_id", auth.user.id).eq("provider_subscription_id", input.razorpay_subscription_id).maybeSingle();
    if (!sub || !verifySubscriptionCheckout({ paymentId: input.razorpay_payment_id, storedSubscriptionId: sub.provider_subscription_id, signature: input.razorpay_signature }, payments.config.keySecret)) return apiError("FORBIDDEN", "This payment confirmation could not be verified.");
    await admin.from("subscriptions").update({ checkout_verified_at: new Date().toISOString() }).eq("id", sub.id);
  } else {
    const { data: order } = await admin.from("topup_orders").select("provider_order_id").eq("user_id", auth.user.id).eq("provider_order_id", input.razorpay_order_id).maybeSingle();
    if (!order || !verifyOrderCheckout({ storedOrderId: order.provider_order_id, paymentId: input.razorpay_payment_id, signature: input.razorpay_signature }, payments.config.keySecret)) return apiError("FORBIDDEN", "This payment confirmation could not be verified.");
  }
  return json({ received: true, message: "Payment received. Your plan or credits will appear as soon as Razorpay confirms it, usually within a minute." });
}
