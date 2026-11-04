/**
 * One real, paid create-and-edit journey in the owner's own session, run
 * only after the ₹50 combined cap and the owner testing allowance exist.
 * Every provider call is pre-authorised against that cap by the worker.
 * Uses a new verification project; existing projects are never touched.
 *
 *   NYNZ_OWNER_PROFILE=… tsx scripts/ops/verify-live-journey.ts
 */
import "dotenv/config";
import { config } from "dotenv";
import JSZip from "jszip";
import { createClient } from "@supabase/supabase-js";
import { Sandbox } from "e2b";
import type { Page } from "playwright-core";
import { BASE, ownerContext, whoAmI } from "./owner-browser";

config({ path: ".env.local", quiet: true });
const OWNER_ID = "41080a24-57a9-4686-8d53-c0a3a9e09588";
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const results: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ([p, m, b]) => {
    const r = await fetch(p as string, { method: m as string, headers: b ? { "content-type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined });
    const type = r.headers.get("content-type") || "";
    return { status: r.status, body: type.includes("json") ? await r.json() : null };
  }, [path, method, body] as const);
}
async function waitBuild(id: string, until: (b: any) => boolean, minutes: number) {
  const deadline = Date.now() + minutes * 60_000;
  while (Date.now() < deadline) {
    const { data } = await service.from("build_jobs").select("*").eq("id", id).single();
    if (data && until(data)) return data;
    if (data && ["failed", "cancelled"].includes(data.status)) return data;
    await sleep(5000);
  }
  return (await service.from("build_jobs").select("*").eq("id", id).single()).data;
}
async function spentPaise(since: string) {
  const { data } = await service.from("provider_spend").select("estimated_paise,actual_paise,status,provider").gte("created_at", since);
  return (data || []).filter((r) => r.status !== "voided").reduce((s, r) => s + Number(r.actual_paise ?? r.estimated_paise), 0);
}

async function main() {
  const started = new Date().toISOString();
  const { data: cap } = await service.from("spend_limits").select("*").eq("active", true).eq("period", "window").eq("limit_paise", 5000).is("provider", null).lte("window_start", started).gte("window_end", started).maybeSingle();
  if (!cap) { check("₹50 combined cap is active before any paid call", false, "missing: refusing to start"); return; }
  check("₹50 combined cap is active before any paid call", true, cap.name);
  const context = await ownerContext(true);
  const me = await whoAmI(context);
  if (me.email !== "adib@nynz.in") { check("owner session", false, me.email); return; }
  const page = await context.newPage();
  await page.goto(`${BASE}/dashboard`);
  const before = (await service.rpc("credit_balance", { p_user: OWNER_ID })).data;

  const created = await api(page, "/api/projects", "POST", { name: "Release verification calculator", description: "Temporary project for release verification" });
  check("create project", created.status === 201, String(created.status));
  const projectId = created.body.project.id as string;
  // 1x1 PNG asset
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const upload = await page.evaluate(async ([id, b64]) => {
    const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
    const form = new FormData(); form.set("file", new File([bytes], "logo.png", { type: "image/png" }));
    const r = await fetch(`/api/projects/${id}/assets`, { method: "POST", body: form }); return { status: r.status, body: await r.json() };
  }, [projectId, png.toString("base64")] as const);
  check("upload image asset", upload.status === 201, upload.body?.asset?.appPath || String(upload.status));
  const spoof = await page.evaluate(async (id) => { const form = new FormData(); form.set("file", new File([new TextEncoder().encode("MZ not an image")], "x.png", { type: "image/png" })); return (await fetch(`/api/projects/${id}/assets`, { method: "POST", body: form })).status; }, projectId);
  check("spoofed image upload is rejected", spoof === 400);

  const brief = "Build a minimal single-page tip calculator called Tipwise. Inputs for bill amount and tip percent (10, 15, 20 buttons), shows tip and total. Show the uploaded logo at /uploads/logo.png in the header. Plain CSS, no backend.";
  const queued = await api(page, `/api/projects/${projectId}/builds`, "POST", { prompt: brief, mode: "create", idempotencyKey: `verify-create-${Date.now()}` });
  check("queue create request (credits reserved)", queued.status === 202, String(queued.status));
  let job = await waitBuild(queued.body.build.id, (b) => b.plan?.approval === "awaiting", 6);
  check("plan ready for approval, no code written", job?.plan?.approval === "awaiting" && Array.isArray(job.plan.steps), `${job?.status} ${job?.plan?.steps?.length || 0} steps`);
  if (job?.plan?.approval !== "awaiting") return context.close();
  const { count: filesBefore } = await service.from("project_files").select("path", { count: "exact", head: true }).eq("project_id", projectId);
  check("no files exist before approval", filesBefore === 0);
  const approved = await api(page, `/api/projects/${projectId}/builds`, "PATCH", { action: "approve", buildId: job.id, revision: job.plan.revision, summary: job.plan.summary, steps: job.plan.steps });
  check("approve plan", approved.status === 202, `${approved.status} ${approved.body?.error || ""}`);
  job = await waitBuild(job.id, (b) => b.status === "succeeded", 20);
  check("generation, install, production build and preview succeed", job?.status === "succeeded", `${job?.status} ${job?.error_code || ""}`);
  const createSpend = await spentPaise(started);
  check("spend after create is within the ₹50 cap", createSpend <= 5000, `₹${(createSpend / 100).toFixed(2)}`);
  if (job?.status !== "succeeded") return context.close();

  const { data: files } = await service.from("project_files").select("path,content").eq("project_id", projectId);
  check("generated source references the uploaded logo", (files || []).some((f) => f.content.includes("/uploads/logo.png")));
  const session = await api(page, `/api/projects/${projectId}/preview-session`, "POST");
  check("authorised preview session issued", session.status === 200, String(session.status));
  const preview = await context.newPage();
  const opened = await preview.goto(session.body.url, { waitUntil: "networkidle" });
  check("exchange link redirects to a clean preview URL", !preview.url().includes("t=") && opened?.status() === 200, preview.url());
  const body = await preview.locator("body").innerText();
  check("preview renders the generated app", /tip/i.test(body), body.slice(0, 80).replace(/\s+/g, " "));
  const button = preview.getByRole("button", { name: /15/ }).first();
  if (await button.isVisible().catch(() => false)) { await button.click(); check("preview responds to interaction", true); } else check("preview responds to interaction", false, "no 15% button");
  const reused = await (await context.newPage()).goto(session.body.url);
  check("used exchange link cannot be replayed", reused?.status() === 401, String(reused?.status()));
  await preview.reload({ waitUntil: "networkidle" });
  check("preview survives refresh with the cookie session", /tip/i.test(await preview.locator("body").innerText()));

  const editStart = new Date().toISOString();
  const edit = await api(page, `/api/projects/${projectId}/builds`, "POST", { prompt: "Change the main heading text to exactly: NYNZ Verified Tipwise", mode: "edit", idempotencyKey: `verify-edit-${Date.now()}` });
  let editJob = await waitBuild(edit.body.build.id, (b) => b.plan?.approval === "awaiting", 6);
  const editApproved = await api(page, `/api/projects/${projectId}/builds`, "PATCH", { action: "approve", buildId: editJob.id, revision: editJob.plan.revision, summary: editJob.plan.summary, steps: editJob.plan.steps });
  check("edit plan approved", editApproved.status === 202, String(editApproved.status));
  editJob = await waitBuild(editJob.id, (b) => b.status === "succeeded", 15);
  check("edit succeeds", editJob?.status === "succeeded", `${editJob?.status} ${editJob?.error_code || ""}`);
  await preview.reload({ waitUntil: "networkidle" });
  check("reopened preview shows the edited app", /NYNZ Verified Tipwise/.test(await preview.locator("body").innerText()));

  // Controlled failure: a deliberately broken file + restart must not replace the working preview.
  const { data: project1 } = await service.from("projects").select("active_sandbox_id,active_version_id,preview_revision").eq("id", projectId).single();
  const app = (await api(page, `/api/projects/${projectId}/files`)).body.files.find((f: any) => f.path === "src/App.tsx");
  const broke = await api(page, `/api/projects/${projectId}/files`, "PUT", { files: [{ path: "src/App.tsx", content: "export default function App( {", baseHash: app.content_hash }] });
  check("controlled failure: broken file saved", broke.status === 200);
  const restart = await api(page, `/api/projects/${projectId}/sandbox`, "POST");
  const failed = await waitBuild(restart.body.build.id, (b) => ["failed", "succeeded"].includes(b.status), 10);
  const { data: project2 } = await service.from("projects").select("active_sandbox_id,active_version_id,preview_revision,status").eq("id", projectId).single();
  check("broken build fails", failed?.status === "failed", `${failed?.status} ${failed?.error_code || ""}`);
  check("previous working preview and version are kept", project2?.active_sandbox_id === project1?.active_sandbox_id && project2?.active_version_id === project1?.active_version_id && project2?.status === "ready");
  await preview.reload({ waitUntil: "networkidle" });
  check("previous app still serves", /NYNZ Verified Tipwise/.test(await preview.locator("body").innerText()));
  const versions = (await api(page, `/api/projects/${projectId}/versions`)).body;
  const restored = await api(page, `/api/projects/${projectId}/versions/${versions.activeVersionId}/restore`, "POST", { expectedRevision: (await service.from("projects").select("source_revision").eq("id", projectId).single()).data!.source_revision });
  check("restore the last working version", restored.status === 200, String(restored.status));

  const zipResponse = await page.evaluate(async (id) => { const r = await fetch(`/api/projects/${id}/export`); return { status: r.status, b64: btoa(String.fromCharCode(...new Uint8Array(await r.arrayBuffer()))) }; }, projectId);
  const zip = await JSZip.loadAsync(Buffer.from(zipResponse.b64, "base64"));
  const names = Object.keys(zip.files);
  check("export contains source, uploaded asset and readme, no env files", zipResponse.status === 200 && names.includes("src/App.tsx") && names.includes("public/uploads/" + upload.body.asset.storageName) && (names.includes("README.md") || names.includes("NYNZ_EXPORT.md")) && !names.some((n) => /\.env/.test(n)), `${names.length} entries`);

  const builds = [queued.body.build.id, edit.body.build.id, restart.body.build.id];
  const { data: ledger } = await service.from("credit_ledger").select("entry_type,amount,build_id,cost_paise,cost_source").in("build_id", builds);
  const { data: reservations } = await service.from("credit_reservations").select("status,amount,consumed").in("build_id", builds);
  const after = (await service.rpc("credit_balance", { p_user: OWNER_ID })).data;
  const consumed = -(ledger || []).filter((l) => l.entry_type === "consume").reduce((s, l) => s + Number(l.amount), 0);
  check("credits consumed from measured cost and recorded per build", consumed > 0 && (ledger || []).some((l) => l.cost_source === "provider_reported"), `${consumed} credits`);
  check("every reservation settled or released", (reservations || []).every((r) => r.status !== "active"), JSON.stringify(reservations));
  check("owner balance reflects consumption", Number(before.available) - Number(after.available) === consumed, `${before.available} → ${after.available}`);
  const total = await spentPaise(started);
  check("total provider spend within ₹50", total <= 5000, `₹${(total / 100).toFixed(2)} (create ₹${(createSpend / 100).toFixed(2)}, edit and failure ₹${((total - createSpend) / 100).toFixed(2)})`);
  console.log(`SPEND_SINCE ${started} paise=${total} edit_since=${editStart}`);

  // Cleanup of this verification project only, then confirm resources are gone.
  const { data: sandboxes } = await service.from("platform_resources").select("provider_ref,state").eq("project_id", projectId).eq("kind", "e2b_sandbox");
  const deleted = await api(page, `/api/projects/${projectId}`, "DELETE");
  check("delete the verification project", deleted.status === 204);
  const deadline = Date.now() + 8 * 60_000;
  let live: string[] = [];
  while (Date.now() < deadline) {
    const all: string[] = []; const p = Sandbox.list({ apiKey: process.env.E2B_API_KEY });
    while (p.hasNext) all.push(...(await p.nextItems()).map((s) => s.sandboxId));
    live = (sandboxes || []).map((s) => s.provider_ref).filter((id) => all.includes(id));
    if (!live.length) break;
    await sleep(30_000);
  }
  check("all of this project's sandboxes are terminated at E2B", live.length === 0, `${(sandboxes || []).length} created, ${live.length} still live`);
  const { data: storage } = await service.storage.from("project-assets").list(projectId);
  check("project asset storage removed", !(storage || []).some((o) => o.id));
  await context.close();
}

main().catch((error) => check("run", false, error instanceof Error ? error.message : String(error)))
  .finally(() => { console.log(`\n${results.filter((r) => r[1]).length}/${results.length} checks passed`); process.exit(results.every((r) => r[1]) ? 0 : 1); });
