/**
 * Local proof for resumable builds, run against a local Supabase stack, the
 * real worker and the real Next app, with a scripted AI provider and the local
 * preview stand-in. Nothing here touches production: every production setting
 * inherited from .env.local is blanked for the child processes, and the local
 * sandbox refuses to run unless the database is on this machine.
 *
 *   supabase start --workdir <dir-with-config-and-no-migrations>
 *   supabase migration up --local
 *   npx tsx tests/e2e/studiomark/run.ts <supabase-workdir>
 *
 * Scenarios: a StudioMark-sized build is cut off in a late step and the worker
 * is restarted mid-build; Resume (clicked repeatedly) finishes only the missing
 * work; a follow-up edit keeps the original features and repairs a compile
 * error; Stop during a build; insufficient credits before and during a build.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright-core";
import { startFakeOpenRouter, type Logged } from "./fake-openrouter";
import { BRIEF, EDIT_REQUEST, MANIFEST, SCREENS } from "./fixture";

const workdir = process.argv[2];
if (!workdir) throw new Error("Pass the local supabase workdir");
const local = Object.fromEntries(execFileSync("supabase", ["status", "-o", "env", "--workdir", workdir], { encoding: "utf8" }).split("\n").filter((line) => line.includes("=")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, "")]; }));
const API = local.API_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(API)) throw new Error("Refusing to run: Supabase API is not local");
const APP = "http://127.0.0.1:3200";
const FAKE_PORT = 4011;
const PASSWORD = "fixture-password-123";
const admin = createClient(API, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const results: Array<{ check: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail = "") { results.push({ check: name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); }
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 120_000, every = 500): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = await fn(); if (value) return value as T; await wait(every); }
  throw new Error(`Timed out waiting for ${what}`);
}

// Child processes: blank every production setting so nothing can reach live services.
const BLANK = ["E2B_API_KEY", "E2B_SANDBOX_TIMEOUT_MS", "FIRECRAWL_API_KEY", "SARVAM_API_KEY", "SARVAM_BASE_URL", "SARVAM_MODEL", "VERCEL_OIDC_TOKEN", "VERCEL_TOKEN", "PREVIEW_VERCEL_PROJECT_ID", "PREVIEW_VERCEL_TEAM_ID", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"];
const childEnv = {
  ...process.env, ...Object.fromEntries(BLANK.map((name) => [name, ""])),
  NODE_ENV: "development" as const, NEXT_PUBLIC_SUPABASE_URL: API, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  OPENROUTER_API_KEY: "local-fixture-only", OPENROUTER_BASE_URL: `http://127.0.0.1:${FAKE_PORT}/api/v1`, NYNZ_LOCAL_FIXTURE_SANDBOX: "1",
  PREVIEW_ORIGIN: "http://{projectId}.preview.localhost:3001", NEXT_PUBLIC_SITE_URL: APP, WORKER_STALE_AFTER_SECONDS: "60", WORKER_RECOVERY_INTERVAL_MS: "5000",
  TRIAL_CREDITS: "0", BUILD_RATE_PER_HOUR: "200",
};

const children: ChildProcess[] = [];
function startWorker(id: string) {
  const child = spawn("npx", ["tsx", "scripts/worker.ts"], { env: { ...childEnv, WORKER_ID: id }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout?.on("data", (data) => process.stdout.write(`[${id}] ${data}`));
  child.stderr?.on("data", (data) => process.stdout.write(`[${id}!] ${data}`));
  children.push(child);
  return child;
}
/** Kills the child's whole process group (npx and the process it started), like a crash. */
function kill(child: ChildProcess) { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }

async function user(email: string, credits: number) {
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw created.error;
  if (credits > 0) await grant(created.data.user.id, credits);
  return created.data.user.id;
}
async function grant(userId: string, credits: number) {
  const { error } = await admin.rpc("grant_credits", { p_user: userId, p_source: "promotional", p_amount: credits, p_expires_at: null, p_reason: "Local fixture credits", p_actor: null, p_idempotency: `fixture:${userId}:${Date.now()}:${credits}` });
  if (error) throw error;
}
async function builds(projectId: string) {
  const { data } = await admin.from("build_jobs").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  return data || [];
}
async function projectFiles(projectId: string) {
  const { data } = await admin.from("project_files").select("path,content").eq("project_id", projectId);
  return new Map((data || []).map((file) => [file.path, file.content]));
}
async function login(page: Page, email: string) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 120_000 });
      await page.fill("#email", email);
      await page.fill("#password", PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(/\/dashboard/, { timeout: 90_000 });
      return;
    } catch (error) {
      await page.screenshot({ path: `${process.env.E2E_ARTIFACTS || "/tmp"}/login-${attempt}.png` }).catch(() => undefined);
      if (attempt >= 3) throw error;
    }
  }
}
async function startFromDashboard(page: Page, prompt: string) {
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle", timeout: 120_000 });
  const box = page.getByLabel("Application description");
  await box.fill(prompt);
  await box.press("End");
  await box.pressSequentially(" ");
  await page.getByRole("button", { name: /^Build/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 90_000 });
  return page.url().match(/projects\/([0-9a-f-]{36})/)![1];
}
async function approvePlan(page: Page, projectId?: string) {
  const review = page.getByLabel("Review build plan");
  await review.waitFor({ timeout: 120_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const estimate = await review.locator("text=Estimated cost").first().textContent().catch(() => "");
  const id = projectId || page.url().match(/projects\/([0-9a-f-]{36})/)?.[1];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await review.getByRole("button", { name: "Approve and build" }).click().catch(() => undefined);
    const approved = await until("approval", async () => { const [b] = id ? await builds(id) : []; return b?.plan?.approval === "approved" || (await review.locator("[role=alert]").count()) > 0; }, 8_000, 300).catch(() => false);
    if (approved) break;
  }
  return estimate || "";
}
async function ask(page: Page, text: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const composer = page.locator("textarea[placeholder='Ask for a change…']");
  const send = page.getByLabel("Send request");
  for (let attempt = 0; attempt < 5 && !(await send.isEnabled().catch(() => false)); attempt += 1) {
    await composer.fill(text);
    await composer.press("End");
    await composer.pressSequentially(" ");
    await wait(500);
  }
  await send.click();
}
const logSince = (log: Logged[], at: number) => log.filter((entry) => entry.at >= at);

async function main() {
  const fake = await startFakeOpenRouter(FAKE_PORT);
  const owner = await user(`studiomark-${Date.now()}@fixture.test`, 400);
  const ownerEmail = (await admin.auth.admin.getUserById(owner)).data.user!.email!;
  let worker = startWorker("fixture-worker-1");
  const next = spawn("npx", ["next", "dev", "-p", "3200", "-H", "127.0.0.1"], { env: childEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
  children.push(next);
  next.stderr?.on("data", (data) => { const text = String(data); if (/error/i.test(text)) process.stdout.write(`[next!] ${text}`); });
  await until("the app", async () => (await fetch(`${APP}/login`).catch(() => null))?.ok, 180_000, 1000);
  await until("a ready worker", async () => (await admin.rpc("generation_ready", { p_max_age_seconds: 90 })).data, 60_000);

  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  page.setDefaultTimeout(60_000);
  await login(page, ownerEmail);

  // 1. Large build: the late step (Orders, Reports) keeps being cut off; the
  // worker restarts mid-build.
  fake.control.cutOff = ["src/pages/Orders.tsx", "src/pages/Reports.tsx"];
  fake.control.delayMs = 1_500;
  const projectId = await startFromDashboard(page, BRIEF);
  const estimate = await approvePlan(page);
  check("plan shows an estimated credit range and the amount held before approval", /Estimated cost: \d+–\d+ credits/.test(estimate) && /holds \d+/.test(estimate), estimate.replace(/\s+/g, " ").slice(0, 160));
  const first = await until("the first build to save some steps", async () => { const [b] = await builds(projectId); return b && (b.checkpoint?.done?.length || 0) >= 3 ? b : null; });
  kill(worker);
  const killedAt = Date.now();
  const doneBeforeKill: string[] = (await builds(projectId))[0].checkpoint?.done || [];
  check("steps were saved before the worker was killed", doneBeforeKill.length >= 3, doneBeforeKill.join(", "));
  fake.control.delayMs = 0;
  worker = startWorker("fixture-worker-2");
  const failed = await until("the build to stop at the late step", async () => { const [b] = await builds(projectId); return b && b.id === first.id && ["failed", "cancelled"].includes(b.status) ? b : null; }, 240_000, 1000);
  const afterRestart = logSince(fake.log, killedAt).filter((entry) => entry.schema === "nynz_files");
  check("after the restart, no finished file was requested again", afterRestart.every((entry) => entry.paths.every((path) => !doneBeforeKill.includes(path))), afterRestart.map((entry) => entry.paths.join("+")).join(" | "));
  check("the build was recovered by the new worker (not restarted from scratch)", (failed.progress || []).some((event: { message?: string }) => /recovered after a worker restart/i.test(event.message || "")));
  check("the late step failed as resumable with every other file saved", failed.status === "failed" && failed.resumable && failed.error_code === "GENERATION_INCOMPLETE" && (failed.checkpoint?.done || []).length === MANIFEST.files.length - 3 && failed.checkpoint?.failed_step?.label === "Orders.tsx", `${failed.checkpoint?.done?.length} saved; stopped at ${failed.checkpoint?.failed_step?.label}`);
  const ordersRequests = fake.log.filter((entry) => entry.paths.includes("src/pages/Orders.tsx"));
  check("automatic repair was bounded and never repeated an identical request", ordersRequests.length <= 4 && new Set(ordersRequests.map((entry) => entry.body)).size === ordersRequests.length, `${ordersRequests.length} requests, max_tokens ${ordersRequests.map((entry) => entry.maxTokens).join("→")}`);
  const filesBefore = await projectFiles(projectId);
  check("the failed build did not touch the project's source", filesBefore.size === 0);

  // 2. Restart the worker, Resume: Orders now finishes but Reports is still cut
  // off, so the resumed build fails again with more work saved.
  kill(worker);
  worker = startWorker("fixture-worker-3");
  await until("a ready worker", async () => (await admin.rpc("generation_ready", { p_max_age_seconds: 90 })).data, 60_000);
  fake.control.cutOff = ["src/pages/Reports.tsx"];
  const firstResumeAt = Date.now();
  await page.reload({ waitUntil: "networkidle" });
  const firstCard = page.locator("section[role=status]").filter({ hasText: "Resume" }).first();
  await firstCard.waitFor();
  const firstCardText = (await firstCard.textContent()) || "";
  check("the failure card offers Resume and shows saved progress and the failed step", /13 of 16 planned files are saved/.test(firstCardText) && /Stopped at: Orders\.tsx/.test(firstCardText), firstCardText.replace(/\s+/g, " ").slice(0, 220));
  await firstCard.getByRole("button", { name: "Resume" }).click();
  const second = await until("the first Resume to stop again", async () => { const r = (await builds(projectId)).find((b) => b.resume_of === failed.id); return r && ["failed", "succeeded", "cancelled"].includes(r.status) ? r : null; }, 180_000, 1000);
  const firstResumeFiles = logSince(fake.log, firstResumeAt).filter((entry) => entry.schema === "nynz_files");
  check("the first Resume reused all 13 saved files and finished Orders", firstResumeFiles.every((entry) => entry.paths.every((path) => ["src/pages/Orders.tsx", "src/pages/Reports.tsx"].includes(path))) && (second.checkpoint?.done || []).includes("src/pages/Orders.tsx"), firstResumeFiles.map((entry) => entry.paths.join("+")).join(" | "));
  check("the resumed build that failed again kept the newest checkpoint", second.status === "failed" && second.resumable && (second.checkpoint?.done || []).length === MANIFEST.files.length - 2 && second.checkpoint?.failed_step?.label === "Reports.tsx", `${second.checkpoint?.done?.length} saved; stopped at ${second.checkpoint?.failed_step?.label}`);

  // 3. Resume the newest failure, clicking repeatedly; only Reports is left.
  fake.control.cutOff = [];
  const resumeAt = Date.now();
  await page.reload({ waitUntil: "networkidle" });
  const card = page.locator("section[role=status]").filter({ hasText: "Resume" }).first();
  await card.waitFor();
  const cardText = (await card.textContent()) || "";
  check("the card now shows the newest checkpoint", /14 of 16 planned files are saved/.test(cardText) && /Stopped at: Reports\.tsx/.test(cardText), cardText.replace(/\s+/g, " ").slice(0, 220));
  await card.getByRole("button", { name: "Resume" }).dblclick();
  const extra = await Promise.all([1, 2, 3].map(() => page.request.post(`${APP}/api/builds/${second.id}/resume`)));
  const resumedIds = new Set((await Promise.all(extra.map(async (response) => (await response.json()).build?.id))).filter(Boolean));
  const resumed = await until("one resumed build to finish", async () => { const all = await builds(projectId); const r = all.filter((b) => b.resume_of === second.id); return r.length && ["succeeded", "failed"].includes(r[0].status) ? r : null; }, 180_000, 1000);
  check("repeated Resume clicks and duplicate requests started exactly one build", resumed.length === 1 && resumedIds.size <= 1 && (!resumedIds.size || resumedIds.has(resumed[0].id)), `${resumed.length} resumed build(s)`);
  check("the second Resume succeeded", resumed[0].status === "succeeded", resumed[0].error_message || "");
  const resumeFiles = logSince(fake.log, resumeAt).filter((entry) => entry.schema === "nynz_files");
  check("the second Resume generated only the last unfinished file", resumeFiles.length === 1 && resumeFiles[0].paths.join() === "src/pages/Reports.tsx", resumeFiles.map((entry) => entry.paths.join("+")).join(" | "));
  const chainIds = [first.id, second.id, resumed[0].id];
  const { data: chainCharges } = await admin.from("credit_ledger").select("event_key,build_id").eq("entry_type", "consume").in("build_id", chainIds).like("event_key", "openrouter:%");
  const fileResponses = new Map(fake.log.filter((entry) => entry.schema === "nynz_files").map((entry) => [`openrouter:${entry.id}`, entry.paths]));
  const chargedPaths = (chainCharges || []).flatMap((row) => fileResponses.get(row.event_key) || []);
  const okFiles = MANIFEST.files.map((file) => file.path).filter((path) => !["src/main.tsx", "src/pages/Orders.tsx", "src/pages/Reports.tsx"].includes(path));
  check("across the three builds, no saved file was charged again in a later build", okFiles.every((path) => (chainCharges || []).filter((row) => (fileResponses.get(row.event_key) || []).includes(path)).length === 1), `${chargedPaths.length} file slots charged in ${(chainCharges || []).length} responses`);
  const filesV1 = await projectFiles(projectId);
  check("the published app has every planned file", MANIFEST.files.every((file) => filesV1.has(file.path)), `${filesV1.size} files`);
  const { data: projectV1 } = await admin.from("projects").select("status,active_version_id,brief").eq("id", projectId).single();
  check("the preview was published only after validation", projectV1?.status === "ready" && Boolean(projectV1?.active_version_id));
  check("the original brief was saved with the project", String(projectV1?.brief?.original || "").includes("Manager and Staff demo accounts"));

  // Credits: each provider response charged once; holds released; history labelled.
  const buildIds = (await builds(projectId)).map((b) => b.id);
  const { data: consumes } = await admin.from("credit_ledger").select("event_key,amount,build_id").eq("entry_type", "consume").in("build_id", buildIds);
  const modelKeys = (consumes || []).map((row) => row.event_key).filter((key) => key?.startsWith("openrouter:"));
  check("no provider response was charged twice", new Set(modelKeys).size === modelKeys.length && modelKeys.every((key) => fake.log.some((entry) => `openrouter:${entry.id}` === key)), `${modelKeys.length} charged responses`);
  const { data: releases } = await admin.from("credit_ledger").select("metadata").eq("entry_type", "release").in("build_id", buildIds);
  check("unused holds were released for every finished build", (releases || []).length >= 2);
  await page.goto(`${APP}/billing`, { waitUntil: "domcontentloaded" });
  const history = (await page.locator("body").textContent()) || "";
  check("credit history separates credits used and unused holds released", /Used/.test(history) && /Unused hold released/.test(history) && /Build step:/.test(history) && !/openrouter|anthropic/i.test(history));

  // 4. Follow-up edit keeps the original features and repairs a compile error.
  fake.control.compileErrorOnce = true;
  const editAt = Date.now();
  await page.goto(`${APP}/projects/${projectId}`, { waitUntil: "networkidle", timeout: 120_000 });
  await ask(page, EDIT_REQUEST);
  await approvePlan(page);
  const edit = await until("the follow-up edit", async () => { const [b] = await builds(projectId); return b && b.mode === "edit" && ["succeeded", "failed", "cancelled"].includes(b.status) ? b : null; }, 180_000, 1000);
  check("the follow-up edit succeeded", edit.status === "succeeded", edit.error_message || "");
  const editLog = logSince(fake.log, editAt);
  const briefed = editLog.filter((entry) => ["nynz_manifest", "nynz_edit"].includes(entry.schema) && !entry.body.includes("Fix these production compiler errors"));
  check("planning and every edit step carried the original brief", briefed.length >= 2 && briefed.every((entry) => entry.brief), `${briefed.length} requests`);
  check("a compile error was repaired from the compiler output", editLog.some((entry) => entry.body.includes("Fix these production compiler errors")));
  const filesV2 = await projectFiles(projectId);
  check("all original screens are still present after the edit", SCREENS.every((name) => filesV2.has(`src/pages/${name}.tsx`) && filesV2.get(`src/pages/${name}.tsx`) === filesV1.get(`src/pages/${name}.tsx`)));
  check("the requested change was applied and the repair removed the error", (filesV2.get("src/App.tsx") || "").includes("theme-toggle") && !(filesV2.get("src/App.tsx") || "").includes("NYNZ_FIXTURE_COMPILE_ERROR"));
  const { data: projectV2 } = await admin.from("projects").select("active_version_id,brief").eq("id", projectId).single();
  check("the brief records the change as applied", projectV2?.brief?.changes?.some((change: { request: string; status: string }) => change.request === EDIT_REQUEST && change.status === "applied"));

  // 5. Stop during a build.
  fake.control.delayMs = 5_000;
  await ask(page, "Add a footer with store hours.");
  await approvePlan(page);
  const stopping = await until("the edit to start writing", async () => { const [b] = await builds(projectId); return b && b.status === "generating" && b.request === "Add a footer with store hours." ? b : null; }, 120_000, 300);
  await until("a provider request in flight", async () => fake.log.some((entry) => entry.at > Date.parse(stopping.created_at) && entry.schema === "nynz_edit"), 60_000, 200);
  await page.getByLabel("Stop build").click();
  const stopAccepted = await until("the stop to be accepted", async () => { const { data } = await admin.from("build_jobs").select("cancel_requested_at").eq("id", stopping.id).single(); return data?.cancel_requested_at ? Date.parse(data.cancel_requested_at) : null; }, 30_000, 100);
  const stopped = await until("the build to stop", async () => { const { data } = await admin.from("build_jobs").select("*").eq("id", stopping.id).single(); return data && data.status === "cancelled" && /credit/.test(data.error_message || "") ? data : null; }, 60_000, 500);
  check("no new provider request started after Stop was accepted", fake.log.filter((entry) => entry.at > stopAccepted + 250).length === 0, `${fake.log.filter((entry) => entry.at > stopAccepted).length} request(s) after`);
  check("Stop explains the final charge", /credits? (was|were) used for steps that had already started/.test(stopped.error_message || ""), stopped.error_message || "");
  const { data: projectAfterStop } = await admin.from("projects").select("active_version_id,status").eq("id", projectId).single();
  check("the last working version stayed live after Stop", projectAfterStop?.active_version_id === projectV2?.active_version_id && projectAfterStop?.status === "ready");
  fake.control.delayMs = 0;

  // 6. Insufficient credits: refused before any work, then mid-build with work saved.
  await page.context().clearCookies();
  const poorId = await user(`low-credits-${Date.now()}@fixture.test`, 8);
  const poorEmail = (await admin.auth.admin.getUserById(poorId)).data.user!.email!;
  await login(page, poorEmail);
  const poorAt = Date.now();
  const poorProject = await startFromDashboard(page, BRIEF);
  const review = page.getByLabel("Review build plan");
  await review.waitFor({ timeout: 120_000 });
  const reserveText = (await review.locator("text=Estimated cost").first().textContent()) || "";
  const reserve = Number(reserveText.match(/holds (\d+)/)?.[1] || 0);
  await review.getByRole("button", { name: "Approve and build" }).click();
  await review.locator("[role=alert]").waitFor({ timeout: 30_000 });
  const refusal = (await review.locator("[role=alert]").textContent()) || "";
  check("approval is refused with the amount needed when credits are short", /needs about \d+ credits held/.test(refusal), refusal);
  check("no code was generated after the refusal", logSince(fake.log, poorAt).every((entry) => entry.schema === "nynz_manifest"));
  // Enough for the hold, not for the whole build at a higher cost per step
  // (kept under the separate per-build AI limit so credits run out first).
  await grant(poorId, reserve + 4);
  fake.control.costUsd = 0.12;
  await page.reload({ waitUntil: "domcontentloaded" });
  await approvePlan(page);
  const short = await until("the build to pause for credits", async () => { const [b] = await builds(poorProject); return b && ["failed", "succeeded"].includes(b.status) ? b : null; }, 120_000, 1000);
  const lastRequest = fake.log.at(-1)!;
  const { data: spendAfter } = await admin.from("provider_spend").select("id").eq("build_id", short.id).gt("created_at", new Date(lastRequest.at + 50).toISOString());
  check("a mid-build credit shortfall stops before the next paid step, with work saved", short.status === "failed" && short.error_code === "INSUFFICIENT_CREDITS" && short.resumable && (short.checkpoint?.done || []).length > 0 && !(spendAfter || []).length, `${short.checkpoint?.done?.length} saved`);
  fake.control.costUsd = 0.02;
  await grant(poorId, 120);
  await page.reload({ waitUntil: "domcontentloaded" });
  const resumeCard = page.locator("section[role=status]").filter({ hasText: "Resume" }).first();
  await resumeCard.getByRole("button", { name: "Resume" }).click();
  const poorResumed = await until("the topped-up build to finish", async () => { const r = (await builds(poorProject)).find((b) => b.resume_of === short.id); return r && ["succeeded", "failed"].includes(r.status) ? r : null; }, 180_000, 1000);
  check("after adding credits, Resume finished the build", poorResumed.status === "succeeded", poorResumed.error_message || "");

  await browser.close();
  fake.close();
}

main()
  .catch((error) => { check("run completed", false, error instanceof Error ? error.message : String(error)); })
  .finally(() => {
    for (const child of children) kill(child);
    const failed = results.filter((result) => !result.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
  });
