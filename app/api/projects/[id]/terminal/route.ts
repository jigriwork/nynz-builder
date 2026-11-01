import { NextResponse } from "next/server";
import { z } from "zod";
import { CommandExitError, Sandbox } from "e2b";
import { requireProject } from "@/lib/supabase/auth";

export const maxDuration = 60;
const requestSchema = z.object({ command: z.string().trim().min(1).max(2_000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  if (!auth.project.active_sandbox_id || auth.project.status !== "ready") return NextResponse.json({ error: "Start the preview before opening a terminal" }, { status: 409 });
  if (!process.env.E2B_API_KEY) return NextResponse.json({ error: "Terminal service is unavailable" }, { status: 503 });
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid command" }, { status: 400 });
  try {
    const sandbox = await Sandbox.connect(auth.project.active_sandbox_id, { apiKey: process.env.E2B_API_KEY, timeoutMs: 60_000 });
    const result = await sandbox.commands.run(parsed.data.command, { cwd: "/home/user/app", timeoutMs: 30_000 });
    return NextResponse.json({ exitCode: result.exitCode, stdout: result.stdout.slice(-20_000), stderr: result.stderr.slice(-20_000) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CommandExitError) return NextResponse.json({ exitCode: error.exitCode, stdout: String(error.stdout || "").slice(-20_000), stderr: String(error.stderr || "").slice(-20_000) }, { headers: { "cache-control": "private, no-store" } });
    console.error(`[terminal] ${error instanceof Error ? error.message : "Command failed"}`);
    return NextResponse.json({ error: "The sandbox command could not be completed" }, { status: 502 });
  }
}
