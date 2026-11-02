import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.supabase.from("build_jobs").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(20);
  if (error) return NextResponse.json({ error: "Could not load builds" }, { status: 500 });
  return NextResponse.json({ builds: data || [] }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const parsed = z.object({ prompt: z.string().trim().min(1).max(30000), mode: z.enum(["create", "edit", "restart"]).default("create"), idempotencyKey: z.string().min(8).max(200) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid build request" }, { status: 400 });
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const [{ count: dailyBuilds }, { data: usage, error: usageError }] = await Promise.all([
    auth.supabase.from("build_jobs").select("id", { count: "exact", head: true }).gte("created_at", today.toISOString()),
    auth.supabase.from("usage_events").select("quantity,estimated_cost_minor").gte("created_at", today.toISOString()).in("kind", ["model_input_tokens", "model_output_tokens"]),
  ]);
  if (usageError) return NextResponse.json({ error: "Could not check usage" }, { status: 503 });
  if ((dailyBuilds || 0) >= Number(process.env.DAILY_BUILD_LIMIT || 20)) return NextResponse.json({ error: "Daily build limit reached" }, { status: 429 });
  if ((usage || []).reduce((sum, item) => sum + Number(item.quantity), 0) >= Number(process.env.DAILY_MODEL_TOKEN_LIMIT || 500000)) return NextResponse.json({ error: "Daily model token budget reached" }, { status: 429 });
  if ((usage || []).reduce((sum, item) => sum + Number(item.estimated_cost_minor || 0), 0) >= Number(process.env.DAILY_MODEL_COST_LIMIT_MINOR || 10000)) return NextResponse.json({ error: "Daily model spending limit reached" }, { status: 429 });
  const { data: active } = await auth.supabase.from("build_jobs").select("id").eq("project_id", id).in("status", ["queued", "planning", "generating", "installing", "running", "validating"]).maybeSingle();
  if (active) return NextResponse.json({ error: "A plan or build is already active", buildId: active.id }, { status: 409 });
  const { data: conversation } = await auth.supabase.from("conversations").select("id").eq("project_id", id).order("created_at").limit(1).single();
  const { data, error } = await createAdmin().from("build_jobs").insert({ project_id: id, requested_by: auth.user.id, conversation_id: conversation?.id, prompt: parsed.data.prompt, mode: parsed.data.mode, idempotency_key: parsed.data.idempotencyKey, plan: parsed.data.mode === "restart" ? null : { approval: "required", revision: 1 } }).select().single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "A request is already active" : "Could not queue your request" }, { status: error.code === "23505" ? 409 : 500 });
  if (conversation) await auth.supabase.from("messages").insert({ conversation_id: conversation.id, role: "user", content: parsed.data.prompt });
  await auth.supabase.from("projects").update({ status: "queued", last_error: null }).eq("id", id);
  return NextResponse.json({ build: data }, { status: 202 });
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
  ]).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid plan review" }, { status: 400 });
  const input = parsed.data;
  if (auth.project.owner_id !== auth.user.id) return NextResponse.json({ error: "Only the project owner can approve a plan" }, { status: 403 });
  const { data: job } = await auth.supabase.from("build_jobs").select("*").eq("id", input.buildId).eq("project_id", id).single();
  if (!job) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (job.status !== "planning" || job.plan?.approval !== "awaiting" || job.plan?.revision !== input.revision) return NextResponse.json({ error: "This plan has changed. Refresh to review the latest version." }, { status: 409 });
  let update: Record<string, unknown>;
  if (input.action === "approve") {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const { data: usage, error: usageError } = await auth.supabase.from("usage_events").select("quantity,estimated_cost_minor").gte("created_at", today.toISOString()).in("kind", ["model_input_tokens", "model_output_tokens"]);
    if (usageError) return NextResponse.json({ error: "Could not check usage" }, { status: 503 });
    if ((usage || []).reduce((sum, item) => sum + Number(item.quantity), 0) >= Number(process.env.DAILY_MODEL_TOKEN_LIMIT || 500000) || (usage || []).reduce((sum, item) => sum + Number(item.estimated_cost_minor || 0), 0) >= Number(process.env.DAILY_MODEL_COST_LIMIT_MINOR || 10000)) return NextResponse.json({ error: "Daily model budget reached" }, { status: 429 });
    const reviewed = { summary: input.summary, steps: input.steps };
    update = { status: "queued", locked_at: null, locked_by: null, attempt_count: 0, plan: { ...job.plan, ...reviewed, approval: "approved", approved_at: new Date().toISOString(), manifest: { ...job.plan.manifest, plan: reviewed } }, prompt: `${job.prompt}\n\nUSER APPROVED PLAN (follow this scope):\n${input.summary}\n${input.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`, progress: [...(job.progress || []), { at: new Date().toISOString(), message: "Plan approved. Application build queued.", percent: 20 }] };
  } else if (input.action === "revise") {
    update = { status: "queued", locked_at: null, locked_by: null, attempt_count: 0, plan: { approval: "required", revision: input.revision + 1 }, prompt: `${job.prompt}\n\nREQUESTED PLAN CHANGES:\n${input.changes}`, progress: [...(job.progress || []), { at: new Date().toISOString(), message: "Revising the plan before writing code.", percent: 10 }] };
  } else {
    update = { status: "cancelled", finished_at: new Date().toISOString(), locked_at: null, locked_by: null };
  }
  if (typeof update.prompt === "string" && update.prompt.length > 30000) return NextResponse.json({ error: "This brief is too long. Please shorten the requested changes." }, { status: 400 });
  const { data, error } = await createAdmin().from("build_jobs").update(update).eq("id", job.id).eq("project_id", id).eq("status", "planning").eq("plan->>approval", "awaiting").eq("plan->>revision", String(input.revision)).is("locked_by", null).is("cancel_requested_at", null).select().maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Plan already reviewed or changed. Refresh to continue." }, { status: 409 });
  await auth.supabase.from("projects").update({ status: input.action === "cancel" ? (auth.project.active_sandbox_id ? "ready" : "draft") : "queued", last_error: null }).eq("id", id);
  if (input.action === "revise" && job.conversation_id) await auth.supabase.from("messages").insert({ conversation_id: job.conversation_id, role: "user", content: input.changes });
  return NextResponse.json({ build: data }, { status: input.action === "cancel" ? 200 : 202 });
}
