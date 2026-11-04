/**
 * Provider balances and quotas, fetched only from documented provider APIs
 * (checked 2026-11-04). Nothing is estimated or invented here:
 *  - OpenRouter: GET /api/v1/credits needs a *management* key
 *    (OPENROUTER_MANAGEMENT_KEY); GET /api/v1/key reports the generation key's
 *    own usage and limit.
 *  - Firecrawl: GET /v2/team/credit-usage returns remaining team credits.
 *  - E2B, Sarvam, Supabase, Vercel, Render: no balance API is used; balances
 *    and invoices are entered manually with a date in Admin → Providers.
 */
export type ProviderBalance = {
  provider: string; status: "ok" | "not_configured" | "unavailable" | "error";
  balance?: number; currency?: string; usage?: number; quota?: Record<string, unknown>; note: string;
};

async function getJson(url: string, key: string) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function fetchProviderBalances(env: Record<string, string | undefined> = process.env): Promise<ProviderBalance[]> {
  const out: ProviderBalance[] = [];
  if (env.OPENROUTER_MANAGEMENT_KEY) {
    try {
      const body = await getJson("https://openrouter.ai/api/v1/credits", env.OPENROUTER_MANAGEMENT_KEY);
      const total = Number(body?.data?.total_credits), used = Number(body?.data?.total_usage);
      out.push({ provider: "openrouter", status: "ok", balance: total - used, usage: used, currency: "USD", note: "Account credits remaining (total purchased minus total used)" });
    } catch (error) { out.push({ provider: "openrouter", status: "error", note: `Balance request failed: ${(error as Error).message}` }); }
  } else if (env.OPENROUTER_API_KEY) {
    try {
      const body = await getJson("https://openrouter.ai/api/v1/key", env.OPENROUTER_API_KEY);
      const d = body?.data || {};
      out.push({ provider: "openrouter", status: "ok", usage: Number(d.usage), currency: "USD", balance: d.limit_remaining == null ? undefined : Number(d.limit_remaining), quota: { key_limit: d.limit ?? null, limit_remaining: d.limit_remaining ?? null }, note: "Generation key usage and key limit. Account balance needs OPENROUTER_MANAGEMENT_KEY." });
    } catch (error) { out.push({ provider: "openrouter", status: "error", note: `Key usage request failed: ${(error as Error).message}` }); }
  } else out.push({ provider: "openrouter", status: "not_configured", note: "OPENROUTER_API_KEY is not set" });

  if (env.FIRECRAWL_API_KEY) {
    try {
      const body = await getJson("https://api.firecrawl.dev/v2/team/credit-usage", env.FIRECRAWL_API_KEY);
      out.push({ provider: "firecrawl", status: "ok", balance: Number(body?.data?.remainingCredits), currency: "FIRECRAWL_CREDITS", quota: { plan_credits: body?.data?.planCredits ?? null, period_end: body?.data?.billingPeriodEnd ?? null }, note: "Remaining team credits" });
    } catch (error) { out.push({ provider: "firecrawl", status: "error", note: `Credit request failed: ${(error as Error).message}` }); }
  } else out.push({ provider: "firecrawl", status: "not_configured", note: "FIRECRAWL_API_KEY is not set" });

  out.push({ provider: "e2b", status: env.E2B_API_KEY ? "unavailable" : "not_configured", note: env.E2B_API_KEY ? "No balance API; enter the dashboard balance manually" : "E2B_API_KEY is not set" });
  for (const provider of ["supabase", "vercel", "render"]) out.push({ provider, status: "unavailable", note: "Record invoices as expenses; no balance API is used" });
  return out;
}
