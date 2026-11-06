/**
 * Live checks for invite-only signups on production, with test inboxes this
 * script creates (mail.tm; passwords stay in the run folder, mode 600).
 * Customer steps use fresh browsers; the admin step uses the owner's own
 * signed-in private profile (NYNZ_OWNER_PROFILE). Tokens are never logged.
 *
 *   LIVE_DIR=<run folder> [RESET_DIR=<earlier run with a test account>] \
 *   NYNZ_OWNER_PROFILE=<owner profile> npx tsx scripts/ops/live-invite-only.ts <stage>
 *   stages: waitlist | refused | admin | accept | reset
 */
import { config } from "dotenv";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser } from "playwright-core";
import { ownerContext } from "./owner-browser";

config({ path: ".env.local", quiet: true });
const APP = "https://www.nynz.in";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = process.env.LIVE_DIR!;
mkdirSync(DIR, { recursive: true });
const STATE = `${DIR}/state.json`;
const state: Record<string, any> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => { writeFileSync(STATE, JSON.stringify(state, null, 2)); chmodSync(STATE, 0o600); };
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`; results.push(line); console.log(line); writeFileSync(`${DIR}/results.txt`, `${line}\n`, { flag: "a" }); };
const read = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAILTM = "https://api.mail.tm";
/** mail.tm JSON with retries (it answers rate limits with an empty body). */
async function mailJson(url: string, init?: RequestInit) {
  for (let i = 0; i < 8; i += 1) {
    const response = await fetch(url, init).catch(() => null);
    const text = response ? await response.text() : "";
    if (response?.ok && text) return JSON.parse(text);
    await wait(4000 * (i + 1));
  }
  throw new Error(`mail.tm did not answer: ${new URL(url).pathname}`);
}
const mailToken = async (inbox: { address: string; password: string }) => (await mailJson(`${MAILTM}/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(inbox) })).token as string;

async function newInbox() {
  const domains = await (await fetch(`${MAILTM}/domains`)).json();
  const domain = (domains["hydra:member"] || domains)[0].domain;
  const inbox = { address: `nynz-invite-${randomBytes(4).toString("hex")}@${domain}`, password: randomBytes(18).toString("base64url") };
  const created = await fetch(`${MAILTM}/accounts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(inbox) });
  if (!created.ok) throw new Error(`inbox ${created.status}`);
  return inbox;
}
/** The newest unseen email's NYNZ link; logs sender, subject and where the link returns to (never its token). */
async function nextLink(inbox: { address: string; password: string }, kind: string, seenKey: string) {
  const token = await mailToken(inbox);
  state[seenKey] ||= [];
  for (let i = 0; i < 72; i += 1) {
    const list = await mailJson(`${MAILTM}/messages`, { headers: { authorization: `Bearer ${token}` } });
    const fresh = (list["hydra:member"] || []).find((m: { id: string }) => !state[seenKey].includes(m.id));
    if (fresh) {
      const msg = await mailJson(`${MAILTM}/messages/${fresh.id}`, { headers: { authorization: `Bearer ${token}` } });
      state[seenKey].push(fresh.id); save();
      const body = [msg.html?.join?.("") || "", msg.text || ""].join("\n").replace(/&amp;/g, "&");
      const link = (body.match(/https:\/\/[^\s"'<>]+(?:verify|confirm|callback)[^\s"'<>]*/) || [""])[0];
      const redirect = (() => { try { return new URL(link).searchParams.get("redirect_to") || ""; } catch { return ""; } })();
      console.log(`${kind} email: from ${msg.from?.address}, subject "${msg.subject}", returns to ${redirect.replace(/\?.*$/, "")}`);
      return { link, from: msg.from?.address as string, subject: msg.subject as string, redirect };
    }
    await wait(5000);
  }
  throw new Error(`no ${kind} email within 6 minutes`);
}
async function signIn(browser: Browser, email: string, password: string) {
  const page = await browser.newPage();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email); await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const ok = await page.waitForURL(/\/dashboard/, { timeout: 30_000 }).then(() => true, () => false);
  await page.close();
  return ok;
}
/** Opens an emailed link in a fresh, signed-out browser and chooses a new password there. */
async function choosePasswordFrom(browser: Browser, link: string, shot: string) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  await page.goto(link, { waitUntil: "networkidle" });
  await page.locator("#new-password").waitFor({ timeout: 30_000 }).catch(() => undefined);
  const landed = new URL(page.url());
  await page.screenshot({ path: `${DIR}/${shot}` });
  if (!(await page.locator("#new-password").isVisible().catch(() => false))) { await context.close(); return { landed: `${landed.origin}${landed.pathname}`, password: null as string | null, text: (await page.locator("body").innerText().catch(() => "")).slice(0, 200) }; }
  const password = randomBytes(18).toString("base64url");
  await page.fill("#new-password", password); await page.fill("#confirm-password", password);
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL((u) => !/reset-password|set-password/.test(u.pathname), { timeout: 30_000 }).catch(() => undefined);
  await context.close();
  return { landed: `${landed.origin}${landed.pathname}`, password, text: "" };
}

async function waitlist() {
  state.inviteInbox ||= await newInbox(); save();
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Request an invite" }).click();
  const panel = page.getByTestId("invite-only");
  const shown = await panel.waitFor({ timeout: 20_000 }).then(() => true, () => false);
  await page.screenshot({ path: `${DIR}/01-invite-only.png` });
  const text = shown ? (await panel.innerText()).replace(/\s+/g, " ") : "";
  check("public signup entry opens the branded invite waitlist (no password field)", shown && /Thank you for wanting to join NYNZ/.test(text) && !(await page.locator("#password").isVisible().catch(() => false)), text.slice(0, 160));
  await page.fill("#waitlist-email", state.inviteInbox.address);
  await page.getByRole("button", { name: "Request an invite" }).click();
  const done = await page.getByText("You're on the list.").waitFor({ timeout: 20_000 }).then(() => true, () => false);
  await page.screenshot({ path: `${DIR}/02-on-the-list.png` });
  const { data: row } = await read.from("signup_waitlist").select("email,requests,created_at").eq("email_normalized", state.inviteInbox.address.toLowerCase()).maybeSingle();
  check("a test request is saved", done && Boolean(row), row ? `saved at ${row.created_at}` : (await page.locator("body").innerText()).slice(0, 200));
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`${APP}/login?mode=signup`, { waitUntil: "networkidle" });
  await mobile.getByTestId("invite-only").waitFor({ timeout: 20_000 }).catch(() => undefined);
  await mobile.screenshot({ path: `${DIR}/03-invite-only-phone.png`, fullPage: true });
  await browser.close();
}

async function refused() {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const email = `direct-signup-${randomBytes(4).toString("hex")}@example.com`;
  const { data, error } = await anon.auth.signUp({ email, password: randomBytes(18).toString("base64url") });
  const { data: users } = await read.auth.admin.listUsers({ perPage: 1000 });
  check("a direct signup request is refused by Supabase and creates no account", Boolean(error) && !data.user && !users.users.some((u) => u.email === email), error ? `${error.status} ${error.message}` : "accepted");
}

async function admin() {
  const context = await ownerContext(true);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto(`${APP}/admin/waitlist`, { waitUntil: "networkidle" });
  const row = page.locator("tr", { hasText: state.inviteInbox.address });
  const visible = await row.first().waitFor({ timeout: 20_000 }).then(() => true, () => false);
  await page.screenshot({ path: `${DIR}/04-admin-waitlist.png`, fullPage: true });
  check("the request is visible in Admin, then Waitlist", visible, new URL(page.url()).pathname);
  if (!visible) { await context.close(); return; }
  state.invitedAt = new Date().toISOString(); save();
  await row.first().getByRole("button", { name: "Send invitation" }).click();
  await page.waitForTimeout(6000);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: `${DIR}/05-admin-invited.png`, fullPage: true });
  const reauth = /confirm your password/i.test(body);
  check("the admin's invitation is accepted by NYNZ", !reauth && !/error|failed|not accepted/i.test(body.slice(body.indexOf(state.inviteInbox.address), body.indexOf(state.inviteInbox.address) + 600)), reauth ? "NYNZ asked the admin to confirm their password" : (body.match(/(email_sent|Invitation sent|sent|delivery[^.]*)/i)?.[0] || "see screenshot"));
  await context.close();
}

async function accept() {
  const mail = await nextLink(state.inviteInbox, "invitation", "seenInvite");
  check("the invitation email arrives and returns to NYNZ", /^https:\/\/www\.nynz\.in\/auth\/callback/.test(mail.redirect), `from ${mail.from}, "${mail.subject}"`);
  const browser = await chromium.launch({ executablePath: CHROME });
  const result = await choosePasswordFrom(browser, mail.link, "06-accept-invite.png");
  check("accepting the invitation opens Choose your password on NYNZ", result.landed === `${APP}/account/set-password`, result.landed + (result.text ? `: ${result.text}` : ""));
  if (result.password) {
    state.invitePassword = result.password; save();
    check("the invited person signs in with the password they chose (public signup off)", await signIn(browser, state.inviteInbox.address, result.password));
  }
  await browser.close();
}

async function reset() {
  const earlier = JSON.parse(readFileSync(`${process.env.RESET_DIR}/state.json`, "utf8"));
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  if (!process.env.SKIP_REQUEST) {
    await page.goto(`${APP}/forgot-password`, { waitUntil: "networkidle" });
    await page.fill("#email", earlier.inbox.address);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${DIR}/07-forgot-password.png` });
  }
  // Only reset emails from the last 15 minutes count; the newest one is used (each request replaces the previous link).
  const token = await mailToken(earlier.inbox);
  if (!state.resetPrimed) { const list = await mailJson(`${MAILTM}/messages`, { headers: { authorization: `Bearer ${token}` } }); state.seenReset = (list["hydra:member"] || []).filter((m: { createdAt: string }) => Date.parse(m.createdAt) < Date.now() - 15 * 60_000).map((m: { id: string }) => m.id); state.resetPrimed = true; save(); }
  const mail = await nextLink(earlier.inbox, "recovery", "seenReset");
  check("a fresh reset email arrives and returns to NYNZ", /^https:\/\/www\.nynz\.in\/auth\/callback/.test(mail.redirect), `from ${mail.from}, "${mail.subject}"`);
  const result = await choosePasswordFrom(browser, mail.link, "08-reset-password.png");
  check("the reset link opens Choose a new password on NYNZ (signed-out browser)", result.landed === `${APP}/reset-password`, result.landed + (result.text ? `: ${result.text}` : ""));
  if (result.password) {
    const oldPassword = earlier.accountPassword;
    check("the new password signs in", await signIn(browser, earlier.inbox.address, result.password));
    check("the previous password no longer signs in", !(await signIn(browser, earlier.inbox.address, oldPassword)));
    earlier.previousPassword = oldPassword; earlier.accountPassword = result.password;
    writeFileSync(`${process.env.RESET_DIR}/state.json`, JSON.stringify(earlier, null, 2)); chmodSync(`${process.env.RESET_DIR}/state.json`, 0o600);
  }
  await browser.close();
}

const stages: Record<string, () => Promise<void>> = { waitlist, refused, admin, accept, reset };
const stage = process.argv[2];
if (!stages[stage]) throw new Error(`unknown stage ${stage}`);
await stages[stage]();
