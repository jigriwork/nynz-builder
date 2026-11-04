import { lookup } from "node:dns/promises";
import FirecrawlApp from "@mendable/firecrawl-js";
import { z } from "zod";
import { json, requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { assertPublicHttpUrl, privateIp } from "@/lib/platform/security";
import { apiError, logServerError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";
import { firecrawlPagePaise } from "@/lib/billing/pricing";

async function resolvePublic(raw: string) {
  const url = assertPublicHttpUrl(raw);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => privateIp(a.address))) throw new Error("URL resolves to a private address");
  return url;
}

/** Imports one public page as untrusted reference text. Provider details never reach the customer. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const parsed = z.object({ url: z.string().max(2048) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Enter a valid URL");
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return apiError("SERVICE_UNAVAILABLE", "Website import is temporarily unavailable.");
  const limited = await rateLimit(`import:${auth.user.id}`, 10, 3600);
  if (limited) return limited;
  const admin = createAdmin();
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const { data: dailyUsage } = await auth.supabase.from("usage_events").select("quantity").eq("kind", "firecrawl_pages").gte("created_at", today.toISOString());
  if ((dailyUsage || []).reduce((sum, x) => sum + Number(x.quantity), 0) >= Number(process.env.DAILY_FIRECRAWL_PAGE_LIMIT || 25)) return apiError("RATE_LIMITED", "Daily website research limit reached");
  let url: URL;
  try { url = await resolvePublic(parsed.data.url); } catch (error) { return apiError("INVALID_INPUT", error instanceof Error && /private|local|credentials|HTTP|valid/.test(error.message) ? error.message : "That address cannot be imported"); }
  const estimate = firecrawlPagePaise(1);
  const eventKey = `firecrawl:${id}:${crypto.randomUUID()}`;
  const spend = await admin.rpc("authorize_provider_spend", { p_provider: "firecrawl", p_kind: "scrape", p_model: null, p_estimate: estimate, p_build: null, p_user: auth.user.id, p_event_key: eventKey });
  if (spend.error) return apiError("SERVICE_UNAVAILABLE", "Website import is temporarily unavailable.", { cause: spend.error, scope: "import" });
  const { data: record, error: insertError } = await admin.from("website_imports").insert({ project_id: id, requested_by: auth.user.id, source_url: url.toString() }).select().single();
  if (insertError) return apiError("INTERNAL", "Could not start the import", { cause: insertError, scope: "import" });
  try {
    const app = new FirecrawlApp({ apiKey: key });
    const result: any = await app.scrape(url.toString(), { formats: ["markdown"], onlyMainContent: true, timeout: 30_000 });
    if (result?.success === false) throw new Error(String(result.error || "scrape failed"));
    const data = result.data || result;
    const finalUrl = data?.metadata?.sourceURL || data?.metadata?.url;
    if (finalUrl) await resolvePublic(finalUrl);
    const markdown = String(data?.markdown || "").slice(0, 200_000);
    const title = String(data?.metadata?.title || url.hostname).slice(0, 300);
    await admin.from("website_imports").update({ status: "complete", title, markdown, page_count: 1 }).eq("id", record.id);
    await admin.from("usage_events").insert({ owner_id: auth.user.id, project_id: id, kind: "firecrawl_pages", quantity: 1, provider: "firecrawl", estimated_cost_minor: estimate, metadata: { import_id: record.id, cost_source: "estimate" } });
    await admin.rpc("settle_provider_spend", { p_id: spend.data, p_actual: estimate, p_source: "estimate" });
    return json({ import: { id: record.id, title, url: url.toString(), markdown } });
  } catch (error) {
    // A failed scrape may still have been billed by the provider: keep the estimate against the cap.
    await admin.rpc("settle_provider_spend", { p_id: spend.data, p_actual: estimate, p_source: "estimate_failed_call" });
    const ref = logServerError("import", error);
    await admin.from("website_imports").update({ status: "failed", error_message: `Import failed (ref ${ref})` }).eq("id", record.id);
    return apiError("SERVICE_UNAVAILABLE", "We couldn't import that page. Check the address or try another page.", { extra: { ref } });
  }
}
