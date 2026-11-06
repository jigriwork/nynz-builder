/**
 * Live free-trial validation on production, through the normal customer UI.
 * A private mail.tm inbox (created here; its password stays in the run folder,
 * mode 600) receives the normal confirmation email. No manual credits, no
 * owner privileges; the service role is used only for read-only checks.
 *
 *   LIVE_DIR=<run folder> npx tsx scripts/ops/live-trial.ts <stage>
 *   stages: signup | signin | reset | brief | approve | watch | preview | settle
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
// An invite-only launch run starts with live-invite-only.ts. Reuse that
// account instead of creating a second customer or granting credits manually.
if (state.inviteInbox && !state.inbox) state.inbox = state.inviteInbox;
if (state.invitePassword && !state.accountPassword) state.accountPassword = state.invitePassword;
const save = () => { writeFileSync(STATE, JSON.stringify(state, null, 2)); chmodSync(STATE, 0o600); };
const log = (line: string) => { console.log(line); writeFileSync(`${DIR}/log.txt`, `${new Date().toISOString()} ${line}\n`, { flag: "a" }); };
const read = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function browser(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await chromium.launchPersistentContext(`${DIR}/profile`, { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, viewport: { width: 1440, height: 950 } });
  const page = context.pages()[0] || await context.newPage();
  if (state.inbox?.address && state.accountPassword) {
    await page.goto(`${APP}/dashboard`, { waitUntil: "networkidle" });
    if (new URL(page.url()).pathname === "/login") {
      await page.fill("#email", state.inbox.address); await page.fill("#password", state.accountPassword);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    }
  }
  return { context, page };
}
async function balance() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await read.rpc("credit_balance", { p_user: state.userId });
    if (data) return data as { available: number; reserved: number; used: number };
    if (attempt === 4) throw new Error(`Could not read credit balance: ${error?.message || "empty response"}`);
    await wait(500 * (attempt + 1));
  }
  throw new Error("Could not read credit balance");
}
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
  if (!state.userId && state.inbox?.address) {
    const { data } = await read.auth.admin.listUsers({ perPage: 1000 });
    state.userId = data.users.find((user) => user.email === state.inbox.address)?.id;
    if (!state.userId) throw new Error("Invited account does not exist");
    save();
  }
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
  const { context, page } = await browser();
  await page.goto(`${APP}/projects/${state.projectId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  const timeline = ((await page.getByTestId("build-timeline").last().innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  const verified = ((await page.getByTestId("what-i-verified").last().innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  const activityButton = page.getByRole("button", { name: "View activity" }).last();
  if (await activityButton.count()) await activityButton.click();
  const activity = ((await page.getByTestId("activity-details").last().innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  log(`progress messages: ${timeline.slice(0, 700)}`);
  log(`What I verified: ${verified.slice(0, 700)}`);
  log(`View activity: ${activity.slice(0, 900)}`);
  await page.screenshot({ path: `${DIR}/05-completed-build.png`, fullPage: true });
  await context.close();

  const { data: build } = await read.from("build_jobs").select("id,status,created_at,started_at,finished_at").eq("id", state.buildId).single();
  const { data: ledger } = await read.from("credit_ledger").select("entry_type,amount,event_key,reason,metadata,created_at").eq("user_id", state.userId).eq("build_id", state.buildId).order("id");
  log(`build timing: ${JSON.stringify(build)}`);
  log(`build ledger: ${JSON.stringify(ledger)}`);
}

async function preview() {
  const { context, page } = await browser();
  await page.goto(`${APP}/projects/${state.projectId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Preview" }).click().catch(() => undefined);
  const link = page.getByRole("link", { name: "Open preview in new tab" });
  await link.waitFor({ timeout: 90_000 });
  const [preview] = await Promise.all([context.waitForEvent("page"), link.click()]);
  await preview.waitForLoadState("networkidle");
  const marker = `Refresh Test ${Date.now()}`;
  const customer = preview.getByLabel(/customer|name/i).first();
  const item = preview.getByLabel(/item|product/i).first();
  if (await customer.count()) await customer.fill(marker);
  if (await item.count()) await item.fill("Silk scarf");
  const add = preview.getByRole("button", { name: /add|create|save/i }).first();
  if (!await customer.count() || !await add.count()) throw new Error("Generated order form could not be exercised through accessible labels");
  await add.click(); await preview.waitForTimeout(1000);
  const before = (await preview.locator("body").innerText()).includes(marker);
  await preview.reload({ waitUntil: "networkidle" });
  const after = (await preview.locator("body").innerText()).includes(marker);
  log(`new-tab preview order persisted across refresh: ${before && after}; url ${new URL(preview.url()).origin}`);
  await preview.screenshot({ path: `${DIR}/06-preview-order-after-refresh.png`, fullPage: true });
  state.previewOpenedAt = new Date().toISOString(); save();
  await preview.close();
  await context.close();
}

async function settle() {
  if (!state.previewOpenedAt) throw new Error("Preview was not opened");
  const { data: sessions } = await read.from("sandbox_sessions").select("id,status,started_at,ended_at,held_credits,charged_credits,refunded_credits,end_source,estimate_reason").eq("owner_id", state.userId).eq("project_id", state.projectId).order("started_at");
  const sessionIds = (sessions || []).map((session) => session.id);
  const { data: ledger } = sessionIds.length
    ? await read.from("credit_ledger").select("entry_type,amount,event_key,build_id,reason,metadata,created_at").eq("user_id", state.userId).in("build_id", sessionIds).order("id")
    : { data: [] };
  log(`preview sessions: ${JSON.stringify(sessions)}`);
  log(`preview ledger after close: ${JSON.stringify(ledger)}`);
  log(`balance after preview: ${JSON.stringify(await balance())}`);
}

const stage = process.argv[2];
const stages: Record<string, () => Promise<void>> = { signup, signin, reset, brief, approve, watch, preview, settle };
if (!stages[stage]) throw new Error(`unknown stage ${stage}`);
await stages[stage]();
