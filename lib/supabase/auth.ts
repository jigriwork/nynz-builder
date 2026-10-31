import { NextResponse } from "next/server";
import { createClient } from "./server";

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) } as const;
  return { supabase, user } as const;
}

export async function requireProject(projectId: string) {
  const auth = await requireUser();
  if ("error" in auth) return { error: auth.error } as const;
  const { data: project } = await auth.supabase.from("projects").select("*").eq("id", projectId).single();
  if (!project) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) } as const;
  return { supabase: auth.supabase, user: auth.user, project } as const;
}
