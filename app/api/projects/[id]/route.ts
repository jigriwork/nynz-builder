import { z } from "zod";
import { json, requireProject } from "@/lib/supabase/auth";
import { apiError, dbError } from "@/lib/http/errors";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const [{ data: usage }, { data: ledger }] = await Promise.all([
    auth.supabase.from("usage_events").select("quantity,estimated_cost_minor").eq("project_id", id).in("kind", ["model_input_tokens", "model_output_tokens"]),
    auth.supabase.from("credit_ledger").select("amount,build_id").eq("entry_type", "consume").in("build_id", (await auth.supabase.from("build_jobs").select("id").eq("project_id", id)).data?.map((row) => row.id) || []),
  ]);
  const modelTokens = (usage || []).reduce((sum, item) => sum + Number(item.quantity), 0);
  const modelCostPaise = (usage || []).reduce((sum, item) => sum + Number(item.estimated_cost_minor || 0), 0);
  const creditsUsed = -(ledger || []).reduce((sum, item) => sum + Number(item.amount), 0);
  const { active_sandbox_id: _sandbox, ...project } = auth.project;
  return json({ project: { ...project, has_preview: Boolean(_sandbox) }, usage: { creditsUsed, modelTokens, modelCostPaise } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const parsed = z.object({ name: z.string().trim().min(1).max(100).optional(), description: z.string().max(2000).optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Invalid update");
  const { data, error } = await auth.supabase.from("projects").update(parsed.data).eq("id", id).select("id,name,description,status,updated_at").single();
  return error ? apiError("INTERNAL", "Could not update the project", { cause: error, scope: "project" }) : json({ project: data });
}

/** Deletes the project and queues its preview sandboxes and stored assets for cleanup. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const { error } = await auth.supabase.rpc("request_project_deletion", { p_project: id });
  return error ? dbError(error, "project-delete") : new Response(null, { status: 204 });
}
