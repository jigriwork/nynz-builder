import { createHash } from "node:crypto";
import { z } from "zod";
import { json, requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";
import { checkTables, isPrivilegedKey, normalizeProjectUrl, tablesInSql, validateConnection } from "@/lib/integrations/customer-supabase";
import { CUSTOMER_RLS_TEMPLATE } from "@/lib/integrations/backend-templates";

/** Connection status plus the project's own migration files for review. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const [{ data }, { data: files }] = await Promise.all([
    auth.supabase.from("generated_backend_connections").select("project_url,updated_at,validated_at,validation,rotated_at").eq("project_id", id).maybeSingle(),
    auth.supabase.from("project_files").select("path,content").eq("project_id", id).like("path", "supabase/migrations/%").order("path"),
  ]);
  const migrations = (files || []).filter((f) => f.path.endsWith(".sql")).map((f) => ({ path: f.path, sha256: createHash("sha256").update(f.content).digest("hex"), bytes: Buffer.byteLength(f.content), tables: tablesInSql(f.content), sql: f.content }));
  return json({ connected: Boolean(data), projectUrl: data?.project_url || null, updatedAt: data?.updated_at || null, validatedAt: data?.validated_at || null, validation: data?.validation || null, rotatedAt: data?.rotated_at || null, migrations, template: CUSTOMER_RLS_TEMPLATE("items") });
}

/** Connect or rotate: the key must be browser-safe and accepted by that exact project. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const parsed = z.discriminatedUnion("action", [
    z.object({ action: z.literal("connect"), projectUrl: z.string().url(), publishableKey: z.string().min(20).max(3000) }),
    z.object({ action: z.literal("check_tables"), tables: z.array(z.string()).min(1).max(30) }),
  ]).safeParse({ action: "connect", ...(await request.json().catch(() => ({}))) });
  if (!parsed.success) return apiError("INVALID_INPUT", "Invalid generated-app backend configuration");
  const limited = await rateLimit(`backend:${auth.user.id}`, 20, 3600);
  if (limited) return limited;
  const admin = createAdmin();
  if (parsed.data.action === "check_tables") {
    const { data: conn } = await admin.from("generated_backend_connections").select("project_url,publishable_key").eq("project_id", id).maybeSingle();
    if (!conn) return apiError("CONFLICT", "Connect a Supabase project first");
    return json({ results: await checkTables(conn.project_url, conn.publishable_key, parsed.data.tables) });
  }
  let projectUrl: string;
  try { projectUrl = normalizeProjectUrl(parsed.data.projectUrl); } catch (error) { return apiError("INVALID_INPUT", (error as Error).message); }
  if (isPrivilegedKey(parsed.data.publishableKey)) return apiError("INVALID_INPUT", "Secret and service-role keys are not accepted. Use the publishable (or anon) key with row-level security.");
  const validation = await validateConnection(projectUrl, parsed.data.publishableKey).catch(() => ({ ok: false as const, reason: "The Supabase project could not be reached." }));
  if (!validation.ok) return apiError("INVALID_INPUT", validation.reason);
  const { data: existing } = await admin.from("generated_backend_connections").select("id").eq("project_id", id).maybeSingle();
  const now = new Date().toISOString();
  const { error } = await admin.from("generated_backend_connections").upsert({ project_id: id, project_url: projectUrl, publishable_key: parsed.data.publishableKey, validated_at: now, validation: { ...validation.details, checked_at: now }, updated_at: now, ...(existing ? { rotated_at: now } : {}) }, { onConflict: "project_id" });
  if (error) return apiError("INTERNAL", "Could not save the connection", { cause: error, scope: "backend" });
  return json({ connected: true, projectUrl, rotated: Boolean(existing), validation: validation.details });
}

/** Disconnect: removes the stored URL and key. The next preview restart stops injecting them. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  await createAdmin().from("generated_backend_connections").delete().eq("project_id", id);
  return new Response(null, { status: 204 });
}
