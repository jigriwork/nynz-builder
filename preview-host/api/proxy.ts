import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { e2bConnector, handlePreview } from "../lib/core.js";
import { redactPreviewUrl } from "../lib/token.js";
import { handleSite } from "../lib/site-host.js";
import { codeForStatus, previewErrorCode, previewErrorPage } from "../lib/error-page.js";
import { sessionExtensionArgs } from "../lib/runtime.js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const e2bKey = process.env.E2B_API_KEY;
// PREVIEW_SIGNING_SECRET is required by the token module; there is no fallback
// to the database service key.
if (!supabaseUrl || !serviceKey || !e2bKey || !process.env.PREVIEW_SIGNING_SECRET) throw new Error("Preview host configuration is incomplete");

const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const appOrigin = process.env.NYNZ_APP_ORIGIN || "https://www.nynz.in";
const frameAncestors = process.env.PREVIEW_FRAME_ANCESTORS || "https://www.nynz.in https://nynz.in";
// Hosts under PREVIEW_HOST_SUFFIX are private previews; every other host is a published site.
const previewSuffix = (process.env.PREVIEW_HOST_SUFFIX || "preview.nynz.in").toLowerCase();
const sitesSuffix = (process.env.PUBLISH_SITES_SUFFIX || "").toLowerCase();
const isPreviewHost = (host: string) => host === previewSuffix || host.endsWith(`.${previewSuffix}`);
const activeSeconds = Math.max(60, Math.min(Number(process.env.E2B_PREVIEW_ACTIVE_SECONDS || 600), 3_600));
const connectSandbox = e2bConnector(e2bKey, activeSeconds, async (sandbox, project, user) => {
  // Hold the extension before E2B extends the runtime; settled later against recorded running time.
  const admitted = await db.rpc("extend_sandbox_session", sessionExtensionArgs(sandbox, project, user, activeSeconds));
  // Keep the database's reason (SPEND_LIMIT, TRIAL_BUDGET, INSUFFICIENT_CREDITS) so the page can explain it.
  if (admitted.error) throw new Error(`Preview runtime is unavailable or its allowance has been reached: ${String(admitted.error.message || "").split(/\s/)[0]}`);
});

export const config = { api: { bodyParser: false } };

async function rawBody(request: VercelRequest) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const body = Buffer.concat(chunks);
  return body.length ? body.buffer.slice(body.byteOffset, body.byteOffset + body.length) as ArrayBuffer : undefined;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    // vercel.json rewrites every path to /api/proxy?path=…; rebuild the original URL.
    const raw = Array.isArray(request.query.path) ? request.query.path.join("/") : String(request.query.path || "");
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query)) {
      if (key === "path") continue;
      for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) query.append(key, item);
    }
    const url = `/${raw.replace(/^\/+/, "")}${query.size ? `?${query}` : ""}`;
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(request.headers)) headers[key] = Array.isArray(value) ? value.join(", ") : value;
    const host = String(request.headers.host || "").toLowerCase();
    if (!isPreviewHost(host)) {
      const site = await handleSite({ method: request.method || "GET", host, url, headers }, {
        resolve: async (h) => { const { data } = await db.rpc("resolve_site", { p_host: h, p_suffix: sitesSuffix }); return Array.isArray(data) && data[0] ? data[0] : null; },
        download: async (path) => { const { data } = await db.storage.from("published-sites").download(path); return data ? await data.arrayBuffer() : null; },
      });
      for (const [key, value] of Object.entries(site.headers)) response.setHeader(key, String(value));
      response.status(site.status).send(typeof site.body === "string" ? site.body : site.body ? Buffer.from(site.body) : "");
      return;
    }
    const result = await handlePreview({ method: request.method || "GET", host, url, headers, body: await rawBody(request) }, {
      rpc: async (fn, args) => { const { data, error } = await db.rpc(fn, args); return { data, error }; },
      insertNonce: async (jti, projectId) => !(await db.from("preview_exchange_nonces").insert({ jti, project_id: projectId })).error,
      connectSandbox, appOrigin, frameAncestors,
    });
    const wantsPage = (headers.accept || "").includes("text/html");
    if (wantsPage && result.status >= 400 && String(result.headers["content-type"] || "").startsWith("text/plain")) {
      response.status(result.status).setHeader("content-type", "text/html; charset=utf-8").setHeader("cache-control", "no-store")
        .setHeader("content-security-policy", `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors ${frameAncestors}`)
        .send(previewErrorPage(codeForStatus(result.status), appOrigin));
      return;
    }
    for (const [key, value] of Object.entries(result.headers)) response.setHeader(key, String(value));
    response.status(result.status).send(typeof result.body === "string" ? result.body : result.body ? Buffer.from(result.body) : "");
  } catch (error) {
    console.error(`[preview-host] ${redactPreviewUrl(error instanceof Error ? error.message : "Request failed")}`);
    const accept = String(request.headers.accept || "");
    if (accept.includes("text/html")) {
      response.status(503).setHeader("content-type", "text/html; charset=utf-8").setHeader("cache-control", "no-store")
        .setHeader("content-security-policy", `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors ${frameAncestors}`)
        .send(previewErrorPage(previewErrorCode(error), appOrigin));
      return;
    }
    response.status(502).setHeader("cache-control", "no-store").send("Preview temporarily unavailable");
  }
}
