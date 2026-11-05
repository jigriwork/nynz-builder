import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError, dbError } from "@/lib/http/errors";
import { prepareProjectPreview } from "@/lib/preview/registration";
import { razorpayConfig } from "@/lib/billing/razorpay";
import { trialPausedMessage, trialReopensAt } from "@/lib/billing/trial";

export type Entitlements = { plan_code: string; plan_name: string; subscription_status: string | null; max_concurrent_builds: number; max_projects: number; features: string[]; current_period_end?: string | null; cancel_at_period_end?: boolean; grace_until?: string | null };

export async function entitlementsFor(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.rpc("current_entitlements", { p_user: userId });
  if (error) throw error;
  return data as Entitlements;
}

/**
 * New accounts receive a one-time, expiring trial grant (TRIAL_CREDITS,
 * default 60; TRIAL_DAYS, default 7; 0 credits disables it), enough for one
 * useful app and its first preview. It is an explicit, labelled trial grant,
 * never a conversion of historical usage. Spending by trial-only accounts also
 * counts against a separate daily trial limit (spend_limits scope "trial").
 */
export async function ensureTrialCredits(admin: SupabaseClient, userId: string) {
  const amount = Number(process.env.TRIAL_CREDITS ?? 60);
  const days = Number(process.env.TRIAL_DAYS ?? 7);
  if (!Number.isInteger(amount) || amount <= 0) return;
  // Owners use an explicit, audited testing allowance; a first build must not
  // silently add customer trial credits outside that allowance.
  const { data: staff, error } = await admin.from("staff_members").select("role").eq("user_id",userId).maybeSingle();
  if(error)throw error;
  if(staff?.role==="owner")return;
  await admin.rpc("grant_credits", {
    p_user: userId, p_source: "trial", p_amount: amount, p_expires_at: new Date(Date.now() + (Number.isFinite(days) && days > 0 ? days : 7) * 86400_000).toISOString(),
    p_reason: "Welcome trial credits", p_actor: null, p_idempotency: `trial:${userId}`,
  });
}

/** Initial holds; each provider call later extends the hold to its own worst case. */
export const RESERVE = {
  plan: () => Number(process.env.RESERVE_PLAN_CREDITS || 5),
  generate: () => Number(process.env.RESERVE_GENERATE_CREDITS || 20),
  restart: () => Number(process.env.RESERVE_RESTART_CREDITS || 3),
};

/**
 * Admission for paid work, in order: a ready worker exists (so a request is
 * never accepted that cannot run), then credits are reserved atomically with
 * the plan's concurrency limit. Returns an error response or null.
 */
export async function admitPaidWork(admin: SupabaseClient, input: { userId: string; projectId: string; buildId: string; credits: number }) {
  const { data: ready, error: readyError } = await admin.rpc("generation_ready", { p_max_age_seconds: 90 });
  if (readyError) return apiError("SERVICE_UNAVAILABLE", "Building is temporarily unavailable.", { cause: readyError, scope: "admission" });
  if (!ready) return apiError("SERVICE_UNAVAILABLE", "Building is temporarily unavailable. Please try again in a few minutes. You have not been charged.");
  try { await prepareProjectPreview(admin, input.projectId, input.userId); }
  catch (error) { return apiError("SERVICE_UNAVAILABLE", "Your secure preview is being prepared. Please try again shortly. You have not been charged.", { cause: error, scope: "preview-registration" }); }
  const entitlements = await entitlementsFor(admin, input.userId);
  await ensureTrialCredits(admin, input.userId);
  // Tell trial customers before any work starts when today's trial allowance is used up.
  const { data: open, error: trialError } = await admin.rpc("trial_budget_open", { p_user: input.userId });
  if (trialError) return apiError("SERVICE_UNAVAILABLE", "Building is temporarily unavailable.", { cause: trialError, scope: "admission" });
  if (open === false) return apiError("TRIAL_BUDGET", trialPausedMessage(), { extra: { retry_at: trialReopensAt().toISOString(), checkout_available: Boolean(razorpayConfig()) } });
  const { error } = await admin.rpc("reserve_credits", { p_user: input.userId, p_project: input.projectId, p_build: input.buildId, p_amount: input.credits, p_max_concurrent: entitlements.max_concurrent_builds });
  if (error) return dbError(error, "admission");
  return null;
}
