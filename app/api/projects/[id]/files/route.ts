import { z } from "zod";
import { json, requireProject } from "@/lib/supabase/auth";
import { filesAreSafe } from "@/lib/platform/security";
import { apiError, dbError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.supabase.from("project_files").select("path,content,content_hash,updated_at").eq("project_id", id).order("path");
  if (error) return apiError("INTERNAL", "Could not load files", { cause: error, scope: "files" });
  return json({ files: data, sourceRevision: auth.project.source_revision, previewRevision: auth.project.preview_revision });
}

/**
 * Saves manual edits. Each file carries the hash the editor loaded
 * (baseHash: null for a new file); a mismatch means someone or something
 * changed the file since, and the save is rejected instead of overwriting it.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const parsed = z.object({ files: z.array(z.object({ path: z.string(), content: z.string(), baseHash: z.string().regex(/^[0-9a-f]{64}$/).nullable() })).min(1).max(120) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Invalid files");
  const limited = await rateLimit(`file-save:${auth.user.id}`, 120, 60);
  if (limited) return limited;
  let safe: Array<{ path: string; content: string }>;
  try { safe = filesAreSafe(parsed.data.files); } catch (error) { return apiError("INVALID_INPUT", error instanceof Error ? error.message : "Invalid file"); }
  const payload = safe.map((file, index) => ({ path: file.path, content: file.content, base_hash: parsed.data.files[index].baseHash }));
  const { data, error } = await auth.supabase.rpc("save_project_files", { p_project: id, p_files: payload });
  if (error) return dbError(error, "files");
  return json({ updated: safe.length, sourceRevision: data.source_revision, files: data.files });
}
