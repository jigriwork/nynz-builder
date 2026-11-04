import { z } from "zod";
import { json, requireProject } from "@/lib/supabase/auth";
import { apiError, dbError } from "@/lib/http/errors";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const { data } = await auth.supabase.from("versions").select("id,label,kind,file_count,created_at,source_build_id").eq("project_id", id).order("created_at", { ascending: false });
  return json({ versions: data || [], activeVersionId: auth.project.active_version_id });
}

/** Saves a checkpoint of the current files in one transaction. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const parsed = z.object({ label: z.string().trim().min(1).max(100) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Invalid label");
  const { data, error } = await auth.supabase.rpc("create_checkpoint", { p_project: id, p_label: parsed.data.label });
  if (error) return dbError(error, "checkpoint");
  return json({ version: { id: data, label: parsed.data.label } }, { status: 201 });
}
