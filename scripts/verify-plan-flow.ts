import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { stopE2B } from "../lib/platform/e2b";
import { redact } from "../lib/platform/redact";

config({ path: ".env.local", quiet: true });
const origin = process.env.VERIFY_APP_ORIGIN || "https://www.nynz.in";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const run = randomUUID();
const users: string[] = [];
const projects: string[] = [];
const sandboxes = new Set<string>();
let browser: Browser | undefined;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function ownerContext() {
  const email = `nynz-plan-${randomUUID()}@example.invalid`;
  const password = `Nynz-${randomUUID()}-9a!`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("Could not create disposable verification user");
  users.push(created.data.user.id);
  let cookies: Array<{ name: string; value: string }> = [];
  const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll: () => cookies, setAll: values => { cookies = values.map(({ name, value }) => ({ name, value })); } } });
  const signed = await auth.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error("Could not sign in verification user");
  const context = await browser!.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(cookies.map(cookie => ({ ...cookie, url: origin, httpOnly: false, secure: origin.startsWith("https:"), sameSite: "Lax" as const })));
  return context;
}

async function request(context: BrowserContext, path: string, method = "GET", data?: unknown) {
  const response = await context.request.fetch(`${origin}${path}`, { method, data });
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`API ${method} ${path}: ${response.status()} ${body.error || "Request failed"}`);
  return body;
}

async function waitJob(id: string, condition: (job: any) => boolean, label: string) {
  let last = "";
  for (let i = 0; i < 240; i += 1) {
    const { data, error } = await db.from("build_jobs").select("*").eq("id", id).single();
    if (error || !data) throw new Error(`${label}: could not read job`);
    const state = `${data.status}:${data.plan?.approval || ""}`;
    if (state !== last) { console.log(`${label}: ${state}`); last = state; }
    if (data.status === "failed") throw new Error(`${label}: ${data.error_code} ${data.error_message}`);
    if (condition(data)) return data;
    await wait(2000);
  }
  throw new Error(`${label} exceeded eight minutes`);
}

try {
  browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const owner = await ownerContext();
  const stranger = await ownerContext();
  const { project } = await request(owner, "/api/projects", "POST", { name: `Calculator approval verification ${run}`, description: "Disposable approval, create, correction and preview test" });
  projects.push(project.id);
  const base = `/api/projects/${project.id}`;
  const started = Date.now();
  const { build } = await request(owner, `${base}/builds`, "POST", { prompt: "Build a polished, responsive calculator called NYNZ Calculator Verified. Support arithmetic, decimals, clear, backspace, keyboard input, and an accessible result display labelled Result. Use ordinary CSS, local React state and lucide-react only. Do not use eval, Function, a backend, or a marketing homepage. Buttons must have accessible names matching their visible symbols; use +, -, ×, ÷ and =. Keep it compact and focused.", mode: "create", idempotencyKey: `plan-test-${run}` });
  if (build.plan?.approval !== "required") throw new Error("Build API did not request plan approval");
  const planned = await waitJob(build.id, job => job.plan?.approval === "awaiting", "Plan");
  console.log(`Plan ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const before = await db.from("project_files").select("path").eq("project_id", project.id);
  if (before.data?.length) throw new Error("Code was written before approval");
  await wait(5000);
  const held = await db.from("build_jobs").select("status,locked_by,plan").eq("id", build.id).single();
  if (held.data?.plan.approval !== "awaiting" || held.data.locked_by) throw new Error("Pending review did not release the worker lease");
  const forbidden = await stranger.request.patch(`${origin}${base}/builds`, { data: { action: "approve", buildId: build.id, revision: planned.plan.revision, summary: planned.plan.summary, steps: planned.plan.steps } });
  if (![403, 404].includes(forbidden.status())) throw new Error("Another user could access the plan");
  const page = await owner.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/projects/${project.id}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Approve and build", exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/nynz-plan-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.screenshot({ path: "/tmp/nynz-plan-mobile.png", fullPage: true });
  await page.getByLabel("Requested plan changes").fill("Use a warm ivory background and dark navy calculator keys. Keep the app title NYNZ Calculator Verified.");
  await page.getByRole("button", { name: "Revise plan", exact: true }).click();
  const revised = await waitJob(build.id, job => job.plan?.approval === "awaiting" && job.plan.revision === 2, "Revised plan");
  const notWritten = await db.from("project_files").select("path").eq("project_id", project.id);
  if (notWritten.data?.length) throw new Error("Revision generated code before approval");
  await page.getByRole("button", { name: "Approve and build", exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Edit plan", exact: true }).click();
  await page.getByLabel("Plan summary").fill(`${revised.plan.summary} Use clear, concise labels.`);
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  const approvedAt = Date.now();
  await page.getByRole("button", { name: "Approve and build", exact: true }).click();
  const staleApproval = await owner.request.patch(`${origin}${base}/builds`, { data: { action: "approve", buildId: build.id, revision: 1, summary: planned.plan.summary, steps: planned.plan.steps } });
  if (staleApproval.status() !== 409) throw new Error("Stale approval was not rejected");
  await waitJob(build.id, job => job.status === "succeeded", "Approved create");
  const built = await db.from("projects").select("active_sandbox_id").eq("id", project.id).single();
  sandboxes.add(built.data!.active_sandbox_id);
  console.log(`Approved create finished in ${((Date.now() - approvedAt) / 1000).toFixed(1)}s`);
  const session = await request(owner, `${base}/preview-session`, "POST");
  const preview = await owner.newPage();
  preview.on("pageerror", error => errors.push(error.message));
  await preview.goto(session.url, { waitUntil: "networkidle", timeout: 60000 });
  await preview.getByText("NYNZ Calculator Verified", { exact: false }).first().waitFor();
  await preview.getByRole("button", { name: "2", exact: true }).click();
  await preview.getByRole("button", { name: "+", exact: true }).click();
  await preview.getByRole("button", { name: "3", exact: true }).click();
  await preview.getByRole("button", { name: "=", exact: true }).click();
  const display = preview.getByLabel("Result", { exact: true });
  const result = await display.evaluate(element => element instanceof HTMLInputElement ? element.value : element.textContent);
  if (result?.trim() !== "5") throw new Error("Calculator arithmetic did not produce 5");
  await preview.screenshot({ path: "/tmp/nynz-calculator-verified.png", fullPage: true });
  await preview.reload({ waitUntil: "networkidle" });
  await preview.getByText("NYNZ Calculator Verified", { exact: false }).first().waitFor();
  const denied = await stranger.request.get(new URL(session.url).origin);
  if (denied.status() !== 401) throw new Error("Preview was accessible without a preview session");
  const { build: edit } = await request(owner, `${base}/builds`, "POST", { prompt: "Change only the application title from NYNZ Calculator Verified to NYNZ Calculator Updated. Preserve arithmetic, keyboard input, all buttons, and the existing ivory/navy design.", mode: "edit", idempotencyKey: `edit-test-${run}` });
  const editPlan = await waitJob(edit.id, job => job.plan?.approval === "awaiting", "Edit plan");
  await request(owner, `${base}/builds`, "PATCH", { action: "approve", buildId: edit.id, revision: editPlan.plan.revision, summary: editPlan.plan.summary, steps: editPlan.plan.steps });
  await waitJob(edit.id, job => job.status === "succeeded", "Approved edit");
  const editSession = await request(owner, `${base}/preview-session`, "POST");
  await preview.goto(editSession.url, { waitUntil: "networkidle", timeout: 60000 });
  await preview.getByText("NYNZ Calculator Updated", { exact: false }).first().waitFor();
  console.log("Contextual edit preview verified");
  const { build: cancelBuild } = await request(owner, `${base}/builds`, "POST", { prompt: "Add a history panel to this calculator", mode: "edit", idempotencyKey: `cancel-test-${run}` });
  const cancelPlan = await waitJob(cancelBuild.id, job => job.plan?.approval === "awaiting", "Cancel plan");
  await request(owner, `${base}/builds`, "PATCH", { action: "cancel", buildId: cancelBuild.id, revision: cancelPlan.plan.revision });
  const cancelled = await db.from("build_jobs").select("status").eq("id", cancelBuild.id).single();
  if (cancelled.data?.status !== "cancelled") throw new Error("Plan cancellation did not stop the request");
  console.log("Plan cancellation verified");
  const usage = await request(owner, base);
  if (!usage.usage?.credits || !usage.usage?.modelCostPaise) throw new Error("Actual usage was not recorded");
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log(JSON.stringify({ passed: true, checks: ["plan before code", "worker released during review", "owner authorization", "revision before code", "editable plan", "explicit browser approval", "stale approval denied", "production build", "calculator 2+3=5", "preview refresh", "unauthorized preview 401", "contextual edit", "cancel before code", "actual cost"], costInr: usage.usage.modelCostPaise / 100 }));
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  for (const id of projects) {
    const { data } = await db.from("projects").select("active_sandbox_id").eq("id", id).maybeSingle();
    if (data?.active_sandbox_id) sandboxes.add(data.active_sandbox_id);
    await db.from("projects").delete().eq("id", id);
  }
  for (const id of sandboxes) await stopE2B(id).catch(() => undefined);
  for (const id of users) await db.auth.admin.deleteUser(id);
  await browser?.close();
  console.log("Disposable plan verification resources cleaned up");
}
