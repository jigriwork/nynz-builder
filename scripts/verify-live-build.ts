import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright-core";
import { createPreviewSession, getPreviewOrigin } from "../lib/preview/session";
import { stopE2B } from "../lib/platform/e2b";

config({ path: ".env.local", quiet: true });
// This command verifies the deployed gateway, never the optional local proxy.
process.env.PREVIEW_ORIGIN = process.env.LIVE_PREVIEW_ORIGIN || "https://preview.nynz.in";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("Supabase worker environment is incomplete");

const db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID();
const email = `nynz-build-${run}@example.invalid`;
const sandboxes = new Set<string>();
let userId = "";
let projectId = "";
let browser: Browser | null = null;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function queueBuild(prompt: string, mode: "create" | "edit" | "restart", conversationId: string) {
  const queued = await db.from("build_jobs").insert({ project_id: projectId, requested_by: userId, conversation_id: conversationId, prompt, mode, idempotency_key: `${run}-${mode}-${randomUUID()}` }).select("id").single();
  if (queued.error || !queued.data) throw new Error(`Could not queue ${mode} build: ${queued.error?.message}`);
  await db.from("projects").update({ status: "queued", last_error: null }).eq("id", projectId);
  return queued.data.id;
}

async function waitForBuild(buildId: string, label: string) {
  let previousStatus = "";
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const job = await db.from("build_jobs").select("status,error_message").eq("id", buildId).single();
    if (job.error || !job.data) throw new Error(`Could not read ${label} build: ${job.error?.message}`);
    if (job.data.status !== previousStatus) { console.log(`${label} stage: ${job.data.status}`); previousStatus = job.data.status; }
    if (job.data.status === "succeeded") return;
    if (["failed", "cancelled"].includes(job.data.status)) throw new Error(`${label} ended as ${job.data.status}: ${job.data.error_message || "No error detail"}`);
    await wait(2_000);
  }
  throw new Error(`${label} did not complete within six minutes`);
}

async function currentProject() {
  const result = await db.from("projects").select("status,active_sandbox_id,preview_url,last_error").eq("id", projectId).single();
  if (result.error || !result.data?.active_sandbox_id) throw new Error(`Preview project is incomplete: ${result.error?.message || result.data?.last_error || "missing sandbox"}`);
  sandboxes.add(result.data.active_sandbox_id);
  return result.data;
}

function signedPreviewUrl(sandboxId: string) {
  const session = createPreviewSession({ projectId, userId, sandboxId, expiresAt: Date.now() + 5 * 60_000 });
  const previewUrl = new URL(getPreviewOrigin(projectId));
  previewUrl.searchParams.set("ny_session", session);
  return previewUrl.toString();
}

async function assertPreview(page: Page, sandboxId: string, expectedText: string, label: string) {
  const response = await page.goto(signedPreviewUrl(sandboxId), { waitUntil: "networkidle", timeout: 60_000 });
  if (!response?.ok()) throw new Error(`${label} browser navigation returned HTTP ${response?.status() || 0}`);
  await page.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 30_000 });
  const assets = await page.locator("script[src],link[rel=stylesheet][href]").count();
  if (!assets) throw new Error(`${label} did not load JavaScript or CSS assets`);
  const nested = await page.goto(`${getPreviewOrigin(projectId)}/nested/route`, { waitUntil: "networkidle", timeout: 60_000 });
  if (!nested?.ok()) throw new Error(`${label} nested route returned HTTP ${nested?.status() || 0}`);
  await page.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 30_000 });
  const refreshed = await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  if (!refreshed?.ok()) throw new Error(`${label} refresh returned HTTP ${refreshed?.status() || 0}`);
  await page.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 30_000 });
  console.log(`${label} browser preview OK: HTML, JS/CSS assets, nested route, refresh`);
}

try {
  const createdUser = await db.auth.admin.createUser({ email, password: `Nynz-${run}-Aa1!`, email_confirm: true });
  if (createdUser.error || !createdUser.data.user) throw new Error(`Could not create verification user: ${createdUser.error?.message}`);
  userId = createdUser.data.user.id;

  const createdProject = await db.from("projects").insert({ owner_id: userId, name: "NYNZ end-to-end verification", description: "Disposable generation and E2B preview verification" }).select("id").single();
  if (createdProject.error || !createdProject.data) throw new Error(`Could not create verification project: ${createdProject.error?.message}`);
  projectId = createdProject.data.id;
  const conversation = await db.from("conversations").insert({ project_id: projectId }).select("id").single();
  if (conversation.error || !conversation.data) throw new Error(`Could not create verification conversation: ${conversation.error?.message}`);

  const chromePath = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find(existsSync);
  if (!chromePath) throw new Error("A Chromium browser is required for preview verification");
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const createId = await queueBuild("Build a minimal polished single-page React app. Show the exact heading NYNZ live build verified and a short paragraph. Use the starter only and include clean responsive styling.", "create", conversation.data.id);
  await waitForBuild(createId, "Create");
  const first = await currentProject();
  await assertPreview(page, first.active_sandbox_id, "NYNZ live build verified", "Create");
  await page.screenshot({ path: "/tmp/nynz-live-preview-created.png", fullPage: true });

  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  const denied = await anonymousPage.goto(getPreviewOrigin(projectId), { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (denied?.status() !== 401) throw new Error(`Unauthorised preview returned HTTP ${denied?.status() || 0}, expected 401`);
  await anonymousContext.close();
  console.log("Unauthorised browser preview correctly denied with HTTP 401");

  const editId = await queueBuild("Change the main heading to exactly NYNZ edit verified. Keep the app responsive and preserve the existing design.", "edit", conversation.data.id);
  await waitForBuild(editId, "Edit");
  const edited = await currentProject();
  if (edited.active_sandbox_id === first.active_sandbox_id) throw new Error("Edit did not replace the sandbox");
  await assertPreview(page, edited.active_sandbox_id, "NYNZ edit verified", "Edit");
  await page.screenshot({ path: "/tmp/nynz-live-preview-edited.png", fullPage: true });

  const restartId = await queueBuild("Restart the current application without changing its files.", "restart", conversation.data.id);
  await waitForBuild(restartId, "Restart");
  const restarted = await currentProject();
  if (restarted.active_sandbox_id === edited.active_sandbox_id) throw new Error("Restart did not create a replacement sandbox");
  await assertPreview(page, restarted.active_sandbox_id, "NYNZ edit verified", "Restart");

  const [files, versions] = await Promise.all([db.from("project_files").select("path").eq("project_id", projectId), db.from("versions").select("id").eq("project_id", projectId)]);
  if (!files.data?.length || (versions.data?.length || 0) < 3) throw new Error("Build files or version checkpoints were not persisted");
  if (pageErrors.length) throw new Error(`Generated app raised browser errors: ${pageErrors.join("; ")}`);
  console.log(`End-to-end verification passed with ${files.data.length} files and ${versions.data?.length || 0} versions`);
} finally {
  await browser?.close().catch(() => undefined);
  for (const sandboxId of sandboxes) await stopE2B(sandboxId).catch(() => undefined);
  if (projectId) await db.from("projects").delete().eq("id", projectId);
  if (userId) await db.auth.admin.deleteUser(userId);
  console.log("Verification resources cleaned up");
}
