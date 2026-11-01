import { NextResponse } from "next/server";
import { requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";

const activeStatuses = ["queued", "planning", "generating", "installing", "running", "validating"];

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;

  const admin = createAdmin();
  const { data: active } = await admin.from("build_jobs").select("id").eq("project_id", id).in("status", activeStatuses).limit(1).maybeSingle();
  if (active) return NextResponse.json({ error: "A preview restart is already in progress", buildId: active.id }, { status: 409 });

  const { data, error } = await admin.from("build_jobs").insert({
    project_id: id,
    requested_by: auth.user.id,
    prompt: "Restart the current application without changing its files.",
    mode: "restart",
    idempotency_key: `restart-${Date.now()}-${crypto.randomUUID()}`,
  }).select().single();
  if (error) return NextResponse.json({ error: "Could not queue the preview restart" }, { status: 400 });

  await admin.from("projects").update({ status: "queued", last_error: null }).eq("id", id);
  return NextResponse.json({ build: data }, { status: 202 });
}
