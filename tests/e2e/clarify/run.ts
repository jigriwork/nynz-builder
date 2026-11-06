/**
 * Clarifying questions before planning, locally: the real Next app and worker
 * against a local Supabase stack and the scripted AI provider (which asks only
 * for a short, open brief, like the planner rules). Three flows:
 *   1. vague brief, answered: questions, then a plan showing the decisions;
 *      on approval the decisions are in the project brief;
 *   2. vague brief, "continue with my assumptions": the plan shows them, with
 *      no second planning request;
 *   3. clear brief: straight to the plan, no questions.
 *
 *   npx tsx tests/e2e/clarify/run.ts <supabase-workdir>
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright-core";
import { startFakeOpenRouter } from "../studiomark/fake-openrouter";
import { BRIEF as CLEAR_BRIEF } from "../studiomark/fixture";

const workdir = process.argv[2];
const OUT = process.env.E2E_ARTIFACTS || "/tmp";
const local = Object.fromEntries(execFileSync("supabase", ["status", "-o", "env", "--workdir", workdir], { encoding: "utf8" }).split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(local.API_URL)) throw new Error("Refusing to run: Supabase API is not local");
const APP = "http://127.0.0.1:3500";
const FAKE = "http://127.0.0.1:4012";
const VAGUE = "Build an orders app for my boutique.";
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); console.log(results.at(-1)); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 120_000): Promise<T> { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v as T; await wait(500); } throw new Error(`Timed out waiting for ${what}`); }
const BLANK = ["E2B_API_KEY", "E2B_SANDBOX_TIMEOUT_MS", "FIRECRAWL_API_KEY", "SARVAM_API_KEY", "SARVAM_BASE_URL", "SARVAM_MODEL", "VERCEL_OIDC_TOKEN", "VERCEL_TOKEN", "PREVIEW_VERCEL_PROJECT_ID", "PREVIEW_VERCEL_TEAM_ID", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
const env = { ...process.env, ...Object.fromEntries(BLANK.map((n) => [n, ""])), NODE_ENV: "development" as const, NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  OPENROUTER_API_KEY: "local-fixture-only", OPENROUTER_BASE_URL: `${FAKE}/api/v1`, NYNZ_LOCAL_FIXTURE_SANDBOX: "1", PREVIEW_ORIGIN: "http://{projectId}.preview.localhost:3001", NEXT_PUBLIC_APP_URL: APP, BUILD_RATE_PER_HOUR: "200", PREVIEW_SIGNING_SECRET: "local-clarify-only-0123456789abcdef0123456789" };
const children: ChildProcess[] = [];
const start = (cmd: string, args: string[], extra: Record<string, string> = {}) => { const c = spawn(cmd, args, { env: { ...env, ...extra }, stdio: "ignore", detached: true }); children.push(c); return c; };
const planCalls = async () => ((await (await fetch(`${FAKE}/__log`)).json()) as Array<{ schema: string; body: string }>).filter((l) => l.schema === "nynz_manifest");

async function submit(page: Page, brief: string) {
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
  const box = page.getByLabel("Application description");
  await box.fill(brief); await box.press("End"); await box.pressSequentially(" ");
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 90_000 });
  return page.url().match(/projects\/([0-9a-f-]{36})/)![1];
}
const ledger = async (buildId: string) => {
  const { data } = await admin.from("credit_ledger").select("entry_type,amount,metadata").eq("build_id", buildId).order("id");
  const held = (data || []).filter((r) => r.entry_type === "reserve").reduce((s, r) => s + Number(r.metadata?.held || 0), 0);
  const used = (data || []).filter((r) => r.entry_type === "consume").reduce((s, r) => s - Number(r.amount), 0);
  const steps = (data || []).filter((r) => r.entry_type === "consume").map((r) => `${r.metadata?.step || "?"} ${-r.amount}`);
  return { held, used, steps };
};
const generationCalls = async (since: number) => ((await (await fetch(`${FAKE}/__log`)).json()) as Array<{ schema: string }>).slice(since).filter((l) => ["nynz_files", "nynz_edit", "nynz_styles"].includes(l.schema)).length;
const logSize = async () => ((await (await fetch(`${FAKE}/__log`)).json()) as unknown[]).length;
const job = async (projectId: string) => (await admin.from("build_jobs").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).single()).data;

async function main() {
  const fake = await startFakeOpenRouter(4012);
  fake.control.app = "small";
  start("npx", ["tsx", "scripts/worker.ts"], { WORKER_ID: "clarify-worker" });
  start("npx", ["next", "dev", "-p", "3500", "-H", "127.0.0.1"]);
  await until("the app", async () => (await fetch(`${APP}/login`).catch(() => null))?.ok, 180_000);
  await until("a ready worker", async () => (await admin.rpc("generation_ready", { p_max_age_seconds: 90 })).data, 90_000);
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  // Each flow uses its own account, so one flow's build never holds another's build slot.
  const signedIn = async (label: string) => {
    const email = `clarify-${label}-${Date.now()}@example.com`, password = `Pw-${randomUUID()}`;
    const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    await admin.rpc("grant_credits", { p_user: data.user!.id, p_source: "promotional", p_amount: 300, p_expires_at: null, p_reason: "fixture", p_actor: null, p_idempotency: `clarify:${data.user!.id}` });
    const p = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    await p.goto(`${APP}/login`, { waitUntil: "networkidle" });
    await p.fill("#email", email); await p.fill("#password", password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await p.waitForURL(/\/dashboard/, { timeout: 60_000 });
    return p;
  };
  let page = await signedIn("answer");
  try {

    // 1. Vague brief, answered.
    const before1 = (await planCalls()).length;
    const p1 = await submit(page, VAGUE);
    const card = page.getByTestId("clarify-card");
    await card.waitFor({ timeout: 120_000 });
    const asked = (await card.innerText()).replace(/\s+/g, " ");
    check("vague brief: NYNZ asks two questions that change how the app works, with options and a recommendation, before any code", /Two quick choices before I plan/.test(asked) && /only in this browser, or shared/.test(asked) && /different permissions/.test(asked) && /recommended/i.test(asked) && (await job(p1)).plan.approval === "questions");
    check("the questions say no code was written and list the assumptions if you continue", /No code has been written/.test(asked) && /If you continue, I'll assume/.test(asked));
    await page.screenshot({ path: `${OUT}/clarify-1-questions.png` });
    // Waiting for answers cannot start generation.
    const waiting = await job(p1);
    const mark = await logSize();
    const approve = await page.request.patch(`${APP}/api/projects/${p1}/builds`, { data: { action: "approve", buildId: waiting.id, revision: waiting.plan.revision, summary: waiting.plan.summary, steps: waiting.plan.steps } });
    const another = await page.request.post(`${APP}/api/projects/${p1}/builds`, { data: { prompt: "Build something else", mode: "create", idempotencyKey: randomUUID() } });
    await wait(8000);
    const still = await job(p1);
    check("while questions wait: approving is refused, another request is refused, nothing is generated", approve.status() === 409 && another.status() === 409 && still.status === "planning" && still.plan.approval === "questions" && !still.locked_by && (await generationCalls(mark)) === 0,
      `approve ${approve.status()}, new request ${another.status()}, status ${still.status}`);
    const waitCredits = await ledger(waiting.id);
    check("while questions wait, credits: the plan hold is held, only the planning request was charged", waitCredits.held === 5 && waitCredits.steps.length === 1 && /Planning the build/.test(waitCredits.steps[0]), `held ${waitCredits.held}, charged ${waitCredits.used} (${waitCredits.steps.join("; ")})`);
    await page.reload({ waitUntil: "networkidle" });
    check("the questions are still there after a refresh", await page.getByTestId("clarify-card").isVisible());
    await card.getByRole("button", { name: /Shared between devices/ }).click();
    await card.getByLabel("Your own answer to question 2").fill("Me and one staff member who can only add orders");
    const beforeAnswer = (await planCalls()).length;
    // A duplicate answer arriving at the same time as the click.
    const dup = page.request.patch(`${APP}/api/projects/${p1}/builds`, { data: { action: "answer", buildId: waiting.id, revision: waiting.plan.revision, answers: [{ id: "data", answer: "Shared between devices" }, { id: "people", answer: "Me and one staff member who can only add orders" }] } });
    await card.getByRole("button", { name: "Use my answers" }).click();
    const dupStatus = (await dup).status();
    const review = page.getByLabel("Review build plan");
    await review.waitFor({ timeout: 120_000 });
    const understood = (await page.getByTestId("what-i-understood").innerText()).replace(/\s+/g, " ");
    check("after answering, the plan shows your decisions before approval", /Your decisions/.test(understood) && /Shared between devices/.test(understood) && /one staff member who can only add orders/.test(understood), understood.slice(0, 260));
    const j1 = await job(p1);
    const calls1 = (await planCalls()).slice(before1);
    check("the answers were used to plan again, marked final so NYNZ does not ask twice", calls1.length === 2 && /Shared between devices/.test(calls1[1].body) && /DECISIONS ARE FINAL/.test(calls1[1].body) && j1.plan.approval === "awaiting" && j1.plan.decisions?.length === 2);
    const { count: jobs1 } = await admin.from("build_jobs").select("id", { count: "exact", head: true }).eq("project_id", p1);
    check("a duplicate answer sent at the same moment makes one plan: one job, one extra planning request", jobs1 === 1 && (await planCalls()).length - beforeAnswer === 1 && (dupStatus === 202 || dupStatus === 409), `duplicate answered ${dupStatus}; ${jobs1} job`);
    const answeredCredits = await ledger(j1.id);
    check("answering costs one more planning request; nothing else is charged before approval", answeredCredits.steps.length === 2 && answeredCredits.steps.every((x) => /Planning the build/.test(x)), `charged ${answeredCredits.used} (${answeredCredits.steps.join("; ")}), held ${answeredCredits.held}`);
    await page.reload({ waitUntil: "networkidle" });
    check("the decisions are still on the plan after a refresh", /Shared between devices/.test(await page.getByTestId("what-i-understood").innerText()));
    await page.screenshot({ path: `${OUT}/clarify-2-plan-with-decisions.png` });
    await review.getByRole("button", { name: "Approve and build" }).click();
    const brief = await until("the saved brief", async () => { const { data: p } = await admin.from("projects").select("brief").eq("id", p1).single(); return p?.brief?.original ? p.brief : null; }, 60_000);
    check("on approval the decisions are saved in the project brief", /DECISIONS \(final/.test(brief.original) && /Shared between devices/.test(brief.original) && /one staff member/.test(brief.original));
    await admin.from("build_jobs").update({ cancel_requested_at: new Date().toISOString() }).eq("id", j1.id);

    // 2. Vague brief, continue with the stated assumptions.
    page = await signedIn("assume");
    const before2 = (await planCalls()).length;
    const p2 = await submit(page, VAGUE);
    await page.getByTestId("clarify-card").waitFor({ timeout: 120_000 });
    await page.getByRole("button", { name: "Continue with my assumptions" }).click();
    await page.getByLabel("Review build plan").waitFor({ timeout: 60_000 });
    const understood2 = (await page.getByTestId("what-i-understood").innerText()).replace(/\s+/g, " ");
    const j2 = await job(p2);
    check("continuing shows the plan with the assumptions labelled as yours to check", /Assumptions I made \(you chose to continue with them\)/.test(understood2) && /only in this browser/.test(understood2) && !/Your decisions/.test(understood2), understood2.slice(0, 220));
    check("continuing needs no second planning request, and the assumptions are saved with the request", (await planCalls()).length - before2 === 1 && /ASSUMPTIONS ACCEPTED/.test(j2.request) && j2.plan.assumptions?.length === 2);
    const assumedCredits = await ledger(j2.id);
    check("continuing with assumptions costs nothing more than the first planning request", assumedCredits.steps.length === 1, `charged ${assumedCredits.used} (${assumedCredits.steps.join("; ")}), held ${assumedCredits.held}`);
    await page.screenshot({ path: `${OUT}/clarify-3-plan-with-assumptions.png` });
    await page.getByLabel("Review build plan").getByRole("button", { name: "Cancel" }).click();
    await until("the plan to be cancelled", async () => (await job(p2)).status === "cancelled", 30_000);

    // 2b. A typed reply in the chat answers the questions.
    page = await signedIn("reply");
    const before3 = (await planCalls()).length;
    const p4 = await submit(page, VAGUE);
    await page.getByTestId("clarify-card").waitFor({ timeout: 120_000 });
    const composer = page.getByPlaceholder(/Describe your app|Ask for a change/);
    await composer.fill("Keep it in this browser, and it's just me."); await composer.press("End"); await composer.pressSequentially(" ");
    await composer.press("Enter");
    await page.getByLabel("Review build plan").waitFor({ timeout: 120_000 });
    const j4 = await job(p4);
    const understood4 = (await page.getByTestId("what-i-understood").innerText()).replace(/\s+/g, " ");
    check("a typed reply answers the questions and gives one plan with the reply as the decision", (await planCalls()).length - before3 === 2 && j4.plan.approval === "awaiting" && j4.plan.decisions?.[0]?.answer.startsWith("Keep it in this browser") && /Keep it in this browser/.test(understood4), understood4.slice(0, 200));
    await page.reload({ waitUntil: "networkidle" });
    check("the typed decision survives a refresh", /Keep it in this browser/.test(await page.getByTestId("what-i-understood").innerText()));
    await page.getByLabel("Review build plan").getByRole("button", { name: "Approve and build" }).click();
    const brief4 = await until("the saved brief", async () => { const { data: p } = await admin.from("projects").select("brief").eq("id", p4).single(); return p?.brief?.original ? p.brief : null; }, 60_000);
    check("on approval the typed decision is saved in the project brief", /Keep it in this browser/.test(brief4.original) && /DECISIONS ARE FINAL/.test(brief4.original));
    await admin.from("build_jobs").update({ cancel_requested_at: new Date().toISOString() }).eq("id", j4.id);

    // Duplicate submissions of the same request create one job and one plan hold.
    page = await signedIn("duplicate");
    const proj = (await page.request.post(`${APP}/api/projects`, { data: { name: "Duplicate check" } }).then((r) => r.json())).project?.id as string;
    const key = randomUUID();
    const sends = await Promise.all(Array.from({ length: 3 }, () => page.request.post(`${APP}/api/projects/${proj}/builds`, { data: { prompt: VAGUE, mode: "create", idempotencyKey: key } })));
    const bodies = await Promise.all(sends.map(async (r) => ({ status: r.status(), body: await r.json().catch(() => ({})) })));
    const { data: dupJobs } = await admin.from("build_jobs").select("id").eq("project_id", proj);
    const { data: holds } = await admin.from("credit_reservations").select("id,status").eq("project_id", proj);
    const dupUser = (await admin.from("projects").select("owner_id").eq("id", proj).single()).data!.owner_id;
    const { data: dupLedger } = await admin.from("credit_ledger").select("entry_type,amount").eq("user_id", dupUser).eq("entry_type", "consume");
    check("three identical submissions at once: one job and one plan hold; the duplicates are refused and charge nothing", (dupJobs || []).length === 1 && (holds || []).filter((h) => h.status === "active").length === 1 && bodies.filter((b) => b.status !== 202).every((b) => b.status === 429 || b.status === 409),
      `${bodies.map((b) => `${b.status}${b.body.code ? ` ${b.body.code}` : ""}`).join(", ")}; ${(dupJobs || []).length} job; holds ${(holds || []).length}; consumed so far ${(dupLedger || []).length} entries`);

    // 3. A clear brief goes straight to planning.
    page = await signedIn("clear");
    fake.control.app = "studiomark";
    const p3 = await submit(page, CLEAR_BRIEF);
    await page.getByLabel("Review build plan").waitFor({ timeout: 120_000 });
    const { data: conv } = await admin.from("conversations").select("id").eq("project_id", p3).single();
    const { count } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv!.id).eq("metadata->>kind", "clarify_questions");
    check("clear brief: straight to the plan, no questions asked", count === 0 && (await page.getByTestId("clarify-card").count()) === 0 && !(await page.getByTestId("what-i-understood").innerText()).includes("Assumptions"));
    await page.screenshot({ path: `${OUT}/clarify-4-clear-brief.png` });
    page = await signedIn("phone");
    await page.setViewportSize({ width: 390, height: 844 });
    await submit(page, VAGUE);
    await page.getByTestId("clarify-card").waitFor({ timeout: 120_000 });
    await page.screenshot({ path: `${OUT}/clarify-5-phone.png`, fullPage: false });
  } finally {
    await browser.close();
    for (const c of children) { try { if (c.pid) process.kill(-c.pid, "SIGKILL"); } catch { /* gone */ } }
    await fake.close?.();
  }
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); for (const c of children) { try { if (c.pid) process.kill(-c.pid, "SIGKILL"); } catch { /* gone */ } } process.exit(1); });
