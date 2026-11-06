/**
 * Builder chat upgrade, locally: seeds saved build records (progress events,
 * statuses, saved steps, plan checks, step charges) for a normal build, a
 * failure followed by Resume, a plan awaiting approval for an edit and a
 * build in progress; opens the real builder; checks ordering, no duplicates
 * after a refresh, and screenshots each conversation. Local Supabase only.
 *
 *   npx tsx tests/e2e/chat-activity/run.ts <supabase-workdir>
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright-core";
import { completionMessage } from "../../../lib/platform/build-engine";

const workdir = process.argv[2];
const OUT = process.env.E2E_ARTIFACTS || "/tmp";
const local = Object.fromEntries(execFileSync("supabase", ["status", "-o", "env", "--workdir", workdir], { encoding: "utf8" }).split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(local.API_URL)) throw new Error("Refusing to run: Supabase API is not local");
const APP = "http://127.0.0.1:3400";
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: local.DB_URL });
await db.connect();
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); console.log(results.at(-1)); };
const base = Date.now() - 60 * 60_000;
const t = (seconds: number) => new Date(base + seconds * 1000).toISOString();

const BRIEF = `Build "Marigold Thread": a small boutique orders app (FRONTEND ONLY). No backend, no real authentication, no payments. Use fictional data saved in browser localStorage. A landing page with navigation and a hero, and an orders workspace with order cards, a status filter and a New order form.`;
const STEPS = ["Landing page with brand navigation, hero and three feature cards", "Phone menu that opens, closes on Escape and on link choice", "Workspace header with Back to home", "Orders grid: 9 fictional orders, 3+ columns wide, one on phones", "Status filter for New, Packed and Delivered", "New order form that adds a card and persists across reloads"];
const FILES = ["package.json", "index.html", "src/main.tsx", "src/App.tsx", "src/index.css", "src/types.ts", "src/data.ts", "src/useOrders.ts", "src/components/Landing.tsx", "src/components/Workspace.tsx"];
const manifest = { plan: { summary: "Marigold Thread: a boutique orders app with a landing page and an orders workspace, stored in this browser.", steps: STEPS }, message: "", files: FILES.map((path) => ({ path, purpose: path })) };

async function project(owner: string, name: string, extra: Record<string, unknown> = {}) {
  const id = (await q("insert into public.projects(owner_id,name,status,brief) values($1,$2,'ready',$3) returning id", [owner, name, extra.brief ? JSON.stringify(extra.brief) : null]))[0].id as string;
  const conversation = (await q("insert into public.conversations(project_id) values($1) returning id", [id]))[0].id as string;
  return { id, conversation };
}
const message = (conversation: string, role: string, content: string, at: string, metadata: Record<string, unknown> = {}) => q("insert into public.messages(conversation_id,role,content,metadata,created_at) values($1,$2,$3,$4,$5)", [conversation, role, content, JSON.stringify(metadata), at]);
async function build(p: { id: string; conversation: string }, owner: string, fields: Record<string, unknown>) {
  const id = randomUUID();
  await q(`insert into public.build_jobs(id,project_id,requested_by,conversation_id,prompt,request,mode,idempotency_key,status,plan,progress,error_code,error_message,checkpoint,resumable,resume_of,created_at,finished_at)
    values($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [id, p.id, owner, p.conversation, fields.request, fields.mode || "create", `fixture-${id}`, fields.status, JSON.stringify(fields.plan), JSON.stringify(fields.progress), fields.error_code || null, fields.error_message || null, fields.checkpoint ? JSON.stringify(fields.checkpoint) : null, Boolean(fields.resumable), fields.resume_of || null, fields.created_at, fields.finished_at || null]);
  return id;
}
async function charge(owner: string, projectId: string, buildId: string, steps: Array<[string, number]>, settle = true) {
  await q("select public.reserve_credits($1,$2,$3,40,5)", [owner, projectId, buildId]);
  for (const [step, credits] of steps) await q("select public.consume_credits($1,$2,$3,'openrouter','anthropic/claude-sonnet-5.5',$4,'provider_reported',$5::jsonb)", [buildId, credits, `fixture:${randomUUID()}`, credits * 80, JSON.stringify({ step })]);
  if (settle) await q("select public.settle_reservation($1,'fixture')", [buildId]);
}
const ev = (s: number, message: string, percent?: number) => ({ at: t(s), message, ...(percent !== undefined ? { percent } : {}) });

async function seed() {
  const email = `chat-${Date.now()}@example.com`, password = `Pw-${randomUUID()}`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const owner = data.user!.id;
  await q("select public.grant_credits($1,'promotional',200,now()+interval '7 days','fixture',null,$2)", [owner, `fixture:${owner}`]);

  // 1. A normal build (the real Saffron Loom progress, renamed).
  const a = await project(owner, "Marigold Thread");
  await message(a.conversation, "user", BRIEF, t(0));
  await message(a.conversation, "assistant", "Here is the proposed plan for Marigold Thread. It is frontend-only, so orders are fictional and stored in your browser. Please review it before I write code.", t(10), { kind: "plan_proposal", revision: 1 });
  const planA = { ...manifest.plan, approval: "approved", revision: 1, manifest, estimate: { low: 14, high: 32, reserve: 29 }, coverage: { missing: [], unconfirmed: ["Orders grid 3+ columns wide on large screens (the grid is built; the column count couldn't be read from the CSS)"] } };
  const progressA = [ev(0, "Preparing project context"), ev(1, "Planning the screens, design and functionality for your approval", 12), ev(9, "Plan ready for your approval. No code generation has started.", 18), ev(46, "Plan approved. Application build queued.", 20), ev(48, "Preparing project context"), ev(48, "Writing the approved application", 22),
    ev(48, "Writing package.json, index.html, types.ts, data.ts", 22), ev(62, "Saved package.json, index.html, types.ts, data.ts", 41), ev(62, "Writing useOrders.ts, Landing.tsx", 41), ev(78, "Saved useOrders.ts, Landing.tsx", 50), ev(78, "Writing Workspace.tsx, App.tsx", 50), ev(91, "Saved Workspace.tsx, App.tsx", 59), ev(91, "Writing index.css", 59), ev(111, "Saved index.css", 64),
    ev(111, "Checking the result against the approved plan", 64), ev(119, "Preparing a secure preview environment"), ev(124, "Installing application dependencies", 70), ev(139, "Compiling and typechecking the application", 80), ev(144, "Starting the secure application preview", 90), ev(147, "Validating production build and preview"), ev(147, "Build complete", 100)];
  const buildA = await build(a, owner, { request: BRIEF, status: "succeeded", plan: planA, progress: progressA, created_at: t(0), finished_at: t(147) });
  await charge(owner, a.id, buildA, [["Planning the build", 1], ["Writing package.json, index.html, types.ts, data.ts", 3], ["Writing useOrders.ts, Landing.tsx", 3], ["Writing Workspace.tsx, App.tsx", 3], ["Writing index.css", 2], ["Checking the result against the approved plan", 1]]);
  await message(a.conversation, "assistant", completionMessage({ mode: "create", appName: "Marigold Thread", plan: planA, coverage: planA.coverage }), t(150), { kind: "build_complete", build_id: buildA });

  // 2. A failure, then Resume with a compiler repair.
  const b = await project(owner, "Indigo Ledger");
  const briefB = "Build \"Indigo Ledger\": a stock and sales tracker for a small textile shop (FRONTEND ONLY, localStorage). Products, stock levels, a sales log and a reports page with totals by category.";
  const stepsB = ["Products list with stock levels", "Sales log with a quick add form", "Low-stock highlights", "Reports page with totals by category"];
  const filesB = ["package.json", "index.html", "src/main.tsx", "src/App.tsx", "src/index.css", "src/data.ts", "src/components/Products.tsx", "src/components/Sales.tsx", "src/components/Reports.tsx"];
  const planB = { summary: "Indigo Ledger: products, stock, sales and reports for a textile shop, stored in this browser.", steps: stepsB, approval: "approved", revision: 1, manifest: { plan: { summary: "", steps: stepsB }, message: "", files: filesB.map((path) => ({ path, purpose: path })) }, estimate: { low: 16, high: 36, reserve: 30 } };
  await message(b.conversation, "user", briefB, t(0));
  await message(b.conversation, "assistant", "Here is the proposed plan for Indigo Ledger. Please review it before I write code.", t(9), { kind: "plan_proposal", revision: 1 });
  const failedId = await build(b, owner, { request: briefB, status: "failed", plan: planB, error_code: "GENERATION_INCOMPLETE", error_message: "One step couldn't be finished automatically.", resumable: true,
    checkpoint: { done: filesB.slice(0, 8), failed_step: { label: "Writing Reports.tsx" } }, created_at: t(0), finished_at: t(150),
    progress: [ev(40, "Plan approved. Application build queued.", 20), ev(42, "Writing the approved application", 22), ev(42, "Writing package.json, index.html, main.tsx, App.tsx", 22), ev(60, "Saved package.json, index.html, main.tsx, App.tsx", 40), ev(60, "Writing index.css, data.ts", 40), ev(82, "Saved index.css, data.ts", 50), ev(82, "Writing Products.tsx, Sales.tsx", 50), ev(110, "Saved Products.tsx, Sales.tsx", 58), ev(110, "Writing Reports.tsx", 58), ev(146, "Writing Reports.tsx · repairing", 58)] });
  await charge(owner, b.id, failedId, [["Planning the build", 1], ["Writing package.json, index.html, main.tsx, App.tsx", 3], ["Writing index.css, data.ts", 2], ["Writing Products.tsx, Sales.tsx", 3], ["Writing Reports.tsx", 2]]);
  const resumedId = await build(b, owner, { request: briefB, status: "succeeded", plan: { ...planB, coverage: { missing: [], unconfirmed: [] } }, resume_of: failedId, created_at: t(300), finished_at: t(420), checkpoint: { done: filesB },
    progress: [ev(301, "Preparing project context"), ev(302, "Continuing from 8 finished file(s); finished work is reused, not regenerated", 22), ev(302, "Writing Reports.tsx", 58), ev(331, "Saved Reports.tsx", 64), ev(331, "Checking the result against the approved plan", 64), ev(340, "Preparing a secure preview environment"), ev(344, "Installing application dependencies", 70),
      ev(360, "Compiling and typechecking the application", 80), ev(366, "Repairing a compiler issue · pass 1 of 2", 78), ev(384, "Rechecking the repaired application", 80), ev(392, "Starting the secure application preview", 90), ev(396, "Build complete", 100)] });
  await charge(owner, b.id, resumedId, [["Writing Reports.tsx", 2], ["Checking the result against the approved plan", 1], ["Repairing compiler errors (pass 1)", 2]]);
  await message(b.conversation, "assistant", completionMessage({ mode: "create", appName: "Indigo Ledger", plan: planB, coverage: {} }), t(400), { kind: "build_complete", build_id: resumedId });

  // 3. An edit plan awaiting approval, carrying the brief forward.
  const c = await project(owner, "Saffron Loom", { brief: { original: BRIEF, plan: manifest.plan, changes: [{ status: "applied", summary: "Added a status filter", request: "Add a status filter" }] } });
  const edit = "Add a Returns page where I can record a return or exchange for an order, and show returns on the dashboard.";
  await message(c.conversation, "user", edit, t(0));
  await message(c.conversation, "assistant", "Here is the proposed change: a Returns page and returns on the dashboard. Please review it before I write code.", t(8), { kind: "plan_proposal", revision: 1 });
  await build(c, owner, { request: edit, mode: "edit", status: "planning", created_at: t(0), progress: [ev(1, "Planning the screens, design and functionality for your approval", 12), ev(8, "Plan ready for your approval. No code generation has started.", 18)],
    plan: { summary: "Add a Returns page to record returns and exchanges, and show returns on the dashboard.", steps: ["Returns page with a record return or exchange form", "Link returns to orders", "Returns count on the dashboard"], approval: "awaiting", revision: 1, estimate: { low: 6, high: 14, reserve: 12 }, manifest: { plan: { summary: "", steps: [] }, message: "", files: [{ path: "src/components/Returns.tsx", purpose: "Returns page" }, { path: "src/App.tsx", purpose: "Route" }, { path: "src/components/Workspace.tsx", purpose: "Dashboard count" }] } } });

  // 4. A build in progress.
  const d = await project(owner, "Tulsi Bookings");
  const briefD = "Build \"Tulsi Bookings\": class booking for a yoga studio (FRONTEND ONLY).";
  await message(d.conversation, "user", briefD, t(3500));
  await q("update public.projects set status='building' where id=$1", [d.id]);
  await build(d, owner, { request: briefD, status: "generating", created_at: t(3500), plan: { summary: "Tulsi Bookings: a class schedule and booking flow.", steps: ["Schedule", "Booking"], approval: "approved", revision: 1, manifest: { files: [] } },
    progress: [ev(3540, "Plan approved. Application build queued.", 20), ev(3541, "Writing the approved application", 22), ev(3542, "Writing package.json, index.html, types.ts", 22), ev(3556, "Saved package.json, index.html, types.ts", 38), ev(3556, "Writing Schedule.tsx, Booking.tsx", 38)] });
  return { email, password, projects: { normal: a.id, resume: b.id, plan: c.id, live: d.id }, builds: { buildA, failedId, resumedId } };
}

async function chatText(page: Page) { return (await page.locator("[data-chat-message], [data-testid='build-timeline'], section[aria-label='Review build plan']").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()); }

async function main() {
  const BLANK = ["E2B_API_KEY", "OPENROUTER_API_KEY", "FIRECRAWL_API_KEY", "VERCEL_TOKEN", "PREVIEW_VERCEL_PROJECT_ID", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"];
  const env = { ...process.env, ...Object.fromEntries(BLANK.map((n) => [n, ""])), NODE_ENV: "development" as const, NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL: APP, PREVIEW_SIGNING_SECRET: "local-chat-activity-only-0123456789abcdef0123" };
  const app: ChildProcess = spawn("npx", ["next", "dev", "-p", "3400", "-H", "127.0.0.1"], { env, stdio: "ignore", detached: true });
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const s = await seed();
    for (let i = 0; i < 180; i += 1) { if ((await fetch(`${APP}/login`).catch(() => null))?.ok) break; await new Promise((r) => setTimeout(r, 1000)); }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", s.email); await page.fill("#password", s.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    const open = async (id: string) => { await page.goto(`${APP}/projects/${id}`, { waitUntil: "networkidle" }); await page.waitForTimeout(2500); };
    const chat = page.locator("[data-chat-message]").first().locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
    const toBottom = async () => { await page.evaluate("document.querySelectorAll('.overflow-y-auto').forEach((el) => { el.scrollTop = el.scrollHeight; })"); await page.waitForTimeout(400); };

    // 1. Normal build.
    await open(s.projects.normal);
    const timeline = page.getByTestId("build-timeline");
    const milestones = (await timeline.locator("li").allInnerTexts()).map((x) => x.split("\n")[0]);
    check("normal build: milestones in order, one line for all files", JSON.stringify(milestones) === JSON.stringify(["Plan approved, building started", "Wrote 9 files", "Reviewed the code against your plan", "Installed dependencies", "Compiled and type-checked", "Starting the preview", "Preview is live"]), milestones.join(" > "));
    const verified = (await page.getByTestId("what-i-verified").innerText()).replace(/\s+/g, " ");
    check("normal build: What I verified separates compile, preview, AI review and browser testing", /Compiled and type-checked/.test(verified) && /Preview started and responded/.test(verified) && /AI review of the code against your plan/.test(verified) && /Not tested in a browser yet/.test(verified));
    await page.screenshot({ path: `${OUT}/chat-1-normal.png` });
    await toBottom();
    await page.getByRole("button", { name: "View activity" }).first().click();
    await page.waitForTimeout(400);
    const details = (await page.getByTestId("activity-details").innerText()).replace(/\s+/g, " ");
    check("normal build: View activity lists files, checks and credits by step (total 13)", /Workspace\.tsx/.test(details) && /Passed: Compiled and type-checked/.test(details) && /Total 13/.test(details), details.slice(0, 160));
    await toBottom();
    await page.screenshot({ path: `${OUT}/chat-2-normal-activity.png` });
    const before = await chatText(page);
    await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(2500);
    const after = await chatText(page);
    check("after a refresh the conversation is identical, with one progress list per build", JSON.stringify(before.filter((x) => !/View activity/.test(x) || true).map((x) => x.replace(/View activity.*$/, ""))) === JSON.stringify(after.map((x) => x.replace(/View activity.*$/, ""))) && (await page.getByTestId("build-timeline").count()) === 1);

    // 2. Failure, then Resume.
    await open(s.projects.resume);
    const lists = page.getByTestId("build-timeline");
    check("failure and Resume: two progress lists, in order", (await lists.count()) === 2);
    const failedText = (await lists.nth(0).innerText()).replace(/\s+/g, " ");
    const resumedText = (await lists.nth(1).innerText()).replace(/\s+/g, " ");
    check("the failed build says what stopped, where, and what is saved", /One step couldn't be finished automatically/.test(failedText) && /Stopped at: Writing Reports\.tsx/.test(failedText) && /8 finished files are saved; Resume continues from there/.test(failedText), failedText.slice(0, 200));
    check("the resumed build says files were reused and the build check was repaired", /Resumed: 8 finished files reused/.test(resumedText) && /Repairing \(attempt 1 of 2\)/.test(resumedText) && /Compiled and type-checked after 1 repair/.test(resumedText) && /Preview is live/.test(resumedText));
    await page.screenshot({ path: `${OUT}/chat-3-failure-resume.png` });
    await lists.nth(0).getByRole("button", { name: "View activity" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/chat-4-failure-activity.png` });
    await toBottom();
    await page.screenshot({ path: `${OUT}/chat-5-resume-verified.png` });

    // 3. Plan awaiting approval for an edit.
    await open(s.projects.plan);
    const understood = (await page.getByTestId("what-i-understood").innerText()).replace(/\s+/g, " ");
    check("plan card: What I understood quotes the request, the plan and the kept brief; no invented assumptions", /You asked for: Add a Returns page/.test(understood) && /I'll change: 3 plan steps across 3 files/.test(understood) && /I'll keep: your original brief and 1 earlier change/.test(understood) && !/Assumptions/.test(understood), understood.slice(0, 220));
    await page.screenshot({ path: `${OUT}/chat-6-plan-understood.png` });

    // 4. In progress.
    await open(s.projects.live);
    const live = (await page.getByTestId("build-timeline").innerText()).replace(/\s+/g, " ");
    check("in progress: milestones so far, the latest marked as live", /Wrote 3 files/.test(live) && (await page.getByTestId("build-timeline").locator(".animate-spin").count()) === 1, live);
    await page.screenshot({ path: `${OUT}/chat-7-in-progress.png` });

    // Phone width.
    await page.setViewportSize({ width: 390, height: 844 });
    await open(s.projects.resume);
    await page.screenshot({ path: `${OUT}/chat-8-phone.png` });
    await context.close();
  } finally {
    await browser.close();
    try { if (app.pid) process.kill(-app.pid, "SIGKILL"); } catch { /* gone */ }
    await db.end();
  }
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
