import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

type Claims = { projectId: string; userId: string; sandboxId: string; expiresAt: number };

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const e2bKey = process.env.E2B_API_KEY;
const signingKey = process.env.PREVIEW_SIGNING_SECRET || serviceKey;
if (!supabaseUrl || !serviceKey || !e2bKey || !signingKey) throw new Error("Preview host configuration is incomplete");

const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const sandboxCache = new Map<string, { target: string; trafficToken: string; expiresAt: number }>();
const sessionCookie = "nynz_preview_session";

function cookie(request: VercelRequest, name: string) {
  for (const part of (request.headers.cookie || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function verifySession(token: string): Claims | null {
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra) return null;
  const expected = createHmac("sha256", signingKey!).update(`nynz-preview-v1.${payload}`).digest("base64url");
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Claims;
    return claims.projectId && claims.userId && claims.sandboxId && claims.expiresAt > Date.now() ? claims : null;
  } catch { return null; }
}

async function targetFor(claims: Claims) {
  const cached = sandboxCache.get(claims.sandboxId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const connected = await fetch(`https://api.e2b.app/v2/sandboxes/${encodeURIComponent(claims.sandboxId)}/connect`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": e2bKey! },
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });
  if (!connected.ok) throw new Error(`Sandbox connection failed (${connected.status})`);
  const sandbox = await connected.json() as { domain?: string | null; sandboxID?: string; trafficAccessToken?: string | null };
  if (!sandbox.trafficAccessToken) throw new Error("Sandbox traffic authentication is unavailable");
  const domain = sandbox.domain || "e2b.app";
  const target = { target: `https://5173-${claims.sandboxId}.${domain}`, trafficToken: sandbox.trafficAccessToken, expiresAt: claims.expiresAt };
  sandboxCache.set(claims.sandboxId, target);
  return target;
}

function requestedPath(request: VercelRequest) {
  const raw = Array.isArray(request.query.path) ? request.query.path.join("/") : request.query.path || "";
  const path = `/${String(raw).replace(/^\/+/, "")}`;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query)) {
    if (key === "path" || key === "ny_session") continue;
    for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) query.append(key, item);
  }
  return `${path}${query.size ? `?${query}` : ""}`;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  try {
    const queryToken = Array.isArray(request.query.ny_session) ? request.query.ny_session[0] : request.query.ny_session;
    const token = queryToken || cookie(request, sessionCookie);
    const claims = token ? verifySession(token) : null;
    if (!claims) { response.status(401).setHeader("cache-control", "no-store").send("Preview authorization required"); return; }

    const { data: project } = await db.from("projects").select("id").eq("id", claims.projectId).eq("owner_id", claims.userId).eq("active_sandbox_id", claims.sandboxId).eq("status", "ready").maybeSingle();
    if (!project) { response.status(403).setHeader("cache-control", "no-store").send("Preview access denied"); return; }

    const sandbox = await targetFor(claims);
    const headers = new Headers({ "e2b-traffic-access-token": sandbox.trafficToken });
    for (const name of ["accept", "accept-language", "content-type", "if-none-match", "range", "user-agent"]) {
      const value = request.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    const method = request.method || "GET";
    let body: BodyInit | undefined;
    if (!["GET", "HEAD"].includes(method) && request.body) {
      body = Buffer.isBuffer(request.body)
        ? new Uint8Array(request.body).buffer as ArrayBuffer
        : typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    }
    const upstream = await fetch(`${sandbox.target}${requestedPath(request)}`, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(45_000) });

    for (const name of ["content-type", "cache-control", "etag", "last-modified", "location", "accept-ranges", "content-range"]) {
      const value = upstream.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("content-security-policy", "frame-ancestors https://www.nynz.in https://nynz.in https://nynz-platform-preview.vercel.app http://localhost:3000");
    if (queryToken) response.setHeader("set-cookie", `${sessionCookie}=${encodeURIComponent(token!)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=300`);
    response.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error(`[preview-host] ${error instanceof Error ? error.message : "Request failed"}`);
    response.status(502).setHeader("cache-control", "no-store").send("Preview temporarily unavailable");
  }
}
