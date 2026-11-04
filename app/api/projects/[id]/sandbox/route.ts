import { randomUUID } from "node:crypto";
import { json, requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";
import { RESERVE, admitPaidWork } from "@/lib/billing/entitlements";

const ACTIVE = ["queued", "planning", "generating", "installing", "running", "validating"];

/** Restarts (or resumes after inactivity) the preview from the current files. Uses sandbox time only. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const limited = await rateLimit(`restart:${auth.user.id}`, 20, 3600);
  if (limited) return limited;
  const admin = createAdmin();
  const { data: active } = await admin.from("build_jobs").select("id").eq("project_id", id).in("status", ACTIVE).limit(1).maybeSingle();
  if (active) return apiError("CONFLICT", "A preview restart is already in progress", { extra: { buildId: active.id } });
  const { count } = await admin.from("project_files").select("path", { count: "exact", head: true }).eq("project_id", id);
  if (!count) return apiError("CONFLICT", "There are no files to run yet");
  const buildId = randomUUID();
  const refused = await admitPaidWork(admin, { userId: auth.user.id, projectId: id, buildId, credits: RESERVE.restart() });
  if (refused) return refused;
  const { data, error } = await admin.from("build_jobs").insert({ id: buildId, project_id: id, requested_by: auth.user.id, prompt: "Restart the current application without changing its files.", mode: "restart", idempotency_key: `restart-${buildId}` }).select().single();
  if (error) {
    await admin.rpc("settle_reservation", { p_build: buildId, p_reason: "not queued" });
    return error.code === "23505" ? apiError("CONFLICT", "A preview restart is already in progress") : apiError("INTERNAL", "Could not queue the preview restart", { cause: error, scope: "sandbox" });
  }
  await admin.from("projects").update({ status: "queued", last_error: null }).eq("id", id);
  return json({ build: data }, { status: 202 });
}
