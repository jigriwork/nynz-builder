import { z } from "zod";
import { json, requireProject } from "@/lib/supabase/auth";
import { apiError, dbError } from "@/lib/http/errors";

/**
 * Restores a version in a single transaction (with a "Before restore"
 * checkpoint). The current preview keeps running and is reported as out of
 * date until the owner restarts it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return apiError("NOT_FOUND", "Version not found");
  const body = z.object({ expectedRevision: z.number().int().nonnegative().optional() }).safeParse(await request.json().catch(() => ({})));
  const { data, error } = await auth.supabase.rpc("restore_version", { p_project: id, p_version: versionId, p_expected_revision: body.success ? body.data.expectedRevision ?? null : null });
  if (error) return dbError(error, "restore");
  return json({ restored: data.restored, backupVersionId: data.backup_version_id, sourceRevision: data.source_revision });
}
