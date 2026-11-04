import { randomUUID } from "node:crypto";
import { createClient as createPlainClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { razorpayConfig, RazorpayClient, grossWithTax } from "@/lib/billing/razorpay";
import { fetchProviderBalances } from "@/lib/admin/providers";
import { canSendEmail, appOrigin } from "@/lib/platform/email";

export type ActionContext = { supabase: SupabaseClient; admin: SupabaseClient; userId: string };
type Action<S extends z.ZodTypeAny> = { capability: string; schema: S; run: (ctx: ActionContext, input: z.infer<S>) => Promise<unknown> };
const define = <S extends z.ZodTypeAny>(action: Action<S>) => action;

const reason = z.string().trim().min(3).max(1000);
const uuid = z.string().uuid();
const role = z.enum(["owner", "operations", "support", "billing", "readonly"]);
const caps = z.array(z.string().regex(/^[a-z_.]+$/)).max(30).default([]);

/** Throws the database error so the route can map its stable code. */
async function rpc<T = unknown>(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

async function emailFor(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) throw Object.assign(new Error("NOT_FOUND"), { message: "NOT_FOUND" });
  return data.user.email;
}

/** Sends a Supabase invitation (account activation) email unless delivery is disabled for this address. */
async function sendInvite(admin: SupabaseClient, email: string, next: string) {
  if (!canSendEmail(email)) return "in_app_only" as const;
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${appOrigin()}/auth/callback?next=${encodeURIComponent(next)}` });
  return error ? "email_failed" as const : "email_sent" as const;
}

export const ACTIONS = {
  "team.invite": define({
    capability: "team.manage",
    schema: z.object({ email: z.string().trim().toLowerCase().email().max(254), name: z.string().trim().max(120).default(""), role, capabilities: caps, reason }),
    async run(ctx, input) {
      const created = await rpc<{ invitation_id: string; existing_user_id: string | null }>(ctx.supabase, "admin_invite_staff", { p_email: input.email, p_name: input.name, p_role: input.role, p_caps: input.capabilities, p_reason: input.reason });
      // Existing accounts accept inside NYNZ (no duplicate account). New
      // addresses receive an activation email that proves ownership.
      const delivery = created.existing_user_id ? "in_app_only" : await sendInvite(ctx.admin, input.email, "/account/set-password?then=/account/invitations");
      await rpc(ctx.supabase, "admin_record_invitation_delivery", { p_invitation: created.invitation_id, p_delivery: delivery });
      return { invitationId: created.invitation_id, existingUser: Boolean(created.existing_user_id), delivery };
    },
  }),
  "team.resend": define({
    capability: "team.manage", schema: z.object({ invitationId: uuid, reason }),
    async run(ctx, input) {
      await rpc(ctx.supabase, "admin_resend_staff_invitation", { p_invitation: input.invitationId, p_reason: input.reason });
      const { data: inv } = await ctx.admin.from("staff_invitations").select("email").eq("id", input.invitationId).single();
      const { data: existing } = await ctx.admin.rpc("user_id_for_email", { p_email: inv?.email || "" });
      const delivery = existing ? "in_app_only" : await sendInvite(ctx.admin, inv!.email, "/account/set-password?then=/account/invitations");
      await rpc(ctx.supabase, "admin_record_invitation_delivery", { p_invitation: input.invitationId, p_delivery: delivery });
      return { delivery };
    },
  }),
  "team.revoke": define({ capability: "team.manage", schema: z.object({ invitationId: uuid, reason }), run: (ctx, i) => rpc(ctx.supabase, "admin_revoke_staff_invitation", { p_invitation: i.invitationId, p_reason: i.reason }) }),
  "team.update": define({
    capability: "team.manage",
    schema: z.object({ userId: uuid, role, extra: caps, revoked: caps, requireMfa: z.boolean().nullable().default(null), expectedVersion: z.number().int().positive(), reason }),
    run: (ctx, i) => rpc(ctx.supabase, "admin_update_staff", { p_user: i.userId, p_role: i.role, p_extra: i.extra, p_revoked: i.revoked, p_require_mfa: i.requireMfa, p_expected_version: i.expectedVersion, p_reason: i.reason }),
  }),
  "team.status": define({ capability: "team.manage", schema: z.object({ userId: uuid, status: z.enum(["active", "suspended", "removed"]), reason }), run: (ctx, i) => rpc(ctx.supabase, "admin_set_staff_status", { p_user: i.userId, p_status: i.status, p_reason: i.reason }) }),
  "team.step_down": define({ capability: "owner.manage", schema: z.object({ newRole: role.exclude(["owner"]), reason }), run: (ctx, i) => rpc(ctx.supabase, "admin_step_down_owner", { p_new_role: i.newRole, p_reason: i.reason }) }),

  "user.status": define({
    capability: "users.suspend", schema: z.object({ userId: uuid, status: z.enum(["active", "suspended"]), reason }),
    async run(ctx, i) {
      await rpc(ctx.supabase, "admin_set_account_status", { p_user: i.userId, p_status: i.status, p_reason: i.reason });
      // Also block or restore sign-in at the auth server; database checks already apply.
      await ctx.admin.auth.admin.updateUserById(i.userId, { ban_duration: i.status === "suspended" ? "876000h" : "none" });
      if (i.status === "suspended") await rpc(ctx.supabase, "admin_revoke_user_sessions", { p_user: i.userId, p_reason: `Suspended: ${i.reason}` }).catch(() => undefined);
      return { status: i.status };
    },
  }),
  "user.revoke_sessions": define({ capability: "users.revoke_sessions", schema: z.object({ userId: uuid, reason }), run: async (ctx, i) => ({ revoked: await rpc(ctx.supabase, "admin_revoke_user_sessions", { p_user: i.userId, p_reason: i.reason }) }) }),
  "user.password_reset": define({
    capability: "users.reset_password", schema: z.object({ userId: uuid, reason }),
    async run(ctx, i) {
      const email = await emailFor(ctx.admin, i.userId);
      const request = await rpc<number>(ctx.supabase, "admin_log_action", { p_cap: "users.reset_password", p_action: "account.password_reset_sent", p_target_type: "user", p_target_id: i.userId, p_reason: i.reason, p_metadata: {}, p_recent_seconds: 900 });
      let ok = false;
      if (canSendEmail(email)) {
        const anon = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
        ok = !(await anon.auth.resetPasswordForEmail(email, { redirectTo: `${appOrigin()}/auth/callback?next=/reset-password` })).error;
      }
      await rpc(ctx.supabase, "admin_log_action_result", { p_request: request, p_succeeded: ok, p_metadata: { delivery: canSendEmail(email) ? (ok ? "email_sent" : "email_failed") : "suppressed_test_address" } });
      return { sent: ok };
    },
  }),
  "user.invite": define({
    capability: "users.invite", schema: z.object({ email: z.string().trim().toLowerCase().email().max(254), reason }),
    async run(ctx, i) {
      const request = await rpc<number>(ctx.supabase, "admin_log_action", { p_cap: "users.invite", p_action: "account.invited", p_target_type: "email_domain", p_target_id: i.email.split("@")[1], p_reason: i.reason, p_metadata: {}, p_recent_seconds: null });
      const delivery = await sendInvite(ctx.admin, i.email, "/account/set-password?then=/dashboard");
      await rpc(ctx.supabase, "admin_log_action_result", { p_request: request, p_succeeded: delivery !== "email_failed", p_metadata: { delivery } });
      return { delivery };
    },
  }),

  "credits.grant": define({
    capability: "credits.grant",
    schema: z.object({ userId: uuid, amount: z.number().int().positive().max(1_000_000), source: z.enum(["promotional", "adjustment", "owner_testing", "refund_restore"]), expiresAt: z.string().datetime().nullable().default(null), reason, idempotencyKey: z.string().min(8).max(100) }),
    run: (ctx, i) => rpc(ctx.supabase, "admin_grant_credits", { p_user: i.userId, p_amount: i.amount, p_source: i.source, p_expires_at: i.expiresAt, p_reason: i.reason, p_idempotency: i.idempotencyKey }),
  }),
  "credits.debit": define({
    capability: "credits.adjust_large", schema: z.object({ userId: uuid, amount: z.number().int().positive().max(1_000_000), reason, idempotencyKey: z.string().min(8).max(100) }),
    run: (ctx, i) => rpc(ctx.supabase, "admin_debit_credits", { p_user: i.userId, p_amount: i.amount, p_reason: i.reason, p_idempotency: i.idempotencyKey }),
  }),

  "build.action": define({ capability: "builds.operate", schema: z.object({ buildId: uuid, action: z.enum(["cancel", "recover", "restart_preview"]), reason }), run: (ctx, i) => rpc(ctx.supabase, "admin_build_action", { p_build: i.buildId, p_action: i.action, p_reason: i.reason }) }),
  "project.open_content": define({
    capability: "projects.read_content", schema: z.object({ projectId: uuid, reason }),
    async run(ctx, i) {
      // The audit record is written first; content is returned only if it succeeds.
      await rpc(ctx.supabase, "admin_open_project_content", { p_project: i.projectId, p_reason: i.reason });
      const { data } = await ctx.admin.from("project_files").select("path,content").eq("project_id", i.projectId).order("path").limit(200);
      return { files: data || [] };
    },
  }),

  "spend_limit.save": define({
    capability: "providers.manage",
    schema: z.object({ id: uuid.nullable().default(null), name: z.string().trim().min(2).max(120), provider: z.string().max(40).default(""), period: z.enum(["day", "month", "window"]), limitRupees: z.number().positive().max(10_000_000), warnAtPercent: z.number().int().min(1).max(100).default(80), active: z.boolean().default(true), windowStart: z.string().datetime().nullable().default(null), windowEnd: z.string().datetime().nullable().default(null), reason }),
    run: (ctx, i) => rpc(ctx.supabase, "admin_set_spend_limit", { p_id: i.id, p_name: i.name, p_provider: i.provider, p_period: i.period, p_limit_paise: Math.round(i.limitRupees * 100), p_warn: i.warnAtPercent, p_active: i.active, p_window_start: i.windowStart, p_window_end: i.windowEnd, p_reason: i.reason }),
  }),
  "expense.record": define({
    capability: "expenses.manage",
    schema: z.object({ category: z.enum(["provider", "hosting", "database", "domain", "email", "monitoring", "payments", "support", "tax", "other"]), vendor: z.string().trim().min(2).max(120), description: z.string().max(500).default(""), amountRupees: z.number().nonnegative().max(100_000_000), taxRupees: z.number().nonnegative().default(0), incurredOn: z.string().date(), periodStart: z.string().date().nullable().default(null), periodEnd: z.string().date().nullable().default(null), reason }),
    run: (ctx, i) => rpc(ctx.supabase, "admin_record_expense", { p_category: i.category, p_vendor: i.vendor, p_description: i.description, p_amount: Math.round(i.amountRupees * 100), p_tax: Math.round(i.taxRupees * 100), p_incurred_on: i.incurredOn, p_period_start: i.periodStart, p_period_end: i.periodEnd, p_reason: i.reason }),
  }),
  "provider_balance.record": define({
    capability: "expenses.manage", schema: z.object({ provider: z.string().trim().min(2).max(40), balance: z.number(), currency: z.string().length(3), asOf: z.string().datetime(), note: z.string().max(500).default("Entered from provider dashboard") }),
    run: (ctx, i) => rpc(ctx.supabase, "admin_record_provider_balance", { p_provider: i.provider, p_balance: i.balance, p_currency: i.currency, p_as_of: i.asOf, p_note: i.note }),
  }),
  "providers.refresh": define({
    capability: "providers.read", schema: z.object({}),
    async run(ctx) {
      const results = await fetchProviderBalances();
      const rows = results.filter((r) => r.status === "ok").map((r) => ({ provider: r.provider, balance_amount: r.balance ?? null, balance_currency: r.currency ?? null, usage_amount: r.usage ?? null, quota: r.quota ?? null, source: "api", note: r.note }));
      if (rows.length) await ctx.admin.from("provider_balance_snapshots").insert(rows);
      return { results };
    },
  }),

  "plan.save": define({
    capability: "plans.manage",
    schema: z.object({ code: z.string().regex(/^[a-z0-9_]{2,40}$/), name: z.string().trim().min(2).max(60), description: z.string().max(300).default(""), priceRupees: z.number().nonnegative().max(1_000_000), taxRateBps: z.number().int().min(0).max(5000), monthlyCredits: z.number().int().nonnegative().max(10_000_000), maxConcurrent: z.number().int().min(1).max(20), maxProjects: z.number().int().min(1).max(1000), features: z.array(z.string().max(120)).max(12), public: z.boolean().default(true), reason }),
    run: (ctx, i) => rpc(ctx.supabase, "admin_save_plan", { p_code: i.code, p_name: i.name, p_description: i.description, p_price_minor: Math.round(i.priceRupees * 100), p_tax_rate_bps: i.taxRateBps, p_monthly_credits: i.monthlyCredits, p_max_concurrent: i.maxConcurrent, p_max_projects: i.maxProjects, p_features: i.features, p_public: i.public, p_reason: i.reason }),
  }),
  "plan.link_razorpay": define({
    capability: "plans.manage", schema: z.object({ planId: uuid, reason }),
    async run(ctx, i) {
      const config = razorpayConfig();
      if (!config) throw new Error("SERVICE_UNAVAILABLE_PAYMENTS");
      const { data: plan } = await ctx.admin.from("plans").select("*").eq("id", i.planId).is("retired_at", null).single();
      if (!plan || plan.price_minor <= 0) throw new Error("INVALID_STATE");
      const created = await new RazorpayClient(config).createPlan({ name: `NYNZ ${plan.name} v${plan.version}`, amountMinor: grossWithTax(Number(plan.price_minor), plan.tax_rate_bps), description: plan.description || undefined });
      await rpc(ctx.supabase, "admin_set_plan_provider_id", { p_plan: plan.id, p_provider_plan_id: created.id, p_reason: i.reason });
      return { providerPlanId: created.id, mode: config.mode };
    },
  }),
  "topup.save": define({
    capability: "plans.manage", schema: z.object({ code: z.string().regex(/^[a-z0-9_]{2,40}$/), name: z.string().trim().min(2).max(60), credits: z.number().int().positive(), priceRupees: z.number().positive(), active: z.boolean(), reason }),
    run: (ctx, i) => rpc(ctx.supabase, "admin_set_topup_pack", { p_code: i.code, p_name: i.name, p_credits: i.credits, p_price_minor: Math.round(i.priceRupees * 100), p_active: i.active, p_reason: i.reason }),
  }),
  "refund.request": define({
    capability: "billing.refund", schema: z.object({ paymentId: uuid, amountRupees: z.number().positive(), reverseCredits: z.boolean().default(false), reason }),
    async run(ctx, i) {
      const config = razorpayConfig();
      if (!config) throw new Error("SERVICE_UNAVAILABLE_PAYMENTS");
      const refundId = await rpc<string>(ctx.supabase, "admin_request_refund", { p_payment: i.paymentId, p_amount: Math.round(i.amountRupees * 100), p_reason: i.reason, p_reverse_credits: i.reverseCredits });
      const { data: payment } = await ctx.admin.from("payments").select("provider_payment_id").eq("id", i.paymentId).single();
      try {
        const refund = await new RazorpayClient(config).refund(payment!.provider_payment_id, Math.round(i.amountRupees * 100), { nynz_refund_id: refundId });
        await rpc(ctx.admin, "record_refund_submission", { p_refund: refundId, p_provider_refund_id: refund.id, p_ok: true, p_error: null });
        return { refundId, providerRefundId: refund.id, status: "submitted" };
      } catch (error) {
        await rpc(ctx.admin, "record_refund_submission", { p_refund: refundId, p_provider_refund_id: null, p_ok: false, p_error: error instanceof Error ? error.message : "refund failed" });
        throw error;
      }
    },
  }),
  "billing.reconcile": define({
    capability: "billing.read", schema: z.object({}),
    async run(ctx) {
      const config = razorpayConfig();
      if (!config) throw new Error("SERVICE_UNAVAILABLE_PAYMENTS");
      const client = new RazorpayClient(config);
      const { data: subs } = await ctx.admin.from("subscriptions").select("id,provider_subscription_id,status").in("status", ["created", "authenticated", "active", "pending", "paused", "halted"]).not("provider_subscription_id", "is", null).limit(500);
      const report: Array<{ id: string; local: string; provider: string; applied: string }> = [];
      for (const sub of subs || []) {
        const remote = await client.fetchSubscription(sub.provider_subscription_id);
        if (remote.status === sub.status) continue;
        // Server-to-server state is authoritative; it is applied through the same idempotent path as webhooks.
        const applied = await rpc<string>(ctx.admin, "apply_subscription_event", { p_event_id: `reconcile:${sub.id}:${remote.status}:${remote.current_end || 0}`, p_event_type: `subscription.${remote.status === "active" ? "activated" : remote.status}`, p_event_created_at: new Date().toISOString(), p_subscription: remote, p_payment: null });
        report.push({ id: sub.id, local: sub.status, provider: remote.status, applied });
      }
      const since = Math.floor(Date.now() / 1000) - 30 * 86400;
      const { items } = await client.listPayments(since);
      const ids = items.map((p) => p.id);
      const { data: known } = ids.length ? await ctx.admin.from("payments").select("provider_payment_id,status,amount_minor").in("provider_payment_id", ids) : { data: [] };
      const knownMap = new Map((known || []).map((p) => [p.provider_payment_id, p]));
      const paymentIssues = items.filter((p) => p.status === "captured").flatMap((p) => {
        const local = knownMap.get(p.id);
        if (!local) return [{ payment: p.id, issue: "missing locally (webhook not received or unrelated)" }];
        if (Number(local.amount_minor) !== p.amount) return [{ payment: p.id, issue: "amount differs" }];
        return [];
      });
      return { mode: config.mode, subscriptionsChecked: subs?.length || 0, subscriptionChanges: report, providerPaymentsChecked: items.length, paymentIssues };
    },
  }),
  "maintenance.run": define({ capability: "operations.cleanup", schema: z.object({ reason }), run: async (ctx, i) => ({ requestId: await rpc(ctx.supabase, "admin_request_maintenance", { p_kind: "reconcile", p_reason: i.reason }) }) }),
} as const;

export type ActionName = keyof typeof ACTIONS;
export const newIdempotencyKey = () => randomUUID();
