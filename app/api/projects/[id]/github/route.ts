import { z } from "zod";
import { json, requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError, dbError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";
import { GitHubClient, githubConfig, prepareExport } from "@/lib/integrations/github";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const config = githubConfig();
  const [{ data: link }, { data: installations }] = await Promise.all([
    auth.supabase.from("github_links").select("repository,branch,last_synced_sha,last_synced_at,last_direction").eq("project_id", id).maybeSingle(),
    auth.supabase.from("github_installations").select("installation_id,account_login"),
  ]);
  return json({ available: Boolean(config), reason: config ? null : "GitHub is not connected to NYNZ yet (GitHub App not configured).", installations: installations || [], link });
}

const input = z.object({
  action: z.enum(["export", "import"]), installationId: z.number().int().positive(),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), branch: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/).default("main"),
  overwriteRemoteChanges: z.boolean().default(false), expectedRevision: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const config = githubConfig();
  if (!config) return apiError("SERVICE_UNAVAILABLE", "GitHub is not connected to NYNZ yet.");
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Choose a repository and branch");
  const limited = await rateLimit(`github:${auth.user.id}`, 20, 3600);
  if (limited) return limited;
  const admin = createAdmin();
  const { data: installation } = await admin.from("github_installations").select("installation_id").eq("user_id", auth.user.id).eq("installation_id", parsed.data.installationId).maybeSingle();
  if (!installation) return apiError("FORBIDDEN", "Connect that GitHub account to NYNZ first.");
  const { data: link } = await admin.from("github_links").select("*").eq("project_id", id).maybeSingle();
  const sameTarget = link && link.repository === parsed.data.repository && link.branch === parsed.data.branch;
  try {
    const client = await GitHubClient.forInstallation(config.appId, config.privateKey, installation.installation_id);
    if (parsed.data.action === "export") {
      const { data: files } = await admin.from("project_files").select("path,content").eq("project_id", id);
      const { included, refused } = prepareExport(files || []);
      if (refused.some((r) => !/environment or internal/.test(r.reason))) return apiError("CONFLICT", "Some files look like they contain secrets, so nothing was exported. Remove them and try again.", { extra: { refused } });
      const result = await client.exportFiles({ repo: parsed.data.repository, branch: parsed.data.branch, files: included, expectedHead: sameTarget && !parsed.data.overwriteRemoteChanges ? link.last_synced_sha : null, previouslyExported: sameTarget ? link.last_exported_paths : [], message: `Update from NYNZ: ${auth.project.name}` });
      await admin.from("github_links").upsert({ project_id: id, installation_id: installation.installation_id, repository: parsed.data.repository, branch: parsed.data.branch, last_synced_sha: result.commit, last_exported_paths: included.map((f) => f.path), last_synced_at: new Date().toISOString(), last_direction: "export" });
      return json({ commit: result.commit, files: included.length, excluded: refused });
    }
    const imported = await client.importFiles({ repo: parsed.data.repository, branch: parsed.data.branch, maxFiles: 400 });
    if (!imported.files.length) return apiError("CONFLICT", "No importable source files were found on that branch.");
    const { data, error } = await admin.rpc("import_project_files", { p_project: id, p_actor: auth.user.id, p_expected_revision: parsed.data.expectedRevision ?? null, p_files: imported.files, p_label: `Imported from ${parsed.data.repository}@${parsed.data.branch}` });
    if (error) return dbError(error, "github-import");
    await admin.from("github_links").upsert({ project_id: id, installation_id: installation.installation_id, repository: parsed.data.repository, branch: parsed.data.branch, last_synced_sha: imported.head, last_exported_paths: imported.files.map((f) => f.path), last_synced_at: new Date().toISOString(), last_direction: "import" });
    return json({ imported: imported.files.length, skipped: imported.skipped, truncated: imported.truncated, versionId: data.version_id, backupVersionId: data.backup_version_id });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "CONFLICT") return apiError("CONFLICT", "The branch changed on GitHub since NYNZ last synced. Import first, or choose to overwrite the remote changes.");
    if (message === "GITHUB_404") return apiError("NOT_FOUND", "NYNZ cannot see that repository or branch. Check the app's repository access on GitHub.");
    return apiError("SERVICE_UNAVAILABLE", "GitHub could not complete the request.", { cause: error, scope: "github" });
  }
}
