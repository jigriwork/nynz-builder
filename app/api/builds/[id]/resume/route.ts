import { randomUUID } from "node:crypto";
import { json, requireUser } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/http/errors";
import { RESERVE, admitPaidWork } from "@/lib/billing/entitlements";

/**
 * Continue a failed or stopped build from its first unfinished step. Finished
 * steps are reused, not regenerated or charged again. Idempotent: repeated
 * clicks, refreshes or duplicate requests return the same resumed build.
 * Replanning from scratch is a separate, explicit Start over request.
 */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError("NOT_FOUND", "Build not found");
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { data: failed } = await auth.supabase.from("build_jobs").select("id,project_id,requested_by,status,resumable,mode,plan,checkpoint").eq("id", id).maybeSingle();
  if (!failed || failed.requested_by !== auth.user.id) return apiError("NOT_FOUND", "Build not found");
  const admin = createAdmin();
  const idempotencyKey = `resume:${id}`;
  const { data: existing } = await admin.from("build_jobs").select("*").eq("resume_of", id).maybeSingle();
  if (existing) return json({ build: existing, resumed: true }, { status: 202 });
  if (!["failed", "cancelled"].includes(failed.status) || !failed.resumable) return apiError("CONFLICT", "This build has nothing saved to resume. Use Start over to build it again.");

  const buildId = randomUUID();
  // Hold enough for the remaining steps (at least the usual first-step hold).
  const plannedFiles: Array<{ path: string }> = failed.plan?.manifest?.files || [];
  const done = new Set<string>(failed.checkpoint?.done || []);
  const share = plannedFiles.length ? Math.max(0, plannedFiles.filter((file) => !done.has(file.path)).length) / plannedFiles.length : 1;
  const hold = Math.max(RESERVE.restart(), Math.ceil((Number(failed.plan?.estimate?.reserve) || RESERVE.generate()) * Math.max(share, 0.25)));
  const refused = await admitPaidWork(admin, { userId: auth.user.id, projectId: failed.project_id, buildId, credits: hold });
  if (refused) return refused;
  const { data, error } = await admin.rpc("resume_build", { p_failed: id, p_new: buildId, p_user: auth.user.id, p_idempotency: idempotencyKey });
  const resumed = data as { id?: string } | null;
  if (error || !resumed?.id || resumed.id !== buildId) {
    // Lost a race with another click, or the build can no longer resume:
    // release this hold so it is never charged.
    await admin.rpc("settle_reservation", { p_build: buildId, p_reason: "resume not started" });
    if (resumed?.id) return json({ build: resumed, resumed: true }, { status: 202 });
    const message = error?.message || "";
    if (/SOURCE_CHANGED/.test(message)) return apiError("CONFLICT", "Your files changed after this build stopped, so it can't continue safely. Use Start over or ask NYNZ again.");
    if (/BUILD_ACTIVE/.test(message)) return apiError("CONFLICT", "Another build is already running for this project.");
    if (/NOT_RESUMABLE/.test(message)) return apiError("CONFLICT", "This build has nothing saved to resume. Use Start over to build it again.");
    return apiError("INTERNAL", "Could not resume this build", { cause: error, scope: "resume" });
  }
  return json({ build: resumed, resumed: true }, { status: 202 });
}
