import { getPreviewOrigin } from "./session";
import type { SupabaseClient } from "@supabase/supabase-js";

type Env = Record<string, string | undefined>;
const ready = new Map<string, number>();

/** Only called after project ownership is checked. The dedicated credential
 * belongs to the private preview project, never to publishing or the browser.
 * DNS is a Hostinger wildcard CNAME; Vercel issues individual certificates.
 */
export async function ensurePreviewRegistered(projectId: string, env: Env = process.env, request: typeof fetch = fetch) {
  if (env.NODE_ENV !== "production" && !env.PREVIEW_VERCEL_PROJECT_ID) return;
  const origin = getPreviewOrigin(projectId);
  const host = new URL(origin).hostname;
  if (!env.PREVIEW_VERCEL_PROJECT_ID || !env.PREVIEW_VERCEL_TOKEN) throw new Error("Preview registration is not configured");
  if (request === fetch && (ready.get(host) || 0) > Date.now()) return;
  const endpoint = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(env.PREVIEW_VERCEL_PROJECT_ID)}/domains/${host}`);
  if (env.PREVIEW_VERCEL_TEAM_ID) endpoint.searchParams.set("teamId", env.PREVIEW_VERCEL_TEAM_ID);
  const headers = { authorization: `Bearer ${env.PREVIEW_VERCEL_TOKEN}`, "content-type": "application/json" };
  let response = await request(endpoint, { headers, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (response.status === 404) {
    endpoint.pathname = `/v10/projects/${encodeURIComponent(env.PREVIEW_VERCEL_PROJECT_ID)}/domains`;
    response = await request(endpoint, { method: "POST", headers, body: JSON.stringify({ name: host }), signal: AbortSignal.timeout(10_000) });
    // Another instance may have registered the same project concurrently.
    if (response.status === 409) {
      endpoint.pathname = `/v9/projects/${encodeURIComponent(env.PREVIEW_VERCEL_PROJECT_ID)}/domains/${host}`;
      response = await request(endpoint, { headers, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    }
  }
  if (!response.ok) throw new Error(`Preview registration unavailable (${response.status})`);
  const domain = await response.json() as { name?: string; verified?: boolean; projectId?: string };
  if (domain.name !== host || !domain.verified || domain.projectId !== env.PREVIEW_VERCEL_PROJECT_ID) throw new Error("Preview domain is not verified on its hosting project");
  // A verified domain can still be awaiting its certificate. TLS validation is
  // strict; fail before reserving credits or queueing work until HTTPS works.
  const probe = await request(origin, { redirect: "manual", signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (probe.status !== 401 || (await probe.text()).trim() !== "Preview authorization required") throw new Error("Preview HTTPS is not ready; retry shortly");
  if (ready.size >= 500) ready.clear();
  if (request === fetch) ready.set(host, Date.now() + 300_000);
}

export async function removePreviewDomain(host: string, env: Env = process.env) {
  const suffix = new URL(getPreviewOrigin("00000000-0000-4000-8000-000000000000")).hostname.split(".").slice(1).join(".");
  if (!/^[0-9a-f-]{36}\./.test(host) || host.split(".").slice(1).join(".") !== suffix || !env.PREVIEW_VERCEL_PROJECT_ID || !env.PREVIEW_VERCEL_TOKEN) throw new Error("Invalid preview cleanup configuration");
  const endpoint = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(env.PREVIEW_VERCEL_PROJECT_ID)}/domains/${host}`);
  if (env.PREVIEW_VERCEL_TEAM_ID) endpoint.searchParams.set("teamId",env.PREVIEW_VERCEL_TEAM_ID);
  const result = await fetch(endpoint,{method:"DELETE",headers:{authorization:`Bearer ${env.PREVIEW_VERCEL_TOKEN}`},signal:AbortSignal.timeout(10_000)});
  if (!result.ok && result.status!==404) throw new Error(`Preview cleanup unavailable (${result.status})`);
  ready.delete(host);
}

export async function prepareProjectPreview(db: SupabaseClient, projectId: string, userId: string) {
  if (process.env.NODE_ENV !== "production" && !process.env.PREVIEW_VERCEL_PROJECT_ID) return;
  const host = new URL(getPreviewOrigin(projectId)).hostname;
  const before = await db.rpc("register_preview_domain",{p_project:projectId,p_user:userId,p_host:host,p_ready:false});
  if (before.error) throw before.error;
  await ensurePreviewRegistered(projectId);
  const after = await db.rpc("register_preview_domain",{p_project:projectId,p_user:userId,p_host:host,p_ready:true});
  if (after.error) {
    // A deletion that races certificate issuance must not leave an attachment.
    await removePreviewDomain(host);
    throw after.error;
  }
}
