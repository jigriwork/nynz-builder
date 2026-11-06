/**
 * Live free-trial validation on production, through the normal customer UI.
 * A private mail.tm inbox (created here; its password stays in the run folder,
 * mode 600) receives the normal confirmation email. No manual credits, no
 * owner privileges; the service role is used only for read-only checks.
 *
 *   LIVE_DIR=<run folder> npx tsx scripts/ops/live-trial.ts <stage>
 *   stages: signup | signin | reset | brief | approve | watch | preview
 */
import { config } from "dotenv";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright-core";

config({ path: ".env.local", quiet: true });
const APP = "https://www.nynz.in";
const DIR = process.env.LIVE_DIR!;
if (!DIR) throw new Error("Set LIVE_DIR");
mkdirSync(DIR, { recursive: true });
const STATE = `${DIR}/state.json`;
const state: Record<string, any> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => { writeFileSync(STATE, JSON.stringify(state, null, 2)); chmodSync(STATE, 0o600); };
const log = (line: string) => { console.log(line); writeFileSync(`${DIR}/log.txt`, `${new Date().toISOString()} ${line}\n`, { flag: "a" }); };
const read = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function browser(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await chromium.launchPersistentContext(`${DIR}/profile`, { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, viewport: { width: 1440, height: 950 } });
  return { context, page: context.pages()[0] || await context.newPage() };
}
async function balance() { const { data } = await read.rpc("credit_balance", { p_user: state.userId }); return data as { available: number; reserved: number; used: number }; }
const text = async (page: Page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

const MAILTM = "https://api.mail.tm";
async function inbox() {
  if (state.inbox) return state.inbox;
  const domains = await (await fetch(`${MAILTM}/domains`)).json();
  const domain = (domains["hydra:member"] || domains)[0].domain;
  const address = `nynz-trial-${randomBytes(4).toString("hex")}@${domain}`;
  const password = randomBytes(18).toString("base64url");
  const created = await fetch(`${MAILTM}/accounts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, password }) });
  if (!created.ok) throw new Error(`inbox ${created.status}`);
  state.inbox = { address, password }; save();
  return state.inbox;
}
async function mailToken() {
  const r = await fetch(`${MAILTM}/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(state.inbox) });
  return (await r.json()).token as string;
}

/** The newest email link not seen before (confirmation or recovery). Tokens are never logged. */
async function nextEmailLink(kind: string) {
  const token = await mailToken();
  state.seenMail ||= [];
  for (let i = 0; i < 60; i += 1) {
    const list = await (await fetch(`${MAILTM}/messages`, { headers: { authorization: `Bearer ${token}` } })).json();
    const fresh = (list["hydra:member"] || []).find((m: { id: string }) => !state.seenMail.includes(m.id));
    if (fresh) {
      const msg = await (await fetch(`${MAILTM}/messages/${fresh.id}`, { headers: { authorization: `Bearer ${token}` } })).json();
      state.seenMail.push(fresh.id); save();
      const body = [msg.html?.join?.("") || "", msg.text || ""].join("\n").replace(/&amp;/g, "&");
      const link = (body.match(/https:\/\/[^\s"'<>]+(?:verify|confirm|callback)[^\s"'<>]*/) || [""])[0];
      const redirect = (() => { try { return new URL(link).searchParams.get("redirect_to") || ""; } catch { return ""; } })();
      log(`${kind} email received: from ${msg.from?.address}, subject "${msg.subject}", link returns to ${redirect.replace(/\?.*$/, "")}${redirect.includes("?") ? " (with next page)" : ""}`);
      return link;
    }
    await wait(5000);
  }
  throw new Error(`no ${kind} email within 5 minutes`);
}

async function signup() {
  const { address } = await inbox();
  state.accountPassword ||= randomBytes(18).toString("base64url"); save();
  const { context, page } = await browser();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Create one" }).click();
  await page.fill("#email", address); await page.fill("#password", state.accountPassword);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${DIR}/01-signup-submitted.png` });
  log(`signup submitted; form message: ${((await text(page)).match(/Check your inbox[^.]*\.[^.]*\./) || ["(none)"])[0]}`);
  const link = await nextEmailLink("confirmation");
  await page.goto(link, { waitUntil: "networkidle" }).catch((e) => log(`opening the confirmation link failed: ${String(e.message).split("\n")[0]}`));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${DIR}/02-after-confirmation.png` });
  const landed = new URL(page.url());
  log(`after the confirmation link the customer is on ${landed.origin}${landed.pathname}`);
  const { data } = await read.auth.admin.listUsers({ perPage: 1000 });
  const user = data.users.find((u) => u.email === address)!;
  state.userId = user.id; save();
  log(`email confirmed at ${user.email_confirmed_at}; balance ${JSON.stringify(await balance())}`);
  await context.close();
}

/** Signs in with email and password in a clean browser (no saved session). */
async function signinFresh(password: string, label: string) {
  const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const page = await b.newPage({ viewport: { width: 1360, height: 900 } });
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", state.inbox.address); await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const ok = await page.waitForURL(/\/dashboard/, { timeout: 30_000 }).then(() => true, () => false);
  await page.screenshot({ path: `${DIR}/${label}.png` });
  log(`${label}: ${ok ? "signed in, dashboard loaded" : `not signed in; page says: ${(await text(page)).slice(0, 200)}`}`);
  await b.close();
  return ok;
}

async function signin() { await signinFresh(state.accountPassword, "03-signin-with-password"); }

async function reset() {
  const { context, page } = await browser();
  await page.goto(`${APP}/forgot-password`, { waitUntil: "networkidle" });
  await page.fill("#email", state.inbox.address);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${DIR}/04-forgot-password.png` });
  log(`forgot password submitted; page says: ${(await text(page)).match(/(If an account[^.]*\.|Check[^.]*\.|sent[^.]*\.)/i)?.[0] || "(see screenshot)"}`);
  const link = await nextEmailLink("recovery");
  await page.goto(link, { waitUntil: "networkidle" }).catch((e) => log(`opening the recovery link failed: ${String(e.message).split("\n")[0]}`));
  await page.waitForTimeout(3000);
  const landed = new URL(page.url());
  log(`after the recovery link the customer is on ${landed.origin}${landed.pathname}`);
  await page.screenshot({ path: `${DIR}/05-reset-password-page.png` });
  const newPassword = randomBytes(18).toString("base64url");
  await page.fill("#new-password", newPassword); await page.fill("#confirm-password", newPassword);
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${DIR}/06-password-saved.png` });
  log(`after saving: ${landed.origin}${new URL(page.url()).pathname}; page says: ${((await text(page)).match(/(Password (updated|saved|changed)[^.]*\.|updated[^.]*\.)/i) || ["(see screenshot)"])[0]}`);
  state.previousPassword = state.accountPassword; state.accountPassword = newPassword; save();
  await context.close();
  const oldRefused = !(await signinFresh(state.previousPassword, "07-old-password-refused"));
  log(`old password refused: ${oldRefused}`);
  await signinFresh(newPassword, "08-signin-with-new-password");
}

async function brief() {
  const { context, page } = await browser();
  await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
  const box = page.getByLabel("Application description");
  await box.fill(readFileSync(`${DIR}/brief.txt`, "utf8")); await box.press("End"); await box.pressSequentially(" ");
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 90_000 });
  state.projectId = page.url().match(/projects\/([0-9a-f-]{36})/)![1]; save();
  log(`project ${state.projectId} created`);
  let planText = "";
  for (let i = 0; i < 120 && !planText; i += 1) {
    await page.waitForTimeout(3000);
    const t = await text(page);
    if (/paused|Not enough credits|couldn't|could not/i.test(t) && !/Estimated cost/.test(t)) { log(`message while planning: ${t.slice(0, 400)}`); }
    if (/Estimated cost/.test(t)) planText = t;
  }
  await page.screenshot({ path: `${DIR}/03-plan.png` });
  const { data: grants } = await read.from("credit_grants").select("source,amount,remaining,expires_at,reason,created_at").eq("user_id", state.userId);
  const { data: build } = await read.from("build_jobs").select("id,status,plan").eq("project_id", state.projectId).order("created_at", { ascending: false }).limit(1).single();
  state.planBuild = build?.id; save();
  log(`grants: ${JSON.stringify(grants)}`);
  log(`plan shown: ${(planText.match(/Estimated cost[^.]*\.[^.]*\./) || [planText.slice(0, 300)])[0]}`);
  log(`balance after plan: ${JSON.stringify(await balance())}`);
  await context.close();
}

async function approve() {
  const { context, page } = await browser();
  await page.goto(`${APP}/projects/${state.projectId}`, { waitUntil: "networkidle" });
  const before = await balance();
  await page.getByRole("button", { name: /Approve/i }).first().click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${DIR}/04-approved.png` });
  log(`approved; balance before ${JSON.stringify(before)}, after ${JSON.stringify(await balance())}`);
  await context.close();
}

async function watch() {
  let peak = 0, last = "";
  for (let i = 0; i < 400; i += 1) {
    const b = await balance();
    peak = Math.max(peak, Number(b.reserved));
    const { data: job } = await read.from("build_jobs").select("id,status,error_code,error_message,progress").eq("project_id", state.projectId).order("created_at", { ascending: false }).limit(1).single();
    const line = `${job?.status} held ${b.reserved} used ${b.used} available ${b.available}`;
    if (line !== last) { log(line); last = line; }
    if (job && ["succeeded", "failed", "cancelled"].includes(job.status)) {
      state.buildId = job.id; state.peakHold = peak; save();
      log(`build ${job.status}${job.error_code ? ` ${job.error_code}: ${job.error_message}` : ""}; peak hold seen ${peak}`);
      break;
    }
    await wait(5000);
  }
}

async function preview() {
  const { context, page } = await browser();
  await page.goto(`${APP}/projects/${state.projectId}`, { waitUntil: "networkidle" });
  const frame = page.frameLocator("iframe").first();
  await frame.locator("body").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${DIR}/05-builder-preview.png` });
  log(`preview frame text: ${(await frame.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
  state.previewOpenedAt = new Date().toISOString(); save();
  await context.close();
}

const stage = process.argv[2];
const stages: Record<string, () => Promise<void>> = { signup, signin, reset, brief, approve, watch, preview };
if (!stages[stage]) throw new Error(`unknown stage ${stage}`);
await stages[stage]();
