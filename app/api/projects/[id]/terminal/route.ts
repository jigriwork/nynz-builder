import { NextResponse } from "next/server";
import { z } from "zod";
import { CommandExitError, Sandbox } from "e2b";
import { requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError, dbError } from "@/lib/http/errors";
import { sessionExtensionArgs } from "@/preview-host/lib/runtime";
import { rateLimit } from "@/lib/platform/rate-limit";

export const maxDuration = 60;
const requestSchema = z.object({ command: z.string().trim().min(1).max(2_000) });
const noStore = { "cache-control": "private, no-store" };

/**
 * Runs a command in the project's own sandbox. The sandbox is resolved by the
 * server-owned resource registry (never from a customer-writable column), and
 * the sandbox's own metadata must name this project before any command runs.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  if (!process.env.E2B_API_KEY) return apiError("SERVICE_UNAVAILABLE", "Terminal service is unavailable");
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Enter a valid command");
  const limited = await rateLimit(`terminal:${auth.user.id}`, 30, 60);
  if (limited) return limited;
  const { data, error } = await createAdmin().rpc("authorize_sandbox_access", { p_project: id, p_user: auth.user.id });
  if (error) return apiError("SERVICE_UNAVAILABLE", "Terminal service is unavailable", { cause: error, scope: "terminal" });
  const sandboxId = Array.isArray(data) ? data[0]?.sandbox_id : null;
  if (!sandboxId || auth.project.status !== "ready") return apiError("CONFLICT", "Start the preview before opening a terminal");
  try {
    const admitted = await createAdmin().rpc("extend_sandbox_session", sessionExtensionArgs(sandboxId, id, auth.user.id, 60));
    if (admitted.error) return dbError(admitted.error, "terminal");
    const sandbox = await Sandbox.connect(sandboxId, { apiKey: process.env.E2B_API_KEY, timeoutMs: 60_000 });
    const info = await sandbox.getInfo();
    const boundProject = info.metadata?.projectId;
    if (boundProject && boundProject !== id) return apiError("FORBIDDEN", "This sandbox does not belong to this project", { cause: new Error(`sandbox metadata mismatch for project ${id}`), scope: "terminal" });
    const result = await sandbox.commands.run(parsed.data.command, { cwd: "/home/user/app", timeoutMs: 30_000 });
    return NextResponse.json({ exitCode: result.exitCode, stdout: result.stdout.slice(-20_000), stderr: result.stderr.slice(-20_000) }, { headers: noStore });
  } catch (error) {
    if (error instanceof CommandExitError) return NextResponse.json({ exitCode: error.exitCode, stdout: String(error.stdout || "").slice(-20_000), stderr: String(error.stderr || "").slice(-20_000) }, { headers: noStore });
    return apiError("SERVICE_UNAVAILABLE", "The sandbox command could not be completed", { cause: error, scope: "terminal" });
  }
}
