import { json, requireUser } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/http/errors";

/** Requests cancellation. Queued work is cancelled (and its hold released) immediately; running work stops at the next checkpoint. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError("NOT_FOUND", "Build not found");
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { data: owned } = await auth.supabase.from("build_jobs").select("id,status,project_id,locked_by").eq("id", id).maybeSingle();
  if (!owned) return apiError("NOT_FOUND", "Build not found");
  const admin = createAdmin();
  const now = new Date().toISOString();
  // Queued work, and plans waiting for approval, are not held by a worker.
  if (owned.status === "queued" || (owned.status === "planning" && !owned.locked_by)) {
    const { data } = await admin.from("build_jobs").update({ status: "cancelled", cancel_requested_at: now, finished_at: now }).eq("id", id).in("status", ["queued", "planning"]).is("locked_by", null).select("id").maybeSingle();
    if (data) {
      await admin.rpc("settle_reservation", { p_build: id, p_reason: "cancelled" });
      const { data: project } = await admin.from("projects").select("active_sandbox_id").eq("id", owned.project_id).single();
      await admin.from("projects").update({ status: project?.active_sandbox_id ? "ready" : "draft" }).eq("id", owned.project_id);
      return json({ cancelled: true });
    }
  }
  const { data, error } = await admin.from("build_jobs").update({ cancel_requested_at: now }).eq("id", id).in("status", ["planning", "generating", "installing", "running", "validating"]).select("id").maybeSingle();
  if (error || !data) return apiError("NOT_FOUND", "Build not found");
  return json({ cancelled: true });
}
