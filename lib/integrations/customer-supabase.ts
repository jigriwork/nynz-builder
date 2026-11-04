/**
 * Customer-owned Supabase checks, using only the project URL and the
 * browser-safe publishable/anon key the customer supplies. NYNZ never holds a
 * customer's service-role key or personal access token, so it cannot apply
 * migrations itself; it validates the connection and verifies the result.
 */
export function isPrivilegedKey(key: string) {
  if (key.startsWith("sb_secret_")) return true;
  const part = key.split(".")[1];
  if (!part) return false;
  try { const payload = JSON.parse(Buffer.from(part, "base64url").toString()); return payload.role === "service_role" || payload.role === "supabase_admin"; } catch { return false; }
}

export function normalizeProjectUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)) throw new Error("Expected https://<project-ref>.supabase.co");
  return url.origin;
}

export async function validateConnection(projectUrl: string, key: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${projectUrl}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 401 || response.status === 403) return { ok: false as const, reason: "This key was not accepted by that Supabase project." };
  if (!response.ok) return { ok: false as const, reason: `The Supabase project did not respond normally (HTTP ${response.status}).` };
  const settings = await response.json().catch(() => ({}));
  return { ok: true as const, details: { email_auth: Boolean(settings?.external?.email), signup_disabled: Boolean(settings?.disable_signup), mailer_autoconfirm: Boolean(settings?.mailer_autoconfirm) } };
}

/** 200 = table reachable through the Data API (RLS may still return no rows); 404 = missing. */
export async function checkTables(projectUrl: string, key: string, tables: string[], fetcher: typeof fetch = fetch) {
  const out: Array<{ table: string; status: "present" | "missing" | "blocked" | "error"; http: number }> = [];
  for (const table of tables) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(table)) { out.push({ table, status: "error", http: 0 }); continue; }
    const response = await fetcher(`${projectUrl}/rest/v1/${table}?select=*&limit=0`, { headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    out.push({ table, http: response.status, status: response.ok ? "present" : response.status === 404 ? "missing" : response.status === 401 || response.status === 403 ? "blocked" : "error" });
  }
  return out;
}

/** Table names created by reviewed migration SQL (best effort, for verification only). */
export function tablesInSql(sql: string) {
  return [...new Set([...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1].toLowerCase()))];
}
