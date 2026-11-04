import "dotenv/config";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generateApplication, generationReadiness } from "../lib/platform/generation";
import { buildArtifactInE2B, listNynzSandboxes, runInE2B, stopE2B } from "../lib/platform/e2b";
import { createHash } from "node:crypto";
import { MAX_ARTIFACT_BYTES, MAX_ARTIFACT_FILES, contentType, validateArtifact } from "../preview-host/lib/sites";
import { getPreviewOrigin } from "../lib/preview/session";
import { redact } from "../lib/platform/redact";
import { planApplication } from "../lib/platform/openrouter";
import { BuildMeter } from "../lib/billing/meter";
import { BudgetError } from "../lib/billing/budget-error";
import { reconcileResources } from "../lib/platform/reconcile";
import { previewKeys } from "../lib/preview/token";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Worker requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const worker = process.env.WORKER_ID || `worker-${process.pid}`;
// Leases are owned by this process instance, so a restarted or overlapping
// instance with the same WORKER_ID can never write to a job it did not claim.
const lockOwner = `${worker}:${randomUUID().slice(0, 8)}`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let shuttingDown = false;
let currentBuildId: string | null = null;
let heartbeatBusy = false;

type SourceFile = { path: string; content: string };
type Job = { id: string; project_id: string; requested_by: string; conversation_id: string | null; prompt: string; mode: "create" | "edit" | "restart" | "publish"; plan: any; progress: any[]; generation_complete?: boolean; cancel_requested_at?: string | null };

function safeError(error: unknown) {
  const raw = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error);
  return redact(raw).slice(0, 1000);
}

/** Readiness is checked once at start-up and advertised in every heartbeat. */
function capabilities() {
  const generation = generationReadiness();
  let preview = true;
  try { previewKeys(); getPreviewOrigin("00000000-0000-4000-8000-000000000000"); } catch { preview = false; }
  return { generation: generation.ready, generator: generation.provider, sandbox: Boolean(process.env.E2B_API_KEY), preview_signing: preview };
}
const caps = capabilities();

export function publicFailure(error: unknown) {
  if (error instanceof BudgetError) {
    if (error.code === "SPEND_LIMIT") return { code: "SPEND_LIMIT", message: "Generation is paused because a platform spending limit was reached. Your previous working version is unchanged. Please try again later." };
    return { code: "INSUFFICIENT_CREDITS", message: "This build ran out of credits before it could finish. Your previous working version is unchanged. Add credits and try again." };
  }
  const message = safeError(error);
  if (/SOURCE_CHANGED/.test(message)) return { code: "SOURCE_CHANGED", message: "Your files changed while this build was running, so it was not applied. Your edits are preserved. Ask NYNZ again to continue." };
  if (/GENERATOR_NOT_CONFIGURED/.test(message)) return { code: "GENERATOR_UNAVAILABLE", message: "The application generator is not available right now. No credits were used for generation." };
  if (/spending limit/i.test(message)) return { code: "MODEL_BUDGET_REACHED", message: "This build reached its model spending limit. Reduce the scope, then try again." };
  if (/request rejected \((401|402|429)\)/i.test(message)) return { code: "GENERATOR_UNAVAILABLE", message: "The application generator is temporarily unavailable. Please try again shortly." };
  if (/production build failed|missing dependencies|invalid syntax/i.test(message)) return { code: "BUILD_VALIDATION_FAILED", message: "The generated changes did not pass production validation, so they were not applied. Your previous working version is unchanged." };
  if (/wrong files|incomplete|output limit|truncated|application plan|complete enough/i.test(message)) return { code: "GENERATION_INCOMPLETE", message: "The generator returned an incomplete result, so nothing was changed. Please try again." };
  return { code: "BUILD_FAILED", message: "We couldn't complete this build. Your previous working version is unchanged. Please try again." };
}

async function heartbeat(status = currentBuildId ? "working" : shuttingDown ? "stopping" : "idle") {
  if (heartbeatBusy) return;
  heartbeatBusy = true;
  try {
    await db.from("worker_heartbeats").upsert({
      worker_id: worker, status, current_build_id: currentBuildId, last_seen_at: new Date().toISOString(), capabilities: caps,
      stopped_at: status === "stopped" ? new Date().toISOString() : null, ...(status === "starting" ? { started_at: new Date().toISOString() } : {}),
    }, { onConflict: "worker_id" });
    if (currentBuildId) await db.from("build_jobs").update({ locked_at: new Date().toISOString() }).eq("id", currentBuildId).eq("locked_by", lockOwner);
  } catch (error) { console.error(`[NYNZ worker] heartbeat failed: ${safeError(error)}`); }
  finally { heartbeatBusy = false; }
}

async function progress(job: Job, message: string, status?: string, percent?: number) {
  const events = [...(job.progress || []), { at: new Date().toISOString(), message, ...(typeof percent === "number" ? { percent } : {}) }].slice(-100);
  job.progress = events;
  await db.from("build_jobs").update({ progress: events, locked_at: new Date().toISOString(), ...(status ? { status } : {}) }).eq("id", job.id).eq("locked_by", lockOwner);
}

async function finish(job: Job, status: "failed" | "cancelled", code: string, message: string) {
  const { data, error } = await db.rpc("finish_build_unsuccessfully", { p_build: job.id, p_lock_owner: lockOwner, p_status: status, p_code: code, p_message: message });
  if (error) console.error(`[NYNZ worker] could not finish build ${job.id}: ${safeError(error)}`);
  return Boolean(data);
}

async function cancelled(job: Job) {
  const { data } = await db.from("build_jobs").select("cancel_requested_at").eq("id", job.id).single();
  if (!data?.cancel_requested_at) return false;
  await finish(job, "cancelled", "CANCELLED", "Cancelled. Your previous working version is unchanged.");
  return true;
}

async function projectAssets(projectId: string) {
  const { data } = await db.storage.from("project-assets").list(projectId, { limit: 100 });
  const names = (data || []).filter((item) => item.id).map((item) => item.name);
  return Promise.all(names.map(async (name) => {
    const { data: file, error } = await db.storage.from("project-assets").download(`${projectId}/${name}`);
    if (error || !file) throw error || new Error(`Could not download asset ${name}`);
    return { name, data: await file.arrayBuffer() };
  }));
}

/** Replaces the build's staged file set. Never touches canonical project files. */
async function stageFiles(job: Job, files: SourceFile[], replace: boolean) {
  const { data: lease } = await db.from("build_jobs").select("locked_by,status").eq("id", job.id).maybeSingle();
  if (lease?.locked_by !== lockOwner || ["succeeded", "failed", "cancelled", "queued"].includes(lease.status)) throw new Error("Build lease lost while staging files");
  if (replace) {
    const keep = new Set(files.map((file) => file.path));
    const { data: existing } = await db.from("build_staged_files").select("path").eq("build_id", job.id);
    const stale = (existing || []).map((row) => row.path).filter((path) => !keep.has(path));
    if (stale.length) { const { error } = await db.from("build_staged_files").delete().eq("build_id", job.id).in("path", stale); if (error) throw error; }
  }
  for (let i = 0; i < files.length; i += 50) {
    const { error } = await db.from("build_staged_files").upsert(files.slice(i, i + 50).map((file) => ({ build_id: job.id, path: file.path, content: file.content })));
    if (error) throw error;
  }
}

function assistantReply(message: string, mode: string) {
  const base = message.trim() || (mode === "edit" ? "Your requested changes are now live." : "Your application is ready and running in the preview.");
  return /\?\s*$/.test(base) ? base : `${base}\n\nWhat would you like to change, add, or improve next?`;
}

/**
 * Publish: build the project's current source in a fresh sandbox, validate the
 * static output, upload it to an immutable per-deployment prefix and activate
 * it atomically. A failed publish leaves the live site unchanged.
 */
async function processPublish(job: Job, meter: BuildMeter) {
  const started = Date.now();
  let sandboxId: string | null = null;
  const { data: deployment, error: deploymentError } = await db.from("deployments").insert({ project_id: job.project_id, owner_id: job.requested_by, build_id: job.id }).select("id").single();
  if (deploymentError || !deployment) throw deploymentError || new Error("Could not create deployment");
  const prefix = `published-sites/${deployment.id}`;
  try {
    const [{ data: project }, { data: files }, { data: backend }, assets] = await Promise.all([
      db.from("projects").select("active_version_id,source_revision").eq("id", job.project_id).single(),
      db.from("project_files").select("path,content").eq("project_id", job.project_id),
      db.from("generated_backend_connections").select("project_url,publishable_key").eq("project_id", job.project_id).maybeSingle(),
      projectAssets(job.project_id),
    ]);
    if (!files?.length) throw new Error("There are no files to publish");
    await progress(job, "Building a production version of your app", "installing", 40);
    const built = await buildArtifactInE2B(files, backend ? { projectUrl: backend.project_url, publishableKey: backend.publishable_key } : undefined, assets, {
      owner: { projectId: job.project_id, buildId: job.id }, maxFiles: MAX_ARTIFACT_FILES, maxBytes: MAX_ARTIFACT_BYTES,
      onCreated: async (id) => { sandboxId = id; await db.rpc("register_sandbox", { p_sandbox: id, p_project: job.project_id, p_build: job.id, p_purpose: "publish" }); },
    });
    const total = validateArtifact(built.files.map((file) => ({ path: file.path, size: file.data.byteLength })));
    await progress(job, "Uploading the validated build", "validating", 80);
    await db.from("platform_resources").insert({ kind: "deployment_artifact", provider_ref: prefix, project_id: job.project_id, owner_id: job.requested_by, build_id: job.id, purpose: "publish", state: "active" });
    const manifest = [];
    for (const file of built.files) {
      const type = contentType(file.path);
      const { error } = await db.storage.from("published-sites").upload(`${deployment.id}/${file.path}`, file.data, { contentType: type, upsert: false });
      if (error) throw error;
      manifest.push({ path: file.path, size: file.data.byteLength, sha256: createHash("sha256").update(file.data).digest("hex"), type });
    }
    await db.from("deployments").update({ artifact_prefix: prefix, file_count: manifest.length, total_bytes: total, manifest: { files: manifest }, version_id: project?.active_version_id, source_revision: project?.source_revision }).eq("id", deployment.id);
    const { error: activateError } = await db.rpc("activate_deployment", { p_deployment: deployment.id });
    if (activateError) throw new Error(activateError.message);
    const { error } = await db.from("build_jobs").update({ status: "succeeded", finished_at: new Date().toISOString(), locked_at: null, progress: [...job.progress, { at: new Date().toISOString(), message: "Published", percent: 100 }] }).eq("id", job.id).eq("locked_by", lockOwner);
    if (error) throw error;
    return "succeeded";
  } catch (error) {
    await db.from("deployments").update({ status: "failed", error: publicFailure(error).message }).eq("id", deployment.id);
    await db.rpc("request_resource_termination", { p_kind: "deployment_artifact", p_ref: prefix, p_reason: "publish failed" });
    const { data: site } = await db.from("published_sites").select("active_deployment_id").eq("project_id", job.project_id).maybeSingle();
    await db.from("published_sites").update({ status: site?.active_deployment_id ? "live" : "failed" }).eq("project_id", job.project_id);
    throw error;
  } finally {
    if (sandboxId) {
      await db.rpc("request_resource_termination", { p_kind: "e2b_sandbox", p_ref: sandboxId, p_reason: "publish build finished" });
      await meter.recordSandbox(sandboxId, Math.ceil((Date.now() - started) / 1000), "publish").catch(() => undefined);
    }
  }
}

async function processJob(job: Job) {
  const meter = new BuildMeter(db, job);
  let sandboxId: string | null = null;
  let sandboxStarted = 0;
  let awaitingApproval = false;
  let outcome = "failed";
  try {
    const [{ data: project }, { data: files }, { data: imports }, { data: backend }, assets] = await Promise.all([
      db.from("projects").select("*").eq("id", job.project_id).single(),
      db.from("project_files").select("path,content").eq("project_id", job.project_id),
      db.from("website_imports").select("title,source_url,markdown").eq("project_id", job.project_id).eq("status", "complete").order("created_at", { ascending: false }).limit(3),
      db.from("generated_backend_connections").select("project_url,publishable_key").eq("project_id", job.project_id).maybeSingle(),
      projectAssets(job.project_id),
    ]);
    if (!project) throw new Error("Project no longer exists");
    if (job.mode === "publish") { outcome = await processPublish(job, meter); return; }
    await progress(job, "Preparing project context", "planning");
    if (await cancelled(job)) { outcome = "cancelled"; return; }

    let working: SourceFile[] = files || [];
    let output: Awaited<ReturnType<typeof generateApplication>> | null = null;
    if (job.mode !== "restart") {
      if (!caps.generation) throw new Error("GENERATOR_NOT_CONFIGURED");
      const importedReferences = (imports || []).map((x) => `SOURCE ${x.source_url} (${x.title})\n${x.markdown}`).join("\n\n");
      const backendContext = backend ? "A Supabase backend is connected to this generated application. Use VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY from the runtime environment for requested database or authentication features. Put every schema change in a new file under supabase/migrations/ (for example supabase/migrations/0001_notes.sql) with row-level security enabled and owner-scoped policies using auth.uid(); the customer reviews and applies it. Never request or embed a service-role key." : "";
      const assetContext = assets.length ? `The user uploaded these project assets. They are available in the generated app at these exact public paths:\n${assets.map((asset) => `- /uploads/${asset.name}`).join("\n")}\nUse the relevant uploaded assets when the request mentions a logo, image, document or brand file.` : "";
      const references = [importedReferences, backendContext, assetContext].filter(Boolean).join("\n\n");
      const hooks = { onUsage: (event: Parameters<BuildMeter["afterModelCall"]>[0]) => meter.afterModelCall(event), beforeRequest: (event: { models: string[]; estimatedPaise: number }) => meter.beforeModelCall(event) };

      if (job.plan?.approval === "required") {
        await progress(job, "Planning the screens, design and functionality for your approval", "planning", 12);
        const planned = await planApplication({ prompt: job.prompt, files: working, mode: job.mode === "edit" ? "edit" : "create", references, ...hooks });
        if (await cancelled(job)) { outcome = "cancelled"; return; }
        const plan = { ...planned.manifest.plan, manifest: planned.manifest, approval: "awaiting", revision: job.plan.revision || 1 };
        const { error } = await db.from("build_jobs").update({ plan, status: "planning", locked_at: null, locked_by: null, progress: [...job.progress, { at: new Date().toISOString(), message: "Plan ready for your approval. No code generation has started.", percent: 18 }] }).eq("id", job.id).eq("locked_by", lockOwner);
        if (error) throw error;
        await db.from("projects").update({ status: "planning", last_error: null }).eq("id", job.project_id);
        awaitingApproval = true;
        return;
      }

      const { error: beginError } = await db.rpc("begin_build_generation", { p_build: job.id, p_lock_owner: lockOwner });
      if (beginError) throw beginError;
      if (job.generation_complete) {
        const { data: staged } = await db.from("build_staged_files").select("path,content").eq("build_id", job.id);
        if (!staged?.length) throw new Error("Recovered build has no staged files");
        working = staged;
        await progress(job, "Resuming from the generated files after a restart", "installing", 66);
      } else {
        await progress(job, "Writing the approved application", "generating", 22);
        const generationFiles = job.mode === "create" ? [] : working;
        output = await generateApplication({
          prompt: job.prompt, files: generationFiles, references, mode: job.mode === "create" ? "create" : "edit",
          approvedManifest: job.plan?.approval === "approved" ? job.plan.manifest : undefined, ...hooks,
          onAttempt: async (attempt) => progress(job, job.mode === "create" && attempt > 1 ? `Building application files · batch ${attempt - 1}` : attempt > 1 ? `Refining the requested changes · pass ${attempt}` : "Generating your application", "generating"),
          onProgress: async (event) => progress(job, event.message || `Building application files · ${event.current} of ${event.total}`, "generating", event.percent),
          // Progressive batches go to staging only; canonical source is untouched until promotion.
          onFiles: async (next) => stageFiles(job, next, false),
        });
        const merged = new Map((job.mode === "create" ? [] : working).map((file) => [file.path, file.content]));
        output.result.files.forEach((file) => merged.set(file.path, file.content));
        working = [...merged].map(([path, content]) => ({ path, content }));
        await stageFiles(job, working, true);
        await db.from("build_jobs").update({ plan: { ...job.plan, ...output.result.plan }, generation_complete: true }).eq("id", job.id).eq("locked_by", lockOwner);
      }
    } else {
      await db.rpc("begin_build_generation", { p_build: job.id, p_lock_owner: lockOwner });
    }

    if (await cancelled(job)) { outcome = "cancelled"; return; }
    await progress(job, "Preparing a secure preview environment", "installing");
    sandboxStarted = Date.now();
    const sandbox = await runInE2B(working, backend ? { projectUrl: backend.project_url, publishableKey: backend.publishable_key } : undefined, assets, {
      owner: { projectId: job.project_id, buildId: job.id },
      onCreated: async (id) => {
        sandboxId = id;
        const { error } = await db.rpc("register_sandbox", { p_sandbox: id, p_project: job.project_id, p_build: job.id, p_purpose: "preview" });
        if (error) throw error;
        await db.from("build_jobs").update({ sandbox_id: id }).eq("id", job.id).eq("locked_by", lockOwner);
      },
      onStage: async (message, percent) => progress(job, message, percent >= 80 ? "validating" : "installing", percent),
      onBuildFailure: job.mode === "restart" ? undefined : async (detail, workingFiles, attempt) => {
        await progress(job, `Repairing a compiler issue · pass ${attempt} of 2`, "generating", 78);
        const repair = await generateApplication({
          prompt: `Fix these production compiler errors. Add any missing helper files. Preserve the product and all working functionality. Make the smallest necessary corrections.\n\n${detail.slice(0, 6000)}`,
          files: workingFiles, mode: "edit",
          onUsage: (event) => meter.afterModelCall(event), beforeRequest: (event) => meter.beforeModelCall(event),
        });
        if (repair.result.files.length) await stageFiles(job, repair.result.files, false);
        return repair.result.files;
      },
    });

    if (await cancelled(job)) { outcome = "cancelled"; return; }
    await progress(job, "Validating production build and preview", "validating");
    const label = job.mode === "restart" ? "Preview restart" : `Build ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
    const { error: promoteError } = await db.rpc("promote_build", { p_build: job.id, p_lock_owner: lockOwner, p_sandbox: sandbox.sandboxId, p_preview_url: getPreviewOrigin(job.project_id), p_label: label });
    if (promoteError) throw new Error(promoteError.message);
    outcome = "succeeded";
    if (job.conversation_id && (output || job.plan)) {
      const { data: posted } = await db.from("messages").select("id").eq("conversation_id", job.conversation_id).eq("metadata->>build_id", job.id).limit(1);
      if (!posted?.length) await db.from("messages").insert({ conversation_id: job.conversation_id, role: "assistant", content: assistantReply(output?.result.message || "", output ? job.mode : "edit"), metadata: { build_id: job.id, plan: output?.result.plan || job.plan } });
    }
  } catch (error) {
    console.error(`[NYNZ worker] build ${job.id} failed: ${safeError(error)}`);
    if (/LEASE_LOST/.test(safeError(error))) { outcome = "lease_lost"; }
    else if (/CANCELLED/.test(safeError(error))) { outcome = "cancelled"; await finish(job, "cancelled", "CANCELLED", "Cancelled. Your previous working version is unchanged."); }
    else { const failure = publicFailure(error); await finish(job, "failed", failure.code, failure.message); }
  } finally {
    if (sandboxId) {
      await meter.recordSandbox(sandboxId, Math.ceil((Date.now() - sandboxStarted) / 1000), outcome).catch((error) => console.error(`[NYNZ worker] sandbox metering failed: ${safeError(error)}`));
      // A sandbox that did not become the project's preview is never left running.
      if (outcome !== "succeeded") {
        await db.rpc("request_resource_termination", { p_kind: "e2b_sandbox", p_ref: sandboxId, p_reason: `build ${outcome}` });
        await stopE2B(sandboxId).then(() => db.from("platform_resources").update({ state: "terminated", terminated_at: new Date().toISOString() }).eq("kind", "e2b_sandbox").eq("provider_ref", sandboxId!)).catch(() => undefined);
      }
    }
    if (!awaitingApproval && outcome !== "lease_lost") await meter.settle(outcome).catch((error) => console.error(`[NYNZ worker] reservation settlement failed: ${safeError(error)}`));
  }
}

async function maintenance(requestedBy: string | null = null) {
  const { data: run } = await db.from("maintenance_runs").insert({ kind: "reconcile", requested_by: requestedBy }).select("id").single();
  try {
    const summary = await reconcileResources({ db, killSandbox: stopE2B, listSandboxes: listNynzSandboxes, idleDays: Number(process.env.PREVIEW_IDLE_DAYS || 7) });
    await db.from("maintenance_runs").update({ finished_at: new Date().toISOString(), summary }).eq("id", run?.id);
    return run?.id;
  } catch (error) {
    await db.from("maintenance_runs").update({ finished_at: new Date().toISOString(), error: safeError(error) }).eq("id", run?.id);
    return run?.id;
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[NYNZ worker] ${lockOwner} ${signal} received; finishing the active build before shutdown`);
  void heartbeat("stopping");
});

async function main() {
  console.log(`[NYNZ worker] ${worker} started (instance ${lockOwner}, generation ${caps.generation ? caps.generator : "unavailable"}, sandbox ${caps.sandbox ? "ready" : "unavailable"}, preview signing ${caps.preview_signing ? "ready" : "missing"})`);
  if (!caps.generation) console.error("[NYNZ worker] OPENROUTER_API_KEY is missing: the build API will refuse new generation requests until it is configured.");
  await heartbeat("starting");
  const timer = setInterval(() => void heartbeat(), 15000);
  timer.unref();
  let failures = 0;
  let lastRecovery = 0;
  let lastMaintenance = 0;
  while (!shuttingDown) {
    if (Date.now() - lastRecovery > 60000) {
      const recovery = await db.rpc("recover_stale_build_jobs", { stale_after_seconds: 120 });
      if (recovery.error) console.error(`[NYNZ worker] recovery check failed: ${safeError(recovery.error)}`);
      lastRecovery = Date.now();
    }
    const { data: requested } = await db.from("maintenance_requests").select("id,requested_by").is("picked_at", null).order("id").limit(1).maybeSingle();
    if (requested || Date.now() - lastMaintenance > 5 * 60_000) {
      if (requested) await db.from("maintenance_requests").update({ picked_at: new Date().toISOString() }).eq("id", requested.id);
      const runId = await maintenance(requested?.requested_by || null);
      if (requested) await db.from("maintenance_requests").update({ run_id: runId }).eq("id", requested.id);
      lastMaintenance = Date.now();
    }
    const { data, error } = await db.rpc("claim_build_job", { worker_name: lockOwner });
    if (error) { failures += 1; console.error(`[NYNZ worker] queue poll failed: ${safeError(error)}`); await wait(Math.min(30000, 1000 * 2 ** Math.min(failures, 5))); continue; }
    failures = 0;
    const job = data?.[0] as Job | undefined;
    if (!job) { await heartbeat(); await wait(2000); continue; }
    console.log(`[NYNZ worker] claimed build ${job.id} (${job.mode}, attempt ${(job as { attempt_count?: number }).attempt_count})`);
    currentBuildId = job.id;
    await heartbeat("working");
    await processJob(job);
    console.log(`[NYNZ worker] finished build ${job.id}`);
    currentBuildId = null;
    await heartbeat();
  }
  clearInterval(timer);
  await heartbeat("stopped");
  console.log(`[NYNZ worker] ${lockOwner} stopped`);
  process.exit(0);
}

if (process.env.NYNZ_WORKER_NO_START !== "1") main().catch(async (error) => { console.error(`[NYNZ worker] fatal: ${safeError(error)}`); await heartbeat("error").catch(() => undefined); process.exit(1); });
