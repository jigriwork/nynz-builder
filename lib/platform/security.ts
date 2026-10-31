import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);
const ALLOWED_FILE = /^[A-Za-z0-9._@/+-]+$/;

export function safeProjectPath(input: string): string {
  const path = input.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.includes("\0") || !ALLOWED_FILE.test(path)) throw new Error("Invalid file path");
  if (path.split("/").some((part) => part === ".." || part === "")) throw new Error("Path traversal is not allowed");
  if ([".env", ".env.local"].includes(path) || path.startsWith(".git/")) throw new Error("Sensitive path is not allowed");
  return path;
}

export function privateIp(host: string) {
  if (!isIP(host)) return false;
  return /^(10\.|127\.|169\.254\.|192\.168\.|0\.|::1$|fc|fd|fe80)/i.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) URLs are allowed");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || privateIp(host)) throw new Error("Private or local addresses are not allowed");
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed");
  return url;
}

export function filesAreSafe(files: Array<{ path: string; content: string }>) {
  if (files.length > 120) throw new Error("Generated file limit exceeded");
  return files.map((file) => {
    const path = safeProjectPath(file.path);
    if (Buffer.byteLength(file.content, "utf8") > 500_000) throw new Error(`File too large: ${path}`);
    return { path, content: file.content };
  });
}
