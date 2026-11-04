import { z } from "zod";
import { json, requireUser } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";
import { entitlementsFor } from "@/lib/billing/entitlements";

const input = z.object({ name: z.string().trim().min(1).max(100), description: z.string().max(2000).optional() });

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.supabase.from("projects").select("id,name,description,status,preview_url,updated_at,created_at").eq("owner_id", auth.user.id).order("updated_at", { ascending: false });
  return error ? apiError("INTERNAL", "Could not load projects", { cause: error, scope: "projects" }) : json({ projects: data });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Invalid project");
  const limited = await rateLimit(`project-create:${auth.user.id}`, 20, 3600);
  if (limited) return limited;
  const admin = createAdmin();
  const [entitlements, { count }] = await Promise.all([
    entitlementsFor(admin, auth.user.id),
    auth.supabase.from("projects").select("id", { count: "exact", head: true }).eq("owner_id", auth.user.id),
  ]);
  if ((count || 0) >= entitlements.max_projects) return apiError("FORBIDDEN", `Your ${entitlements.plan_name} plan includes up to ${entitlements.max_projects} projects. Delete a project or upgrade to create more.`);
  const { data: project, error } = await auth.supabase.from("projects").insert({ owner_id: auth.user.id, ...parsed.data }).select().single();
  if (error) return apiError("INTERNAL", "Could not create the project", { cause: error, scope: "projects" });
  await auth.supabase.from("conversations").insert({ project_id: project.id });
  await admin.rpc("record_activity", { p_user: auth.user.id, p_kind: "project_created" });
  return json({ project }, { status: 201 });
}
