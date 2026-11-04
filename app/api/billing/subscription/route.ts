import { z } from "zod";
import { json, requireUser } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/http/errors";
import { requirePayments } from "@/lib/billing/session";

/**
 * Cancel at the end of the paid period, or schedule a plan change for the next
 * billing cycle. Entitlements change only when Razorpay reports the change.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = z.discriminatedUnion("action", [z.object({ action: z.literal("cancel") }), z.object({ action: z.literal("change"), plan: z.enum(["starter", "pro"]) })]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Invalid request");
  const payments = requirePayments();
  if ("error" in payments) return payments.error;
  const admin = createAdmin();
  const { data: sub } = await admin.from("subscriptions").select("id,provider_subscription_id,plan_id,status").eq("user_id", auth.user.id).in("status", ["authenticated", "active", "pending"]).maybeSingle();
  if (!sub?.provider_subscription_id) return apiError("NOT_FOUND", "No active subscription");
  try {
    if (parsed.data.action === "cancel") {
      await payments.client.cancelSubscription(sub.provider_subscription_id, true);
      await admin.from("subscriptions").update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq("id", sub.id);
      return json({ ok: true, message: "Your subscription will end at the close of the current billing period. Your plan stays active until then." });
    }
    const { data: plan } = await admin.from("plans").select("id,provider_plan_id").eq("code", parsed.data.plan).is("retired_at", null).single();
    if (!plan?.provider_plan_id || plan.id === sub.plan_id) return apiError("INVALID_INPUT", "Choose a different available plan");
    await payments.client.changePlan(sub.provider_subscription_id, plan.provider_plan_id);
    await admin.from("subscriptions").update({ scheduled_plan_id: plan.id, updated_at: new Date().toISOString() }).eq("id", sub.id);
    return json({ ok: true, message: "Your plan will change at the start of your next billing cycle." });
  } catch (error) {
    return apiError("SERVICE_UNAVAILABLE", "The change could not be made right now. Nothing was changed.", { cause: error, scope: "subscription" });
  }
}
