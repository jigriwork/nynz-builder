import { requireProject } from "@/lib/supabase/auth";
import { apiError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";
import { buildExportZip } from "@/lib/platform/export";

/**
 * Exports the project's current source and uploaded assets (see
 * lib/platform/export.ts for what is excluded and how READMEs are preserved).
 * Exports contain only project-authored or NYNZ-authored files, so no
 * third-party licence notice is added.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const limited = await rateLimit(`export:${auth.user.id}`, 30, 3600);
  if (limited) return limited;
  const [{ data: files, error }, { data: listed }] = await Promise.all([
    auth.supabase.from("project_files").select("path,content").eq("project_id", id),
    auth.supabase.storage.from("project-assets").list(id, { limit: 100 }),
  ]);
  if (error) return apiError("INTERNAL", "Could not export this project", { cause: error, scope: "export" });
  const assets: Array<{ name: string; data: ArrayBuffer }> = [];
  for (const asset of (listed || []).filter((item) => item.id)) {
    const { data } = await auth.supabase.storage.from("project-assets").download(`${id}/${asset.name}`);
    if (data) assets.push({ name: asset.name, data: await data.arrayBuffer() });
  }
  const { body, fileName } = await buildExportZip({ name: auth.project.name, files: files || [], assets });
  return new Response(new Uint8Array(body), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "private, no-store" } });
}
