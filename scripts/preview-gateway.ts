/**
 * Local development preview gateway. It runs the same proxy core as the
 * deployed preview host (preview-host/lib/core.ts), so local behaviour matches
 * production: one-time exchange, host-bound cookie, per-request database
 * authorisation and private E2B traffic tokens.
 */
import "dotenv/config";
import { config } from "dotenv";
import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import { e2bConnector, handlePreview } from "../preview-host/lib/core";
import { redactPreviewUrl } from "../lib/preview/token";
import { sessionExtensionArgs } from "../preview-host/lib/runtime";

config({ path: ".env.local", quiet: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const e2bApiKey = process.env.E2B_API_KEY;
if (!supabaseUrl || !serviceRoleKey || !e2bApiKey) throw new Error("Preview gateway configuration is incomplete");

const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const port = Number(process.env.PREVIEW_GATEWAY_PORT || 3001);
const appOrigin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const activeSeconds = Math.max(60, Math.min(Number(process.env.E2B_PREVIEW_ACTIVE_SECONDS || 600), 3_600));
const connectSandbox = e2bConnector(e2bApiKey, activeSeconds, async (sandbox, project, user) => {
  const admitted = await db.rpc("extend_sandbox_session", sessionExtensionArgs(sandbox, project, user, activeSeconds));
  if (admitted.error) throw new Error("Preview runtime is unavailable or its allowance has been reached");
});

async function readBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  return body.length ? body.buffer.slice(body.byteOffset, body.byteOffset + body.length) as ArrayBuffer : undefined;
}

const server = http.createServer(async (request, response) => {
  try {
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(request.headers)) headers[key] = Array.isArray(value) ? value.join(", ") : value;
    const result = await handlePreview({ method: request.method || "GET", host: request.headers.host || "", url: request.url || "/", headers, body: await readBody(request) }, {
      rpc: async (fn, args) => { const { data, error } = await db.rpc(fn, args); return { data, error }; },
      insertNonce: async (jti, projectId) => !(await db.from("preview_exchange_nonces").insert({ jti, project_id: projectId })).error,
      connectSandbox, appOrigin, frameAncestors: appOrigin,
    });
    response.writeHead(result.status, result.headers);
    response.end(typeof result.body === "string" ? result.body : result.body ? Buffer.from(result.body) : undefined);
  } catch (error) {
    console.error(`[preview-gateway] ${redactPreviewUrl(error instanceof Error ? error.message : "Request failed")}`);
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain", "cache-control": "no-store" });
    response.end("Preview temporarily unavailable");
  }
});

server.listen(port, "0.0.0.0", () => console.log(`[NYNZ preview gateway] listening on ${port}`));
