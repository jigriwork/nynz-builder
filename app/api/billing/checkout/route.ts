import { z } from "zod";
import { json, requireUser } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";
import { requirePayments } from "@/lib/billing/session";

/**
 * Creates a Razorpay subscription for the chosen plan and returns what the
 * browser checkout needs. The subscription is stored as "created"; it grants
 * nothing until Razorpay's signed webhook reports it active and charged.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = z.object({ plan: z.enum(["starter", "pro"]) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Choose a plan");
  const limited = await rateLimit(`checkout:${auth.user.id}`, 10, 3600);
  if (limited) return limited;
  const payments = requirePayments();
  if ("error" in payments) return payments.error;
  const admin = createAdmin();
  const { data: open } = await admin.from("subscriptions").select("id,status").eq("user_id", auth.user.id).in("status", ["authenticated", "active", "pending", "paused"]).maybeSingle();
  if (open) return apiError("CONFLICT", "You already have a subscription. Change or cancel it from this page.");
  const { data: plan } = await admin.from("plans").select("id,code,name,provider_plan_id").eq("code", parsed.data.plan).is("retired_at", null).single();
  if (!plan?.provider_plan_id) return apiError("SERVICE_UNAVAILABLE", "This plan is not available for purchase yet. No charge was made.");
  try {
    const subscription = await payments.client.createSubscription({ planId: plan.provider_plan_id, totalCount: 120, notes: { nynz_user: auth.user.id, nynz_plan: plan.code } });
    const { error } = await admin.rpc("create_pending_subscription", { p_user: auth.user.id, p_plan_code: plan.code, p_provider_subscription_id: subscription.id });
    if (error) throw error;
    return json({ keyId: payments.config.keyId, subscriptionId: subscription.id, mode: payments.config.mode, planName: plan.name, email: auth.user.email });
  } catch (error) {
    return apiError("SERVICE_UNAVAILABLE", "Checkout could not be started. No charge was made.", { cause: error, scope: "checkout" });
  }
}
