/**
 * Request-origin protection for browser requests that change data. Sign-in
 * cookies are SameSite=Lax, which does not stop pages on other nynz.in
 * subdomains (previews, published sites) from sending them. A data-changing
 * API request is refused when the browser says it came from another origin.
 * Non-browser clients send neither header and are unaffected; signed
 * webhooks are exempt.
 */
const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const EXEMPT = ["/api/webhooks/razorpay"];

export function allowedOrigins(host: string | null, proto: string, env: Record<string, string | undefined> = process.env) {
  const out = new Set<string>();
  if (host) out.add(`${proto}//${host}`);
  for (const value of [env.NEXT_PUBLIC_APP_URL, env.NEXT_PUBLIC_SITE_URL]) { try { if (value) out.add(new URL(value).origin); } catch { /* ignore */ } }
  return out;
}

/** Returns a reason when the request must be refused, otherwise null. */
export function crossOriginWrite(input: { method: string; path: string; origin: string | null; secFetchSite: string | null; allowed: Set<string> }) {
  if (!WRITE.has(input.method.toUpperCase()) || !input.path.startsWith("/api/") || EXEMPT.includes(input.path)) return null;
  if (input.origin) return input.origin !== "null" && input.allowed.has(input.origin) ? null : `origin ${input.origin}`;
  if (input.secFetchSite && !["same-origin", "none"].includes(input.secFetchSite)) return `fetch site ${input.secFetchSite}`;
  return null;
}
