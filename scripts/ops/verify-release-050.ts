/**
 * Post-deploy check for 0.5.0 with a temporary account: no credits, no plan,
 * no generation, and every preview or build request blocked in the browser.
 * The account and its empty project are deleted at the end. Read-only checks
 * cover the trial settings and the end of clock-window charging.
 *
 *   NYNZ_SWITCHOVER=2026-11-05T17:10:59Z npx tsx scripts/ops/verify-release-050.ts
 */
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";

config({ path: ".env.local", quiet: true });
const APP = process.env.NYNZ_VERIFY_BASE_URL || "https://www.nynz.in";
const SWITCHOVER = process.env.NYNZ_SWITCHOVER || "";
if (!SWITCHOVER) throw new Error("Set NYNZ_SWITCHOVER to the migration time");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const results: string[] = [];
const ok = (name: string, pass: boolean, detail = "") => { results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); };

// Read-only release state.
const trial = (await admin.from("spend_limits").select("name,period,limit_paise,active,scope").eq("scope", "trial")).data || [];
ok("trial allowance: one active ₹300/day trial-only limit", trial.length === 1 && trial[0].limit_paise === 30000 && trial[0].active && trial[0].period === "day");
const platform = (await admin.from("spend_limits").select("limit_paise,active").eq("scope", "all").eq("period", "day").eq("active", true)).data || [];
ok("platform cap unchanged (₹1,000/day for everyone)", platform.length === 1 && platform[0].limit_paise === 100000);
const { count: windowsSince } = await admin.from("credit_ledger").select("id", { count: "exact", head: true }).like("event_key", "runtime:%").gte("created_at", SWITCHOVER);
ok("no clock-window preview charge since the switchover", windowsSince === 0);
const { count: ledgerSince } = await admin.from("credit_ledger").select("id", { count: "exact", head: true }).gte("created_at", SWITCHOVER);
const sessions = (await admin.from("sandbox_sessions").select("status,held_credits,charged_credits")).data || [];
ok("preview sessions since the switchover", true, `${sessions.length} sessions (${sessions.filter((s) => s.status === "open").length} open), ${ledgerSince} ledger rows since ${SWITCHOVER}`);

// Signed-in pages with a temporary account.
const email = `release-check-${Date.now()}@example.com`;
const password = randomBytes(18).toString("base64url");
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) throw created.error;
const userId = created.data.user.id;
let projectId: string | null = null;
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
try {
  const { data: project, error } = await admin.from("projects").insert({ owner_id: userId, name: "Release check (empty)" }).select("id").single();
  if (error) throw error;
  projectId = project.id;
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors: string[] = [];
  const paidCalls: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  await page.route(/preview\.nynz\.in|preview-session|\/sandbox|\/builds$|\/resume$|\/terminal$/, async (route) => {
    const req = route.request();
    if (/preview\.nynz\.in|preview-session|\/sandbox|\/terminal/.test(req.url()) || req.method() !== "GET") { paidCalls.push(`${req.method()} ${new URL(req.url()).pathname}`); return route.abort(); }
    return route.continue();
  });
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  ok("signed in and the dashboard loaded", true);
  await page.goto(`${APP}/projects/${projectId}`, { waitUntil: "networkidle" });
  ok("builder page loads for a project (with the trial status check)", await page.locator("textarea[placeholder='Describe your app…']").isVisible().catch(() => false));
  ok("no trial pause card for an account that has not used the trial", !(await page.getByTestId("trial-pause").isVisible().catch(() => false)));
  const api = await page.request.get(`${APP}/api/projects/${projectId}/builds`);
  const body = await api.json().catch(() => ({}));
  ok("builds API answers", api.status() === 200 && Array.isArray(body.builds), `HTTP ${api.status()}`);
  await page.goto(`${APP}/billing`, { waitUntil: "networkidle" });
  const billing = (await page.locator("body").textContent()) || "";
  ok("billing page loads with the credit history", /Credit history/.test(billing) && /No credit activity yet/.test(billing));
  const home = await (await fetch(`${APP}/`)).text();
  ok("site footer shows v0.5.0", /v0\.5\.0/.test(home));
  await page.goto(`${APP}/pricing`, { waitUntil: "networkidle" });
  ok("pricing page loads", /plan/i.test((await page.locator("body").textContent()) || ""));
  ok("no paid preview, build or terminal request was made", paidCalls.length === 0, paidCalls.join(", "));
  ok("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  const { data: open } = await admin.rpc("trial_budget_open", { p_user: userId });
  const { data: isTrial } = await admin.rpc("account_is_trial", { p_user: userId });
  ok("trial functions answer for a new account (not yet a trial account, allowance open)", open === true && isTrial === false);
} finally {
  await browser.close();
  if (projectId) await admin.from("projects").delete().eq("id", projectId);
  const del = await admin.auth.admin.deleteUser(userId);
  ok("temporary account and project deleted", !del.error, del.error?.message || "");
}
console.log(results.join("\n"));
process.exit(results.every((r) => r.startsWith("PASS")) ? 0 : 1);
