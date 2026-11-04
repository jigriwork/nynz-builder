import { resolveSitePath, siteHeaders, type ArtifactFile } from "./sites.js";

export type SiteDeps = {
  resolve: (host: string) => Promise<{ deployment_id: string; manifest: { files: ArtifactFile[] } } | null>;
  download: (path: string) => Promise<ArrayBuffer | null>;
};

/**
 * Serves a published static site from its active immutable deployment. Each
 * site has its own origin; no NYNZ cookies or credentials exist on it, and
 * requests never reach a sandbox or customer server code.
 */
export async function handleSite(request: { method: string; host: string; url: string; headers: Record<string, string | undefined> }, deps: SiteDeps) {
  const method = request.method.toUpperCase();
  const plain = (status: number, body: string) => ({ status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } as Record<string, string>, body: body as string | ArrayBuffer | undefined });
  if (!["GET", "HEAD"].includes(method)) return plain(405, "Method not allowed");
  const site = await deps.resolve(request.host.toLowerCase().replace(/\.$/, ""));
  if (!site) return plain(404, "This site is not published.");
  const match = resolveSitePath(site.manifest, new URL(request.url, "https://site.invalid").pathname);
  if (!match) return plain(404, "Not found");
  const headers: Record<string, string> = siteHeaders(match.file);
  if (request.headers["if-none-match"] === headers.etag) return { status: 304, headers, body: undefined };
  const data = method === "HEAD" ? undefined : await deps.download(`${site.deployment_id}/${match.file.path}`);
  if (method === "GET" && !data) return plain(502, "Site temporarily unavailable");
  return { status: match.status, headers, body: data ?? undefined };
}
