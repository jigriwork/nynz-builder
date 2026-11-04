import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { json, requireProject } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { apiError, dbError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";
import { RESERVE, admitPaidWork } from "@/lib/billing/entitlements";
import { attachDomainToHost, domainHasToken, publishingConfig } from "@/lib/integrations/publishing";
import { slugFor } from "@/preview-host/lib/sites";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const config = publishingConfig();
  const [{ data: site }, { data: deployments }, { data: domains }] = await Promise.all([
    auth.supabase.from("published_sites").select("slug,status,active_deployment_id,updated_at").eq("project_id", id).maybeSingle(),
    auth.supabase.from("deployments").select("id,status,file_count,total_bytes,error,created_at,ready_at,source_revision").eq("project_id", id).order("created_at", { ascending: false }).limit(10),
    auth.supabase.from("custom_domains").select("id,hostname,status,verification_token,error,verified_at").eq("project_id", id),
  ]);
  return json({
    available: Boolean(config), reason: config ? null : "Publishing is not available yet: NYNZ's site domain has not been configured.",
    url: config && site?.status === "live" ? `https://${site.slug}.${config.suffix}` : null, site, deployments: deployments || [],
    domains: (domains || []).map((d) => ({ ...d, dns: { type: "TXT", name: `_nynz-verify.${d.hostname}`, value: `nynz-verify=${d.verification_token}` }, cname: config ? { type: "CNAME", name: d.hostname, value: `sites.${config.suffix}` } : null })),
  });
}

const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish") }),
  z.object({ action: z.literal("rollback"), deploymentId: z.string().uuid() }),
  z.object({ action: z.literal("unpublish") }),
  z.object({ action: z.literal("add_domain"), hostname: z.string().trim().toLowerCase().max(253) }),
  z.object({ action: z.literal("verify_domain"), domainId: z.string().uuid() }),
  z.object({ action: z.literal("remove_domain"), domainId: z.string().uuid() }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireProject(id);
  if ("error" in auth) return auth.error;
  const parsed = actions.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Invalid publishing request");
  const limited = await rateLimit(`publish:${auth.user.id}`, 30, 3600);
  if (limited) return limited;
  const config = publishingConfig();
  const admin = createAdmin();
  const input = parsed.data;
  if (input.action === "publish") {
    if (!config) return apiError("SERVICE_UNAVAILABLE", "Publishing is not available yet. Nothing was charged.");
    const { count } = await admin.from("project_files").select("path", { count: "exact", head: true }).eq("project_id", id);
    if (!count) return apiError("CONFLICT", "Build your app before publishing it.");
    const { data: active } = await admin.from("build_jobs").select("id").eq("project_id", id).in("status", ["queued", "planning", "generating", "installing", "running", "validating"]).limit(1).maybeSingle();
    if (active) return apiError("CONFLICT", "Wait for the current build to finish before publishing.");
    await admin.from("published_sites").upsert({ project_id: id, owner_id: auth.user.id, slug: slugFor(auth.project.name, id), status: "publishing" }, { onConflict: "project_id", ignoreDuplicates: false });
    const buildId = randomUUID();
    const refused = await admitPaidWork(admin, { userId: auth.user.id, projectId: id, buildId, credits: RESERVE.restart() });
    if (refused) return refused;
    const { error } = await admin.from("build_jobs").insert({ id: buildId, project_id: id, requested_by: auth.user.id, prompt: "Publish the current version.", mode: "publish", idempotency_key: `publish-${buildId}` });
    if (error) { await admin.rpc("settle_reservation", { p_build: buildId, p_reason: "not queued" }); return apiError("CONFLICT", "A build or publish is already running."); }
    return json({ queued: true, buildId }, { status: 202 });
  }
  if (input.action === "rollback") { const { error } = await auth.supabase.rpc("rollback_deployment", { p_project: id, p_deployment: input.deploymentId }); return error ? dbError(error, "publish") : json({ ok: true }); }
  if (input.action === "unpublish") { const { error } = await auth.supabase.rpc("unpublish_site", { p_project: id }); return error ? dbError(error, "publish") : json({ ok: true }); }
  if (input.action === "add_domain") {
    if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(input.hostname) || (config && input.hostname.endsWith(config.suffix)) || /(^|\.)nynz\.in$/.test(input.hostname)) return apiError("INVALID_INPUT", "Enter a domain you own, such as app.example.com");
    const { error } = await admin.from("custom_domains").insert({ project_id: id, hostname: input.hostname, verification_token: randomBytes(16).toString("hex") });
    return error ? apiError("CONFLICT", "That domain is already connected to a project.") : json({ ok: true }, { status: 201 });
  }
  const { data: domain } = await admin.from("custom_domains").select("*").eq("id", input.domainId).eq("project_id", id).maybeSingle();
  if (!domain) return apiError("NOT_FOUND", "Domain not found");
  if (input.action === "remove_domain") { await admin.from("custom_domains").delete().eq("id", domain.id); return json({ ok: true }); }
  const verified = await domainHasToken(domain.hostname, domain.verification_token);
  if (!verified) { await admin.from("custom_domains").update({ last_checked_at: new Date().toISOString(), error: "Verification record not found yet" }).eq("id", domain.id); return apiError("CONFLICT", "We could not find the verification TXT record yet. DNS changes can take a while to appear."); }
  const attached = config ? await attachDomainToHost(domain.hostname, config.vercel) : { ok: false as const, reason: "Publishing is not configured." };
  await admin.from("custom_domains").update({ status: attached.ok ? "active" : "verified", verified_at: new Date().toISOString(), last_checked_at: new Date().toISOString(), error: attached.ok ? null : attached.reason }).eq("id", domain.id);
  return json({ ok: true, active: attached.ok, note: attached.ok ? "Domain verified. TLS is issued by the hosting provider once the CNAME points to NYNZ." : attached.reason });
}
