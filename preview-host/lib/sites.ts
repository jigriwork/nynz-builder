/*
 * Published-site helpers shared by the worker (artifact validation) and the
 * site host (serving). Sites are static Vite production builds served from
 * immutable, per-deployment storage prefixes on their own origin
 * (<slug>.<PUBLISH_SITES_SUFFIX> or a verified custom domain). No customer
 * server code runs on the platform host.
 */
export type ArtifactFile = { path: string; size: number; sha256: string; type: string };
export const MAX_ARTIFACT_FILES = 500;
export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", txt: "text/plain; charset=utf-8", xml: "application/xml",
  webmanifest: "application/manifest+json", map: "application/json", pdf: "application/pdf", csv: "text/csv; charset=utf-8", avif: "image/avif", mp4: "video/mp4", webm: "video/webm",
};

export function contentType(path: string) {
  return TYPES[path.split(".").pop()?.toLowerCase() || ""] || "application/octet-stream";
}

export function validateArtifact(files: Array<{ path: string; size: number }>) {
  if (!files.some((file) => file.path === "index.html")) throw new Error("Build output has no index.html");
  if (files.length > MAX_ARTIFACT_FILES) throw new Error(`Build output has more than ${MAX_ARTIFACT_FILES} files`);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_ARTIFACT_BYTES) throw new Error("Build output is larger than 25 MB");
  for (const file of files) {
    if (!/^[A-Za-z0-9._@/+-]+$/.test(file.path) || file.path.split("/").some((part) => part === ".." || part === "") || file.path.startsWith("/")) throw new Error(`Unsafe output path: ${file.path}`);
    if (/(^|\/)\.env/.test(file.path) || file.path.endsWith(".map")) throw new Error(`Output must not include ${file.path}`);
  }
  return total;
}

/** Maps a request path to an artifact file, with single-page-app fallback. */
export function resolveSitePath(manifest: { files: ArtifactFile[] }, rawPath: string) {
  let path = decodeURIComponent(rawPath.split("?")[0]).replace(/^\/+/, "");
  if (path.includes("..")) return null;
  const has = (p: string) => manifest.files.find((file) => file.path === p);
  if (!path || path.endsWith("/")) path = `${path}index.html`;
  const exact = has(path) || has(`${path}/index.html`) || has(`${path}.html`);
  if (exact) return { file: exact, status: 200 };
  if (!/\.[a-z0-9]{1,8}$/i.test(path)) { const index = has("index.html"); return index ? { file: index, status: 200 } : null; }
  return null;
}

export function siteHeaders(file: ArtifactFile) {
  const hashed = /(^|\/)assets\/.+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/.test(file.path);
  return {
    "content-type": file.type || contentType(file.path),
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
    etag: `"${file.sha256.slice(0, 32)}"`,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "strict-transport-security": "max-age=31536000",
  };
}

export function slugFor(name: string, projectId: string) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "app";
  return `${base}-${projectId.replace(/-/g, "").slice(0, 6)}`.replace(/^-/, "a");
}
