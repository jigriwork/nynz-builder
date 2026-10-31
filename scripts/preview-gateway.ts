import "dotenv/config";
import { config } from "dotenv";
import http from "node:http";
import httpProxy from "http-proxy";
import { createClient } from "@supabase/supabase-js";
import { Sandbox } from "e2b";
import { getPreviewOrigin, verifyPreviewSession, type PreviewSessionClaims } from "../lib/preview/session";

config({ path: ".env.local", quiet: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const e2bApiKey = process.env.E2B_API_KEY;
if (!supabaseUrl || !serviceRoleKey || !e2bApiKey) throw new Error("Preview gateway configuration is incomplete");

const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const port = Number(process.env.PREVIEW_GATEWAY_PORT || 3001);
const proxy = httpProxy.createProxyServer({ changeOrigin: true, ws: true, xfwd: false, secure: true });
const sandboxCache = new Map<string, { target: string; trafficAccessToken: string; expiresAt: number }>();
const authorizationCache = new Map<string, { claims: PreviewSessionClaims; checkedAt: number }>();
const sessionCookie = "nynz_preview_session";

function cookieValue(header: string | undefined, name: string) {
  for (const part of (header || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function sessionFromRequest(request: http.IncomingMessage) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "preview.localhost"}`);
  return requestUrl.searchParams.get("ny_session") || cookieValue(request.headers.cookie, sessionCookie);
}

async function authorize(request: http.IncomingMessage) {
  const token = sessionFromRequest(request);
  if (!token) return null;
  const cached = authorizationCache.get(token);
  if (cached && Date.now() - cached.checkedAt < 15_000 && cached.claims.expiresAt > Date.now()) return { token, claims: cached.claims };
  const claims = verifyPreviewSession(token);
  if (!claims) return null;
  const { data } = await db.from("projects").select("id").eq("id", claims.projectId).eq("owner_id", claims.userId).eq("active_sandbox_id", claims.sandboxId).eq("status", "ready").maybeSingle();
  if (!data) return null;
  const expectedHost = new URL(getPreviewOrigin(claims.projectId)).host;
  if (request.headers.host !== expectedHost) return null;
  authorizationCache.set(token, { claims, checkedAt: Date.now() });
  return { token, claims };
}

async function sandboxTarget(sandboxId: string, expiresAt: number) {
  const cached = sandboxCache.get(sandboxId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const sandbox = await Sandbox.connect(sandboxId, { apiKey: e2bApiKey });
  if (!sandbox.trafficAccessToken) throw new Error("E2B did not return a traffic access token for the private sandbox");
  const value = { target: `https://${sandbox.getHost(5173)}`, trafficAccessToken: sandbox.trafficAccessToken, expiresAt };
  sandboxCache.set(sandboxId, value);
  return value;
}

function upstreamPath(request: http.IncomingMessage) {
  const value = new URL(request.url || "/", `http://${request.headers.host || "preview.localhost"}`);
  value.searchParams.delete("ny_session");
  return `${value.pathname}${value.search}`;
}

function forwardedCookies(request: http.IncomingMessage) {
  return (request.headers.cookie || "").split(";").map((part) => part.trim()).filter((part) => part && !part.startsWith(`${sessionCookie}=`)).join("; ");
}

proxy.on("proxyReq", (proxyRequest, request) => {
  const context = (request as http.IncomingMessage & { previewContext?: { trafficAccessToken: string } }).previewContext;
  if (!context) return;
  proxyRequest.setHeader("e2b-traffic-access-token", context.trafficAccessToken);
  proxyRequest.removeHeader("authorization");
  const cookies = forwardedCookies(request);
  if (cookies) proxyRequest.setHeader("cookie", cookies); else proxyRequest.removeHeader("cookie");
});

proxy.on("proxyReqWs", (proxyRequest, request) => {
  const context = (request as http.IncomingMessage & { previewContext?: { trafficAccessToken: string } }).previewContext;
  if (!context) return;
  proxyRequest.setHeader("e2b-traffic-access-token", context.trafficAccessToken);
  proxyRequest.removeHeader("authorization");
  const cookies = forwardedCookies(request);
  if (cookies) proxyRequest.setHeader("cookie", cookies); else proxyRequest.removeHeader("cookie");
});

proxy.on("proxyRes", (proxyResponse, request) => {
  const context = (request as http.IncomingMessage & { previewContext?: { sessionToken: string; secureCookie: boolean } }).previewContext;
  if (!context?.sessionToken) return;
  const gatewayCookie = `${sessionCookie}=${encodeURIComponent(context.sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300${context.secureCookie ? "; Secure" : ""}`;
  const upstreamCookies = proxyResponse.headers["set-cookie"] || [];
  proxyResponse.headers["set-cookie"] = [gatewayCookie, ...upstreamCookies];
  proxyResponse.headers["referrer-policy"] = "no-referrer";
  proxyResponse.headers["permissions-policy"] = "camera=(), microphone=(), geolocation=()";
});

proxy.on("error", (error, _request, response) => {
  if (response && "writeHead" in response && !response.headersSent) response.writeHead(502, { "content-type": "text/plain", "cache-control": "no-store" });
  if (response && "end" in response) response.end("Preview temporarily unavailable");
  console.error(`[preview-gateway] ${error instanceof Error ? error.message : "Proxy error"}`);
});

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "CONNECT") { response.writeHead(405).end(); return; }
    const authorized = await authorize(request);
    if (!authorized) { response.writeHead(401, { "content-type": "text/plain", "cache-control": "no-store" }).end("Preview authorization required"); return; }
    const target = await sandboxTarget(authorized.claims.sandboxId, authorized.claims.expiresAt);
    request.url = upstreamPath(request);
    (request as typeof request & { previewContext: object }).previewContext = { trafficAccessToken: target.trafficAccessToken, sessionToken: authorized.token, secureCookie: getPreviewOrigin(authorized.claims.projectId).startsWith("https:") };
    response.setHeader("cache-control", "private, no-store");
    proxy.web(request, response, { target: target.target });
  } catch (error) {
    console.error(`[preview-gateway] ${error instanceof Error ? error.message : "Request failed"}`);
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain", "cache-control": "no-store" });
    response.end("Preview temporarily unavailable");
  }
});

server.on("upgrade", async (request, socket, head) => {
  try {
    const authorized = await authorize(request);
    if (!authorized) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    const target = await sandboxTarget(authorized.claims.sandboxId, authorized.claims.expiresAt);
    request.url = upstreamPath(request);
    (request as typeof request & { previewContext: object }).previewContext = { trafficAccessToken: target.trafficAccessToken };
    proxy.ws(request, socket, head, { target: target.target });
  } catch {
    socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    socket.destroy();
  }
});

server.listen(port, "0.0.0.0", () => console.log(`[NYNZ preview gateway] listening on ${port}`));
