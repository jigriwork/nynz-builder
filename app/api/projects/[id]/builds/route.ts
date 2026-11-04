import { randomUUID } from "node:crypto";
import { z } from "zod";
import { json, requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";
import { RESERVE, admitPaidWork } from "@/lib/billing/entitlements";

const ACTIVE = ["queued", "planning", "generating", "installing", "running", "validating"];

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.supabase.from("build_jobs").select("id,status,prompt,mode,progress,plan,error_code,error_message,created_at,finished_at,cancel_requested_at").eq("project_id", id).order("created_at", { ascending: false }).limit(20);
  if (error) return apiError("INTERNAL", "Could not load builds", { cause: error, scope: "builds" });
  return json({ builds: data || [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const parsed = z.object({ prompt: z.string().trim().min(1).max(30000), mode: z.enum(["create", "edit"]).default("create"), idempotencyKey: z.string().min(8).max(200) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Invalid build request");
  const limited = await rateLimit(`build:${auth.user.id}`, Number(process.env.BUILD_RATE_PER_HOUR || 30), 3600);
  if (limited) return limited;
  const admin = createAdmin();
  const { data: existing } = await admin.from("build_jobs").select("*").eq("requested_by", auth.user.id).eq("idempotency_key", parsed.data.idempotencyKey).maybeSingle();
  if (existing) return json({ build: existing }, { status: existing.project_id === id ? 202 : 409 });
  const { data: active } = await admin.from("build_jobs").select("id").eq("project_id", id).in("status", ACTIVE).limit(1).maybeSingle();
  if (active) return apiError("CONFLICT", "A plan or build is already active", { extra: { buildId: active.id } });

  const buildId = randomUUID();
  const refused = await admitPaidWork(admin, { userId: auth.user.id, projectId: id, buildId, credits: RESERVE.plan() });
  if (refused) return refused;
  const { data: conversation } = await auth.supabase.from("conversations").select("id").eq("project_id", id).order("created_at").limit(1).maybeSingle();
  const { data, error } = await admin.from("build_jobs").insert({
    id: buildId, project_id: id, requested_by: auth.user.id, conversation_id: conversation?.id, prompt: parsed.data.prompt, mode: parsed.data.mode,
    idempotency_key: parsed.data.idempotencyKey, plan: { approval: "required", revision: 1 },
  }).select().single();
  if (error) {
    await admin.rpc("settle_reservation", { p_build: buildId, p_reason: "not queued" });
    if (error.code === "23505") return apiError("CONFLICT", "A request is already active");
    return apiError("INTERNAL", "Could not queue your request", { cause: error, scope: "builds" });
  }
  if (conversation) await auth.supabase.from("messages").insert({ conversation_id: conversation.id, role: "user", content: parsed.data.prompt });
  await admin.from("projects").update({ status: "queued", last_error: null }).eq("id", id).eq("owner_id", auth.user.id);
  await admin.rpc("record_activity", { p_user: auth.user.id, p_kind: "build_requested" });
  return json({ build: data }, { status: 202 });
}

/** Compare-and-set makes approval/revision mutually exclusive across tabs. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const parsed = z.discriminatedUnion("action", [
    z.object({ action: z.literal("approve"), buildId: z.string().uuid(), revision: z.number().int().positive(), summary: z.string().trim().min(1).max(2000), steps: z.array(z.string().trim().min(1).max(1000)).min(1).max(12) }),
    z.object({ action: z.literal("revise"), buildId: z.string().uuid(), revision: z.number().int().positive(), changes: z.string().trim().min(1).max(10000) }),
    z.object({ action: z.literal("cancel"), buildId: z.string().uuid(), revision: z.number().int().positive() }),
  ]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Invalid plan review");
  const input = parsed.data;
  if (auth.project.owner_id !== auth.user.id) return apiError("FORBIDDEN", "Only the project owner can approve a plan");
  const { data: job } = await auth.supabase.from("build_jobs").select("*").eq("id", input.buildId).eq("project_id", id).single();
  if (!job) return apiError("NOT_FOUND", "Plan not found");
  if (job.status !== "planning" || job.plan?.approval !== "awaiting" || job.plan?.revision !== input.revision) return apiError("CONFLICT", "This plan has changed. Refresh to review the latest version.");
  const admin = createAdmin();
  let update: Record<string, unknown>;
  const now = new Date().toISOString();
  if (input.action === "approve") {
    // Hold enough for the first generation steps before any code is written.
    const { data: ok, error } = await admin.rpc("ensure_reservation_headroom", { p_build: job.id, p_needed: RESERVE.generate() });
    if (error) return apiError("SERVICE_UNAVAILABLE", "Could not check your credits", { cause: error, scope: "builds" });
    if (!ok) return apiError("INSUFFICIENT_CREDITS", "You do not have enough credits to build this plan. Add credits or upgrade your plan.");
    const reviewed = { summary: input.summary, steps: input.steps };
    update = { status: "queued", locked_at: null, locked_by: null, attempt_count: 0, plan: { ...job.plan, ...reviewed, approval: "approved", approved_at: now, manifest: { ...job.plan.manifest, plan: reviewed } }, prompt: `${job.prompt}\n\nUSER APPROVED PLAN (follow this scope):\n${input.summary}\n${input.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`, progress: [...(job.progress || []), { at: now, message: "Plan approved. Application build queued.", percent: 20 }] };
  } else if (input.action === "revise") {
    update = { status: "queued", locked_at: null, locked_by: null, attempt_count: 0, plan: { approval: "required", revision: input.revision + 1 }, prompt: `${job.prompt}\n\nREQUESTED PLAN CHANGES:\n${input.changes}`, progress: [...(job.progress || []), { at: now, message: "Revising the plan before writing code.", percent: 10 }] };
  } else {
    update = { status: "cancelled", finished_at: now, locked_at: null, locked_by: null };
  }
  if (typeof update.prompt === "string" && update.prompt.length > 30000) return apiError("INVALID_INPUT", "This brief is too long. Please shorten the requested changes.");
  const { data, error } = await admin.from("build_jobs").update(update).eq("id", job.id).eq("project_id", id).eq("status", "planning").eq("plan->>approval", "awaiting").eq("plan->>revision", String(input.revision)).is("locked_by", null).is("cancel_requested_at", null).select().maybeSingle();
  if (error || !data) return apiError("CONFLICT", "Plan already reviewed or changed. Refresh to continue.");
  if (input.action === "cancel") await admin.rpc("settle_reservation", { p_build: job.id, p_reason: "plan cancelled" });
  await admin.from("projects").update({ status: input.action === "cancel" ? (auth.project.active_sandbox_id ? "ready" : "draft") : "queued", last_error: null }).eq("id", id);
  if (input.action === "revise" && job.conversation_id) await auth.supabase.from("messages").insert({ conversation_id: job.conversation_id, role: "user", content: input.changes });
  return json({ build: data }, { status: input.action === "cancel" ? 200 : 202 });
}
