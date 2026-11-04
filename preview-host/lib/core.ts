/*
 * Framework-neutral preview proxy core shared by the Vercel preview host
 * (preview-host/api/proxy.ts) and the local gateway (scripts/preview-gateway.ts).
 *
 * Security properties:
 *  - Authorisation is a host-bound HttpOnly session cookie. URL tokens are only
 *    accepted on the exchange path, are single use, and are removed by an
 *    immediate redirect to a clean URL.
 *  - Every request re-authorises against the database through
 *    authorize_sandbox_access, which requires the project owner, an active
 *    account and a sandbox registered to that same project.
 *  - When the preview host is per project (<projectId>.preview...), the host
 *    must match the token's project.
 */
import { EXCHANGE_PATH, hostProjectId, issuePreviewToken, normalizeHost, previewKeys, safeNextPath, verifyPreviewToken } from "./token.js";

export type ProxyRequest = { method: string; host: string; url: string; headers: Record<string, string | undefined>; body?: ArrayBuffer | string };
export type ProxyResponse = { status: number; headers: Record<string, string>; body?: ArrayBuffer | string };
export type ProxyDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  insertNonce: (jti: string, projectId: string) => Promise<boolean>;
  connectSandbox: (sandboxId: string) => Promise<{ target: string; trafficToken: string }>;
  fetchUpstream?: typeof fetch;
  appOrigin: string;
  frameAncestors: string;
  log?: (message: string) => void;
};

export const SESSION_COOKIE = "__Host-nynz_preview";
const LEGACY_COOKIE = "nynz_preview_session";

function cookie(header: string | undefined, name: string) {
  for (const part of (header || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) { try { return decodeURIComponent(value.join("=")); } catch { return ""; } }
  }
  return "";
}

const text = (status: number, message: string, extra: Record<string, string> = {}): ProxyResponse => ({
  status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", ...extra }, body: message,
});

function sessionCookieHeader(token: string, maxAgeSeconds: number, secure: boolean) {
  // __Host- requires Secure + Path=/ + no Domain, which pins the cookie to this exact preview host.
  const name = secure ? SESSION_COOKIE : LEGACY_COOKIE;
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; ${secure ? "Secure; SameSite=None; Partitioned; " : "SameSite=Lax; "}Max-Age=${Math.max(0, maxAgeSeconds)}`;
}

async function authorize(deps: ProxyDeps, projectId: string, userId: string) {
  const { data, error } = await deps.rpc("authorize_sandbox_access", { p_project: projectId, p_user: userId });
  if (error) throw new Error(`authorisation lookup failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] as { sandbox_id?: string } | undefined : undefined;
  return row?.sandbox_id || null;
}

export async function handlePreview(request: ProxyRequest, deps: ProxyDeps): Promise<ProxyResponse> {
  const keys = previewKeys();
  const host = normalizeHost(request.host || "");
  const secure = !host.startsWith("localhost") && !host.includes(".localhost");
  const url = new URL(request.url, `https://${host}`);
  const method = (request.method || "GET").toUpperCase();
  if (method === "OPTIONS") return { status: 204, headers: { "cache-control": "no-store" } };

  if (url.pathname === EXCHANGE_PATH) {
    if (method !== "GET") return text(405, "Method not allowed");
    const result = verifyPreviewToken(url.searchParams.get("t") || "", { typ: "x", aud: host }, keys);
    if (!result.ok || result.expired) return text(401, "This preview link has expired. Reopen the preview from your NYNZ project.");
    const hostProject = hostProjectId(host);
    if (hostProject && hostProject !== result.claims.projectId) return text(403, "Preview access denied");
    if (!(await deps.insertNonce(result.claims.jti, result.claims.projectId))) return text(401, "This preview link was already used. Reopen the preview from your NYNZ project.");
    if (!(await authorize(deps, result.claims.projectId, result.claims.userId))) return text(403, "Preview access denied");
    const session = issuePreviewToken({ typ: "s", projectId: result.claims.projectId, userId: result.claims.userId, aud: host }, keys);
    return {
      status: 303,
      headers: {
        location: safeNextPath(url.searchParams.get("next")), "cache-control": "no-store", "referrer-policy": "no-referrer",
        "set-cookie": sessionCookieHeader(session.token, Math.floor((session.claims.exp - Date.now()) / 1000), secure),
      },
    };
  }

  const token = cookie(request.headers.cookie, secure ? SESSION_COOKIE : LEGACY_COOKIE);
  const verified = token ? verifyPreviewToken(token, { typ: "s", aud: host }, keys) : null;
  if (!verified || !verified.ok) return text(401, "Preview authorization required");
  const claims = verified.claims;
  const hostProject = hostProjectId(host);
  if (hostProject && hostProject !== claims.projectId) return text(403, "Preview access denied");
  if (verified.expired) {
    if (method === "GET" && (request.headers.accept || "").includes("text/html")) {
      return { status: 303, headers: { location: `${deps.appOrigin}/api/projects/${encodeURIComponent(claims.projectId)}/preview-session?next=${encodeURIComponent(safeNextPath(url.pathname + url.search))}`, "cache-control": "no-store", "referrer-policy": "no-referrer" } };
    }
    return text(401, "Preview session expired. Reopen this preview from your NYNZ project.");
  }

  const sandboxId = await authorize(deps, claims.projectId, claims.userId);
  if (!sandboxId) return text(409, "This project does not have a live preview right now.");
  const sandbox = await deps.connectSandbox(sandboxId);
  const headers = new Headers({ "e2b-traffic-access-token": sandbox.trafficToken });
  for (const name of ["accept", "accept-language", "content-type", "if-none-match", "if-modified-since", "range", "user-agent"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  const upstream = await (deps.fetchUpstream || fetch)(`${sandbox.target}${url.pathname}${url.search}`, {
    method, headers, body: ["GET", "HEAD"].includes(method) ? undefined : request.body, redirect: "manual", signal: AbortSignal.timeout(45_000),
  });
  const out: Record<string, string> = {
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "content-security-policy": `frame-ancestors ${deps.frameAncestors}`,
    "x-content-type-options": "nosniff",
  };
  for (const name of ["content-type", "cache-control", "etag", "last-modified", "location", "accept-ranges", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) out[name] = value;
  }
  return { status: upstream.status, headers: out, body: await upstream.arrayBuffer() };
}

/** E2B REST connect: resumes a paused sandbox and returns its private traffic token. */
export function e2bConnector(apiKey: string, activeSeconds: number) {
  const cache = new Map<string, { target: string; trafficToken: string; until: number }>();
  return async (sandboxId: string) => {
    const cached = cache.get(sandboxId);
    if (cached && cached.until > Date.now()) return cached;
    const response = await fetch(`https://api.e2b.app/v2/sandboxes/${encodeURIComponent(sandboxId)}/connect`, {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ timeout: activeSeconds }), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Sandbox connection failed (${response.status})`);
    const sandbox = await response.json() as { domain?: string | null; trafficAccessToken?: string | null };
    if (!sandbox.trafficAccessToken) throw new Error("Sandbox traffic authentication is unavailable");
    const value = { target: `https://5173-${sandboxId}.${sandbox.domain || "e2b.app"}`, trafficToken: sandbox.trafficAccessToken, until: Date.now() + 30_000 };
    cache.set(sandboxId, value);
    return value;
  };
}
