import JSZip from "jszip";
import { requireProject } from "@/lib/supabase/auth";
import { apiError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";

const EXCLUDED = (path: string) => path.includes("node_modules/") || /(^|\/)\.env(\.|$)/.test(path) || path.startsWith(".git/") || path === ".nynz-preview.mjs";

/**
 * Exports the project's current source and uploaded assets. Environment files,
 * dependencies and NYNZ's internal preview launcher are excluded. A README the
 * project already has is preserved; NYNZ's export notes go to NYNZ_EXPORT.md.
 * Exports contain only project-authored or NYNZ-authored files, so no
 * third-party licence notice is added; if a future template ships third-party
 * code, its notice must be added here.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const limited = await rateLimit(`export:${auth.user.id}`, 30, 3600);
  if (limited) return limited;
  const [{ data: files, error }, { data: assets }] = await Promise.all([
    auth.supabase.from("project_files").select("path,content").eq("project_id", id),
    auth.supabase.storage.from("project-assets").list(id, { limit: 100 }),
  ]);
  if (error) return apiError("INTERNAL", "Could not export this project", { cause: error, scope: "export" });
  const zip = new JSZip();
  const included = (files || []).filter((file) => !EXCLUDED(file.path));
  for (const file of included) zip.file(file.path, file.content);
  for (const asset of (assets || []).filter((item) => item.id)) {
    const { data } = await auth.supabase.storage.from("project-assets").download(`${id}/${asset.name}`);
    if (data) zip.file(`public/uploads/${asset.name}`, await data.arrayBuffer());
  }
  const notes = `# ${auth.project.name}\n\nExported from NYNZ on ${new Date().toISOString().slice(0, 10)}.\n\n## Run locally\n\n\`\`\`\nnpm install\nnpm run dev\n\`\`\`\n\nEnvironment files are not included. If this app uses a Supabase backend, create \`.env.local\` with \`VITE_SUPABASE_URL\` and \`VITE_SUPABASE_PUBLISHABLE_KEY\` for that project.\n`;
  const hasReadme = included.some((file) => file.path.toLowerCase() === "readme.md");
  zip.file(hasReadme ? "NYNZ_EXPORT.md" : "README.md", notes);
  const body = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const safeName = auth.project.name.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "nynz-project";
  return new Response(new Uint8Array(body), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${safeName}.zip"`, "cache-control": "private, no-store" } });
}
