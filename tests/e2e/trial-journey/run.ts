/**
 * Local new-customer journey with the revised trial and preview billing
 * sessions: signup through the first working preview, then a second new
 * customer after the day's trial budget is used up. Runs against a local
 * Supabase stack, the real worker and Next app, the scripted AI provider and
 * the local preview stand-in. Every production setting is blanked.
 *
 *   npx tsx tests/e2e/trial-journey/run.ts <supabase-workdir>
 *
 * The local auth stack does not require email confirmation (production does),
 * so the confirmation email itself is not exercised here. The preview visit
 * is made by calling the same database function the preview host calls, with
 * the same arguments (sessionExtensionArgs); the hosted preview proxy is not
 * run locally.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright-core";
import { startFakeOpenRouter } from "../studiomark/fake-openrouter";
import { BRIEF } from "../studiomark/fixture";
import { sessionExtensionArgs } from "../../../preview-host/lib/runtime";
import { settleSandboxSessions } from "../../../lib/billing/sessions";

const workdir = process.argv[2];
const OUT = process.env.E2E_ARTIFACTS || "/tmp";
const local = Object.fromEntries(execFileSync("supabase", ["status", "-o", "env", "--workdir", workdir], { encoding: "utf8" }).split("\n").filter((line) => line.includes("=")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, "")]; }));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(local.API_URL)) throw new Error("Refusing to run: Supabase API is not local");
const APP = "http://127.0.0.1:3200";
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); console.log(results.at(-1)); };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 120_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = await fn(); if (value) return value as T; await wait(500); }
  throw new Error(`Timed out waiting for ${what}`);
}
const BLANK = ["E2B_API_KEY", "E2B_SANDBOX_TIMEOUT_MS", "FIRECRAWL_API_KEY", "SARVAM_API_KEY", "SARVAM_BASE_URL", "SARVAM_MODEL", "VERCEL_OIDC_TOKEN", "VERCEL_TOKEN", "PREVIEW_VERCEL_PROJECT_ID", "PREVIEW_VERCEL_TEAM_ID", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
const env = {
  ...process.env, ...Object.fromEntries(BLANK.map((name) => [name, ""])),
  NODE_ENV: "development" as const, NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  OPENROUTER_API_KEY: "local-fixture-only", OPENROUTER_BASE_URL: "http://127.0.0.1:4011/api/v1", NYNZ_LOCAL_FIXTURE_SANDBOX: "1",
  PREVIEW_ORIGIN: "http://{projectId}.preview.localhost:3001", NEXT_PUBLIC_SITE_URL: APP, TRIAL_CREDITS: "60", TRIAL_DAYS: "7", BUILD_RATE_PER_HOUR: "200", PREVIEW_SIGNING_SECRET: "local-journey-only-0123456789abcdef0123456789",
};
const children: ChildProcess[] = [];
const start = (cmd: string, args: string[], extra: Record<string, string> = {}) => { const c = spawn(cmd, args, { env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"], detached: true }); children.push(c); return c; };
const kill = (c: ChildProcess) => { try { if (c.pid) process.kill(-c.pid, "SIGKILL"); } catch { /* gone */ } };
const balance = async (user: string) => (await admin.rpc("credit_balance", { p_user: user })).data as { available: number; reserved: number; used: number };

async function signup(page: Page, email: string) {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByRole("button", { name: "Create one" }).click();
  await page.fill("#email", email); await page.fill("#password", "journey-password-1");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 90_000 });
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  return data.users.find((u) => u.email === email)!.id;
}
async function submitBrief(page: Page) {
  await page.waitForLoadState("networkidle");
  const box = page.getByLabel("Application description");
  await box.fill(BRIEF); await box.press("End"); await box.pressSequentially(" ");
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 90_000 });
  return page.url().match(/projects\/([0-9a-f-]{36})/)![1];
}

async function main() {
  const fake = await startFakeOpenRouter(4011);
  fake.control.app = "small";
  start("npx", ["tsx", "scripts/worker.ts"], { WORKER_ID: "journey-worker" });
  start("npx", ["next", "dev", "-p", "3200", "-H", "127.0.0.1"]);
  await until("the app", async () => (await fetch(`${APP}/login`).catch(() => null))?.ok, 180_000);
  await until("a ready worker", async () => (await admin.rpc("generation_ready", { p_max_age_seconds: 90 })).data, 60_000);
  await admin.from("spend_limits").update({ limit_paise: 30000, active: true }).eq("scope", "trial");
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

  // 1. Sign up. No credits until the first request.
  const userId = await signup(page, `journey-${Date.now()}@example.com`);
  check("signup lands on the dashboard with no credits yet", Number((await balance(userId)).available) === 0);

  // 2. First request: 60 trial credits for 7 days, 5 held for planning.
  const projectId = await submitBrief(page);
  const review = page.getByLabel("Review build plan");
  await review.waitFor({ timeout: 120_000 });
  await page.waitForLoadState("networkidle");
  const { data: grant } = await admin.from("credit_grants").select("source,amount,expires_at").eq("user_id", userId).single();
  const days = (Date.parse(grant!.expires_at) - Date.now()) / 86_400_000;
  check("the trial grant is 60 credits that expire in 7 days", grant!.source === "trial" && grant!.amount === 60 && days > 6.9 && days <= 7, `${grant!.amount} ${grant!.source}, ${days.toFixed(2)} days`);
  const estimate = ((await review.locator("text=Estimated cost").first().textContent()) || "").replace(/\s+/g, " ");
  const hold = Number(estimate.match(/holds (\d+)/)?.[1]);
  const afterPlan = await balance(userId);
  check("the plan shows its estimate and hold, and the trial can cover the hold", hold > 0 && Number(afterPlan.available) + Number(afterPlan.reserved) >= hold, `${estimate.slice(0, 70)}; available ${afterPlan.available}, held ${afterPlan.reserved}`);
  await page.screenshot({ path: `${OUT}/journey-1-plan.png` });

  // 3. Approve and build.
  for (let i = 0; i < 5; i += 1) {
    await review.getByRole("button", { name: "Approve and build" }).click().catch(() => undefined);
    await wait(2000);
    const { data } = await admin.from("build_jobs").select("plan").eq("project_id", projectId).single();
    if (data?.plan?.approval === "approved") break;
  }
  const build = await until("the build", async () => { const { data } = await admin.from("build_jobs").select("*").eq("project_id", projectId).single(); return data && ["succeeded", "failed"].includes(data.status) ? data : null; }, 180_000);
  check("the first build succeeds within the trial", build.status === "succeeded", build.error_message || "");
  const { data: ledger } = await admin.from("credit_ledger").select("entry_type,amount,metadata").eq("build_id", build.id).order("id");
  const peak = (ledger || []).filter((r) => r.entry_type === "reserve").reduce((sum, r) => sum + Number(r.metadata?.held || 0), 0);
  const buildUsed = (ledger || []).filter((r) => r.entry_type === "consume").reduce((sum, r) => sum - r.amount, 0);
  const sandboxCharged = (ledger || []).filter((r) => r.entry_type === "consume" && String(r.metadata?.step || "").startsWith("Preview environment")).length;
  check("the build is not charged for its sandbox (the preview session is)", sandboxCharged === 0, `build used ${buildUsed}, peak hold ${peak}`);
  const { data: session } = await admin.from("sandbox_sessions").select("*").eq("project_id", projectId).single();
  check("one billing session opened with the sandbox, holding its first 600 s", session?.status === "open" && Number(session.held_credits) === 3, `held ${session?.held_credits}`);

  // 4. First working preview: the builder shows it, and the visit is held before runtime is extended.
  await page.reload({ waitUntil: "networkidle" });
  const live = await page.locator("iframe").first().isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/journey-2-built.png` });
  const firstVisit = new Date(Date.parse(session!.started_at) + 90_000);
  const visit = await admin.rpc("extend_sandbox_session", { ...sessionExtensionArgs(session!.sandbox_id, projectId, userId, 600, {}), p_at: firstVisit.toISOString() });
  const later = await admin.rpc("extend_sandbox_session", { ...sessionExtensionArgs(session!.sandbox_id, projectId, userId, 600, {}), p_at: new Date(firstVisit.getTime() + 150_000).toISOString() });
  check("the first preview opens: the builder shows it and the visit is held", live && !visit.error && !later.error && Number(later.data.held) >= 3, `held ${later.data?.held} credits until ${String(later.data?.covered_until).slice(11, 19)}`);
  // The sandbox pauses 600 s after the last visit; maintenance settles the actual time.
  const settledAt = new Date(firstVisit.getTime() + 150_000 + 600_000 + 120_000);
  await settleSandboxSessions({ db: admin, sandboxInfo: async () => ({ state: "gone" }), now: settledAt });
  const { data: done } = await admin.from("sandbox_sessions").select("*").eq("id", session!.id).single();
  const expectedSeconds = Math.round((firstVisit.getTime() + 150_000 + 600_000 - Date.parse(session!.started_at)) / 1000);
  check("the session settles once at its actual running time and releases the rest", done!.status === "settled" && Math.abs(done!.runtime_seconds - expectedSeconds) <= 1 && Number((await balance(userId)).reserved) === 0, `${done!.runtime_seconds} s → ${done!.charged_credits} credits (held ${done!.held_credits})`);
  const final = await balance(userId);
  check("the trial covers the first app and its first preview with credits left", Number(final.available) > 0, `used ${final.used} of 60 (build ${buildUsed}, preview ${done!.charged_credits}); ${final.available} left`);
  await page.goto(`${APP}/billing`, { waitUntil: "networkidle" });
  const history = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check("credit history shows the preview time as one charge with its duration", /Preview time: \d+ min \d+ s running/.test(history) && /Unused hold released/.test(history));
  await page.screenshot({ path: `${OUT}/journey-3-billing.png`, fullPage: true });

  // 5. The day's trial budget is used up: a new customer is told before any work starts.
  await admin.from("spend_limits").update({ limit_paise: 1 }).eq("scope", "trial");
  await page.context().clearCookies();
  const second = await signup(page, `journey-late-${Date.now()}@example.com`);
  const secondProject = await submitBrief(page);
  const notice = await until("the trial message", async () => { const t = (await page.locator("body").innerText()).replace(/\s+/g, " "); return /Free trial building is paused for today/.test(t) ? t : null; }, 60_000);
  await page.screenshot({ path: `${OUT}/journey-4-trial-budget.png` });
  const { count: secondBuilds } = await admin.from("build_jobs").select("id", { count: "exact", head: true }).eq("project_id", secondProject);
  const secondBalance = await balance(second);
  check("when the trial budget is used up, the customer sees why before any work starts", secondBuilds === 0 && Number(secondBalance.reserved) === 0, (notice.match(/Free trial building is paused for today[^.]*\./) || [""])[0]);
  const paid = (await admin.auth.admin.createUser({ email: `paid-${Date.now()}@example.com`, password: "x-password-123", email_confirm: true })).data.user!.id;
  await admin.rpc("grant_credits", { p_user: paid, p_source: "plan_included", p_amount: 100, p_expires_at: null, p_reason: "Plan", p_actor: null, p_idempotency: `paid:${paid}` });
  const paidOk = await admin.rpc("trial_budget_open", { p_user: paid });
  check("paid accounts are unaffected by the trial budget", paidOk.data === true);
  await admin.from("spend_limits").update({ limit_paise: 30000 }).eq("scope", "trial");

  await browser.close();
  fake.close();
}

main()
  .catch((error) => check("run completed", false, error instanceof Error ? error.message : String(error)))
  .finally(() => { for (const c of children) kill(c); const failed = results.filter((r) => r.startsWith("FAIL")); console.log(`\n${results.length - failed.length}/${results.length} checks passed`); process.exit(failed.length ? 1 : 0); });
