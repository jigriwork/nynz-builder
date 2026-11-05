import "dotenv/config";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generateApplication, generationReadiness } from "../lib/platform/generation";
import { buildArtifactInE2B, listNynzSandboxes, runInE2B, stopE2B } from "../lib/platform/e2b";
import { localFixtureSandboxEnabled, runLocalFixtureSandbox } from "../lib/platform/local-sandbox";
import { createHash } from "node:crypto";
import { MAX_ARTIFACT_BYTES, MAX_ARTIFACT_FILES, contentType, validateArtifact } from "../preview-host/lib/sites";
import { getPreviewOrigin } from "../lib/preview/session";
import { removePreviewDomain } from "../lib/preview/registration";
import { redact } from "../lib/platform/redact";
import { planApplication, reviewCoverage } from "../lib/platform/openrouter";
import { StepFailedError, buildReply, pathsInMessage, briefContext, deterministicCoverage, estimateBuildCredits, type ProjectBrief } from "../lib/platform/build-engine";
import { RESERVE } from "../lib/billing/entitlements";
import { BuildMeter } from "../lib/billing/meter";
import { BudgetError } from "../lib/billing/budget-error";
import { reconcileResources } from "../lib/platform/reconcile";
import { readFileSync } from "node:fs";
import { watchBuild } from "../lib/platform/build-control";

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
type Checkpoint = { done?: string[]; base_staged?: boolean; failed_step?: { paths: string[]; reason: string; label: string }; resumed_from?: string };
type Job = { id: string; project_id: string; requested_by: string; conversation_id: string | null; prompt: string; request?: string | null; mode: "create" | "edit" | "restart" | "publish"; plan: any; progress: any[]; generation_complete?: boolean; cancel_requested_at?: string | null; checkpoint?: Checkpoint | null; resume_of?: string | null };

function safeError(error: unknown) {
  const raw = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error);
  return redact(raw).slice(0, 1000);
}

/**
 * Readiness of what this worker itself needs, checked at start-up and
 * advertised in every heartbeat. The worker never signs or verifies preview
 * sessions, so the preview signing secret is not part of its health.
 */
function capabilities() {
  const generation = generationReadiness();
  let previewOrigin = true;
  try { getPreviewOrigin("00000000-0000-4000-8000-000000000000"); } catch { previewOrigin = false; }
  return {
    generation: generation.ready, generator: generation.provider, sandbox: Boolean(process.env.E2B_API_KEY), preview_origin: previewOrigin, database: true,
    version: JSON.parse(readFileSync("package.json", "utf8")).version as string,
    commit: (process.env.RENDER_GIT_COMMIT || "").slice(0, 7) || "unknown",
  };
}
const caps = capabilities();
// The local fixture stand-in never runs in production or against a remote database.
const localSandbox = localFixtureSandboxEnabled();
if (localSandbox) caps.sandbox = true;
const runPreview: typeof runInE2B = localSandbox ? (runLocalFixtureSandbox as typeof runInE2B) : runInE2B;

export function publicFailure(error: unknown) {
  if (error instanceof BudgetError) {
    if (error.code === "SPEND_LIMIT") return { code: "SPEND_LIMIT", message: "NYNZ is very busy right now, so this build couldn't start. Your previous working version is unchanged. Please try again in a few minutes." };
    return { code: "INSUFFICIENT_CREDITS", message: "This build needs more credits to continue. Everything finished so far is saved and your previous working version is unchanged. Add credits, then Resume to continue from the next step." };
  }
  const message = safeError(error);
  if (/SOURCE_CHANGED/.test(message)) return { code: "SOURCE_CHANGED", message: "Your files changed while this build was running, so it was not applied. Your edits are preserved. Ask NYNZ again to continue." };
  if (/GENERATOR_NOT_CONFIGURED/.test(message)) return { code: "GENERATOR_UNAVAILABLE", message: "The application generator is not available right now. No credits were used for generation." };
  if (/spending limit/i.test(message)) return { code: "MODEL_BUDGET_REACHED", message: "This build reached its AI allowance. Everything finished so far is saved and your previous working version is unchanged. Resume continues with a fresh allowance." };
  if (/request rejected \((401|402|429)\)/i.test(message)) return { code: "GENERATOR_UNAVAILABLE", message: "The application generator is temporarily unavailable. Please try again shortly." };
  if (/production build failed|missing dependencies|invalid syntax/i.test(message)) return { code: "BUILD_VALIDATION_FAILED", message: "The generated changes did not pass production validation, so they were not applied. Your previous working version is unchanged." };
  if (error instanceof StepFailedError) return { code: "GENERATION_INCOMPLETE", message: `NYNZ couldn't finish ${error.step.label} automatically. Every finished step is saved and your previous working version is unchanged. Resume continues from this step without redoing the rest.` };
  if (/wrong files|incomplete|output limit|truncated|application plan|complete enough/i.test(message)) return { code: "GENERATION_INCOMPLETE", message: "The AI returned an incomplete result. Every finished step is saved and your previous working version is unchanged. Resume continues from the first unfinished step." };
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

/** Throws when the customer has asked to stop; checked before every paid request. */
async function assertNotCancelled(job: Job) {
  const { data } = await db.from("build_jobs").select("cancel_requested_at,status").eq("id", job.id).single();
  if (data?.cancel_requested_at || data?.status === "cancelled") throw new Error("CANCELLED");
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

/** Records a finished step and its files in one transaction (see record_build_step). */
async function recordStep(job: Job, done: string[], files: SourceFile[], note: Record<string, unknown>) {
  const { data, error } = await db.rpc("record_build_step", { p_build: job.id, p_lock_owner: lockOwner, p_done: done, p_files: files, p_note: { ...note, at: new Date().toISOString() } });
  if (error) throw new Error(/LEASE_LOST/.test(error.message) ? "LEASE_LOST" : error.message);
  job.checkpoint = data as Checkpoint;
}

/** The project's durable brief; older projects fall back to their first approved build. */
async function projectBrief(projectId: string, stored: ProjectBrief | null): Promise<ProjectBrief | null> {
  if (stored?.original) return stored;
  const { data } = await db.from("build_jobs").select("request,prompt,plan").eq("project_id", projectId).eq("mode", "create").eq("plan->>approval", "approved").order("created_at").limit(1).maybeSingle();
  if (!data) return null;
  return { original: data.request || String(data.prompt).split("\n\nUSER APPROVED PLAN")[0], plan: { summary: data.plan?.summary, steps: data.plan?.steps || [] }, changes: [] };
}

/**
 * Publish: build the project's current source in a fresh sandbox, validate the
 * static output, upload it to an immutable per-deployment prefix and activate
 * it atomically. A failed publish leaves the live site unchanged.
 */
async function processPublish(job: Job, meter: BuildMeter, signal: AbortSignal) {
  const started = Date.now();
  let sandboxId: string | null = null;
  const { data: deployment, error: deploymentError } = await db.from("deployments").insert({ project_id: job.project_id, owner_id: job.requested_by, build_id: job.id }).select("id").single();
  if (deploymentError || !deployment) throw deploymentError || new Error("Could not create deployment");
  const prefix = `published-sites/${deployment.id}`;
  try {
    const snapshot = await db.rpc("stage_publish_source", { p_build: job.id, p_lock_owner: lockOwner });
    if (snapshot.error) throw snapshot.error;
    const [{ data: project }, { data: files }, { data: backend }, assets] = await Promise.all([
      db.from("projects").select("active_version_id,source_revision").eq("id", job.project_id).single(),
      db.from("build_staged_files").select("path,content").eq("build_id", job.id),
      db.from("generated_backend_connections").select("project_url,publishable_key").eq("project_id", job.project_id).maybeSingle(),
      projectAssets(job.project_id),
    ]);
    if (!files?.length) throw new Error("There are no files to publish");
    await progress(job, "Building a production version of your app", "installing", 40);
    const built = await buildArtifactInE2B(files, backend ? { projectUrl: backend.project_url, publishableKey: backend.publishable_key } : undefined, assets, {
      signal, beforeCreate: (seconds) => meter.beforeSandbox(seconds),
      owner: { projectId: job.project_id, buildId: job.id }, maxFiles: MAX_ARTIFACT_FILES, maxBytes: MAX_ARTIFACT_BYTES,
      onCreated: async (id) => { sandboxId = id; const registered = await db.rpc("register_sandbox", { p_sandbox: id, p_project: job.project_id, p_build: job.id, p_purpose: "publish" }); if (registered.error) throw registered.error; },
    });
    const total = validateArtifact(built.files.map((file) => ({ path: file.path, size: file.data.byteLength })));
    await progress(job, "Uploading the validated build", "validating", 80);
    const resource = await db.from("platform_resources").insert({ kind: "deployment_artifact", provider_ref: prefix, project_id: job.project_id, owner_id: job.requested_by, build_id: job.id, purpose: "publish", state: "active" });
    if (resource.error) throw resource.error;
    const manifest = [];
    for (const file of built.files) {
      signal.throwIfAborted();
      const type = contentType(file.path);
      const { error } = await db.storage.from("published-sites").upload(`${deployment.id}/${file.path}`, file.data, { contentType: type, upsert: false });
      if (error) throw error;
      manifest.push({ path: file.path, size: file.data.byteLength, sha256: createHash("sha256").update(file.data).digest("hex"), type });
    }
    const recorded = await db.from("deployments").update({ artifact_prefix: prefix, file_count: manifest.length, total_bytes: total, manifest: { files: manifest }, version_id: project?.active_version_id, source_revision: snapshot.data }).eq("id", deployment.id);
    if (recorded.error) throw recorded.error;
    signal.throwIfAborted();
    const { error: activateError } = await db.rpc("complete_publish", { p_build: job.id, p_lock_owner: lockOwner, p_deployment: deployment.id });
    if (activateError) throw new Error(activateError.message);
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
  let control: Awaited<ReturnType<typeof watchBuild>> | undefined;
  try {
    control = await watchBuild(async () => {
      const [current, account] = await Promise.all([
        db.from("build_jobs").select("locked_by,status,cancel_requested_at").eq("id", job.id).maybeSingle(),
        db.from("account_status").select("status").eq("user_id", job.requested_by).maybeSingle(),
      ]);
      if (current.error || account.error) throw new Error("Build authorisation unavailable");
      if (!current.data || current.data.locked_by !== lockOwner) throw new Error("LEASE_LOST");
      if (current.data.cancel_requested_at || current.data.status === "cancelled" || account.data?.status === "suspended") throw new Error("CANCELLED");
    });
    const signal = control.signal;
    const [{ data: project }, { data: files }, { data: imports }, { data: backend }, assets] = await Promise.all([
      db.from("projects").select("*").eq("id", job.project_id).single(),
      db.from("project_files").select("path,content").eq("project_id", job.project_id),
      db.from("website_imports").select("title,source_url,markdown").eq("project_id", job.project_id).eq("status", "complete").order("created_at", { ascending: false }).limit(3),
      db.from("generated_backend_connections").select("project_url,publishable_key").eq("project_id", job.project_id).maybeSingle(),
      projectAssets(job.project_id),
    ]);
    if (!project) throw new Error("Project no longer exists");
    if (job.mode === "publish") { outcome = await processPublish(job, meter, signal); return; }
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
      // Stop is checked against the database before every paid request, so no
      // new provider work starts once a cancellation has been accepted.
      const hooks = { signal, onUsage: (event: Parameters<BuildMeter["afterModelCall"]>[0]) => meter.afterModelCall(event), beforeRequest: async (event: { models: string[]; estimatedPaise: number }) => { signal.throwIfAborted(); await assertNotCancelled(job); await meter.beforeModelCall(event); } };
      const brief = job.mode === "edit" ? await projectBrief(job.project_id, project.brief as ProjectBrief | null) : null;
      const context = briefContext(brief, job.id);
      const requestText = context ? `${context}\n\nREQUESTED CHANGE (apply this while keeping everything above):\n${job.prompt}` : job.prompt;

      if (job.plan?.approval === "required") {
        await progress(job, "Planning the screens, design and functionality for your approval", "planning", 12);
        meter.setStep("Planning the build");
        const planned = await planApplication({ prompt: requestText, files: working, mode: job.mode === "edit" ? "edit" : "create", references, ...hooks });
        if (await cancelled(job)) { outcome = "cancelled"; return; }
        const estimate = estimateBuildCredits({ files: planned.manifest.files, mode: job.mode === "edit" ? "edit" : "create", existing: working, briefChars: requestText.length, minimumHold: RESERVE.generate() });
        const plan = { ...planned.manifest.plan, manifest: planned.manifest, estimate, approval: "awaiting", revision: job.plan.revision || 1 };
        const { error } = await db.from("build_jobs").update({ plan, status: "planning", locked_at: null, locked_by: null, progress: [...job.progress, { at: new Date().toISOString(), message: "Plan ready for your approval. No code generation has started.", percent: 18 }] }).eq("id", job.id).eq("locked_by", lockOwner);
        if (error) throw error;
        await db.from("projects").update({ status: "planning", last_error: null }).eq("id", job.project_id);
        awaitingApproval = true;
        return;
      }

      const { error: beginError } = await db.rpc("begin_build_generation", { p_build: job.id, p_lock_owner: lockOwner });
      if (beginError) throw beginError;
      const { data: fresh } = await db.from("build_jobs").select("checkpoint").eq("id", job.id).single();
      job.checkpoint = (fresh?.checkpoint || null) as Checkpoint | null;
      if (job.generation_complete) {
        const { data: staged } = await db.from("build_staged_files").select("path,content").eq("build_id", job.id);
        if (!staged?.length) throw new Error("Recovered build has no staged files");
        working = staged;
        await progress(job, "Resuming from the generated files after a restart", "installing", 66);
      } else {
        const done = job.checkpoint?.done || [];
        const { data: staged } = await db.from("build_staged_files").select("path,content").eq("build_id", job.id);
        if (job.mode === "edit") {
          // An edit first stages the current project as its base, so finished
          // steps can be saved one at a time and survive a restart.
          if (job.checkpoint?.base_staged && staged?.length) working = staged;
          else await recordStep(job, [], working, { base: true, label: "current project files" });
        }
        const completed = job.mode === "create" ? (staged || []).filter((file) => done.includes(file.path)) : [];
        await progress(job, done.length ? `Continuing from ${done.length} finished file(s); finished work is reused, not regenerated` : "Writing the approved application", "generating", 22);
        output = await generateApplication({
          prompt: job.mode === "create" ? job.prompt : requestText, files: job.mode === "create" ? [] : working, references, mode: job.mode === "create" ? "create" : "edit",
          approvedManifest: job.plan?.approval === "approved" ? job.plan.manifest : undefined, completed, completedPaths: job.mode === "edit" ? done : undefined, ...hooks,
          onProgress: async (event) => progress(job, event.message || `Building application files · ${event.current} of ${event.total}`, "generating", event.percent),
          // Each finished step is saved with its files in one transaction.
          // Canonical source is untouched until promotion.
          onStep: async (step) => { await recordStep(job, step.done, step.files, { label: step.label }); },
          // The label is set before each paid request, so every charge names the step it paid for.
          onLabel: (label) => meter.setStep(label),
        });
        const merged = new Map((job.mode === "create" ? [] : working).map((file) => [file.path, file.content]));
        output.result.files.forEach((file) => merged.set(file.path, file.content));
        working = [...merged].map(([path, content]) => ({ path, content }));
        // Check the result against the approved plan before calling it complete.
        const steps: string[] = job.plan?.approval === "approved" ? (job.plan.steps || []) : [];
        const coverage = deterministicCoverage({ planned: (job.plan?.manifest?.files || []).map((file: { path: string }) => file.path), files: working, previous: job.mode === "edit" ? (files || []).map((file) => file.path) : [] });
        let missing = [...coverage.missingFiles.map((path) => `Planned file ${path} was not created`), ...coverage.removedFiles.map((path) => `Existing file ${path} was removed`)];
        const unstyled: string[] = (output as { unstyled?: string[] }).unstyled || [];
        let unconfirmed: string[] = unstyled.length ? [`Styling for ${unstyled.length} class name${unstyled.length === 1 ? "" : "s"} (${unstyled.slice(0, 6).join(", ")}${unstyled.length > 6 ? ", …" : ""})`] : [];
        if (steps.length && process.env.NYNZ_COVERAGE_REVIEW !== "0") {
          meter.setStep("Checking the result against the approved plan");
          await progress(job, "Checking the result against the approved plan", "generating", 64);
          try {
            const review = await reviewCoverage({ steps, files: working, changed: job.mode === "edit" ? output.result.files.map((file) => file.path) : undefined, request: job.request || undefined, ...hooks });
            missing = [...missing, ...review.missing];
            unconfirmed = [...unconfirmed, ...review.unconfirmed];
          } catch (error) {
            if (signal.aborted || /CANCELLED/.test(safeError(error))) throw error;
            console.error(`[NYNZ worker] coverage review skipped for ${job.id}: ${safeError(error)}`);
            unconfirmed.push("The automatic check against the approved plan could not run");
          }
        }
        await stageFiles(job, working, true);
        await db.from("build_jobs").update({ plan: { ...job.plan, ...output.result.plan, coverage: { missing, unconfirmed, checked_at: new Date().toISOString() } }, generation_complete: true }).eq("id", job.id).eq("locked_by", lockOwner);
        job.plan = { ...job.plan, coverage: { missing, unconfirmed } };
      }
    } else {
      await db.rpc("begin_build_generation", { p_build: job.id, p_lock_owner: lockOwner });
    }

    if (await cancelled(job)) { outcome = "cancelled"; return; }
    await progress(job, "Preparing a secure preview environment", "installing");
    sandboxStarted = Date.now();
    const sandbox = await runPreview(working, backend ? { projectUrl: backend.project_url, publishableKey: backend.publishable_key } : undefined, assets, {
      signal, beforeCreate: (seconds) => meter.beforeSandbox(seconds),
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
        meter.setStep(`Repairing compiler errors (pass ${attempt})`);
        const repair = await generateApplication({
          signal,
          prompt: `Fix these production compiler errors. Add any missing helper files. Preserve the product and all working functionality. Make the smallest necessary corrections.\n\n${detail.slice(0, 6000)}`,
          files: workingFiles, mode: "edit", targets: pathsInMessage(detail, workingFiles),
          onUsage: (event) => meter.afterModelCall(event), beforeRequest: async (event) => { await assertNotCancelled(job); await meter.beforeModelCall(event); },
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
      if (!posted?.length) await db.from("messages").insert({ conversation_id: job.conversation_id, role: "assistant", content: buildReply(output?.result.message || "", output ? job.mode : "edit", job.plan?.coverage || {}), metadata: { build_id: job.id, plan: output?.result.plan || job.plan } });
    }
  } catch (error) {
    if (control?.signal.aborted) error = control.signal.reason;
    console.error(`[NYNZ worker] build ${job.id} failed: ${safeError(error)}`);
    if (/LEASE_LOST/.test(safeError(error))) { outcome = "lease_lost"; }
    else if (/CANCELLED/.test(safeError(error))) { outcome = "cancelled"; await finish(job, "cancelled", "CANCELLED", "Cancelled. Your previous working version is unchanged."); }
    else {
      if (error instanceof StepFailedError) await db.rpc("note_build_failure_step", { p_build: job.id, p_lock_owner: lockOwner, p_step: error.step });
      const failure = publicFailure(error); await finish(job, "failed", failure.code, failure.message);
    }
  } finally {
    control?.stop();
    if (sandboxId) {
      await meter.recordSandbox(sandboxId, Math.ceil((Date.now() - sandboxStarted) / 1000), outcome).catch((error) => console.error(`[NYNZ worker] sandbox metering failed: ${safeError(error)}`));
      // A sandbox that did not become the project's preview is never left running.
      if (outcome !== "succeeded") {
        await db.rpc("request_resource_termination", { p_kind: "e2b_sandbox", p_ref: sandboxId, p_reason: `build ${outcome}` });
        await stopE2B(sandboxId).then(() => db.from("platform_resources").update({ state: "terminated", terminated_at: new Date().toISOString() }).eq("kind", "e2b_sandbox").eq("provider_ref", sandboxId!)).catch(() => undefined);
      }
    }
    if (!awaitingApproval && outcome !== "lease_lost") {
      const settled = await meter.settle(outcome).catch((error) => { console.error(`[NYNZ worker] reservation settlement failed: ${safeError(error)}`); return null; });
      if (outcome === "cancelled" && settled) {
        // Explain the final charge: only work that had already started is charged.
        const used = Number(settled.consumed || 0);
        const released = Number(settled.released || 0);
        const { data: row } = await db.from("build_jobs").select("resumable").eq("id", job.id).single();
        await db.from("build_jobs").update({ error_message: `Stopped. ${used} credit${used === 1 ? " was" : "s were"} used for steps that had already started${released ? `; ${released} held credit${released === 1 ? " was" : "s were"} released` : ""}. Nothing more will be charged. ${row?.resumable ? "Finished steps are saved, so Resume continues where it stopped." : "Your previous working version is unchanged."}` }).eq("id", job.id).eq("status", "cancelled");
      }
    }
  }
}

async function maintenance(requestedBy: string | null = null) {
  const { data: run } = await db.from("maintenance_runs").insert({ kind: "reconcile", requested_by: requestedBy }).select("id").single();
  try {
    const summary = await reconcileResources({ db, killSandbox: stopE2B, removePreviewDomain, listSandboxes: listNynzSandboxes, idleDays: Number(process.env.PREVIEW_IDLE_DAYS || 7) });
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
  console.log(`[NYNZ worker] ${worker} v${caps.version} (${caps.commit}) started (instance ${lockOwner}, generation ${caps.generation ? caps.generator : "unavailable"}, sandbox ${caps.sandbox ? "ready" : "unavailable"}, preview origin ${caps.preview_origin ? "valid" : "invalid"})`);
  if (!caps.generation) console.error("[NYNZ worker] OPENROUTER_API_KEY is missing: the build API will refuse new generation requests until it is configured.");
  if (!caps.preview_origin) console.error("[NYNZ worker] PREVIEW_ORIGIN is invalid: built previews cannot be linked.");
  await heartbeat("starting");
  const timer = setInterval(() => void heartbeat(), 15000);
  timer.unref();
  let failures = 0;
  let lastRecovery = 0;
  let lastMaintenance = 0;
  while (!shuttingDown) {
    if (Date.now() - lastRecovery > Number(process.env.WORKER_RECOVERY_INTERVAL_MS || 60000)) {
      const recovery = await db.rpc("recover_stale_build_jobs", { stale_after_seconds: Math.max(60, Number(process.env.WORKER_STALE_AFTER_SECONDS || 120)) });
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
