import { NextResponse } from "next/server";
import { requireProject } from "@/lib/supabase/auth";
import { createPreviewSession, getPreviewOrigin } from "@/lib/preview/session";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireProject(id);
    if ("error" in auth) return auth.error;
    if (!auth.project.active_sandbox_id || auth.project.status !== "ready") {
      return NextResponse.json({ error: "Preview is not ready" }, { status: 409 });
    }
    const expiresAt = Date.now() + 5 * 60_000;
    const session = createPreviewSession({ projectId: id, userId: auth.user.id, sandboxId: auth.project.active_sandbox_id, expiresAt });
    const url = new URL(getPreviewOrigin(id));
    url.searchParams.set("ny_session", session);
    return NextResponse.json({ url: url.toString(), expiresAt: new Date(expiresAt).toISOString() }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error(`[preview-session] ${error instanceof Error ? error.message : "Preview configuration failed"}`);
    return NextResponse.json({ error: "The live preview service is temporarily unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
