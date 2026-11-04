import { resolveTxt } from "node:dns/promises";

/** Live publishing needs a wildcard site domain on the preview/site host project. */
export function publishingConfig(env: Record<string, string | undefined> = process.env) {
  const suffix = (env.PUBLISH_SITES_SUFFIX || "").toLowerCase();
  return suffix && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(suffix) ? { suffix, vercel: env.VERCEL_API_TOKEN && env.VERCEL_SITES_PROJECT_ID ? { token: env.VERCEL_API_TOKEN, projectId: env.VERCEL_SITES_PROJECT_ID, teamId: env.VERCEL_TEAM_ID } : null } : null;
}

export async function domainHasToken(hostname: string, token: string) {
  try {
    const records = await resolveTxt(`_nynz-verify.${hostname}`);
    return records.some((parts) => parts.join("") === `nynz-verify=${token}`);
  } catch { return false; }
}

/** Adds a verified custom domain to the site host project so Vercel issues TLS. */
export async function attachDomainToHost(hostname: string, config: NonNullable<ReturnType<typeof publishingConfig>>["vercel"]) {
  if (!config) return { ok: false as const, reason: "Domain attachment is not configured (VERCEL_API_TOKEN and VERCEL_SITES_PROJECT_ID)." };
  const url = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(config.projectId)}/domains`);
  if (config.teamId) url.searchParams.set("teamId", config.teamId);
  const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: JSON.stringify({ name: hostname }), signal: AbortSignal.timeout(15_000) });
  if (response.ok || response.status === 409) return { ok: true as const };
  return { ok: false as const, reason: `Hosting provider refused the domain (HTTP ${response.status}).` };
}
