/**
 * Invite-only signup and email links, locally: the signup entry opens the
 * waitlist and saves a request; a password-reset link and an invitation link
 * (generated exactly as Supabase emails them) finish on NYNZ, let the person
 * set a password and sign in. Local Supabase stack and Next app only.
 *
 *   npx tsx tests/e2e/auth-links/run.ts <supabase-workdir>
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser } from "playwright-core";

const workdir = process.argv[2];
const OUT = process.env.E2E_ARTIFACTS || "/tmp";
const local = Object.fromEntries(execFileSync("supabase", ["status", "-o", "env", "--workdir", workdir], { encoding: "utf8" }).split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(local.API_URL)) throw new Error("Refusing to run: Supabase API is not local");
const APP = "http://localhost:3000";
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); console.log(results.at(-1)); };
const BLANK = ["E2B_API_KEY", "OPENROUTER_API_KEY", "FIRECRAWL_API_KEY", "SARVAM_API_KEY", "VERCEL_TOKEN", "PREVIEW_VERCEL_PROJECT_ID", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "NEXT_PUBLIC_SIGNUPS_OPEN"];
const env = { ...process.env, ...Object.fromEntries(BLANK.map((n) => [n, ""])), NODE_ENV: "development" as const, NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL: APP, NEXT_PUBLIC_APP_URL: APP, PREVIEW_SIGNING_SECRET: "local-auth-links-only-0123456789abcdef0123" };

async function signIn(browser: Browser, email: string, password: string) {
  const page = await browser.newPage();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email); await page.fill("#password", password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const ok = await page.waitForURL(/\/dashboard/, { timeout: 30_000 }).then(() => true, () => false);
  await page.close();
  return ok;
}

async function setPasswordFrom(browser: Browser, link: string, shot: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link, { waitUntil: "networkidle" });
  await page.locator("#new-password").waitFor({ timeout: 30_000 }).catch(() => undefined);
  const landed = new URL(page.url()).pathname;
  await page.screenshot({ path: `${OUT}/${shot}` });
  const password = `New-${Math.random().toString(36).slice(2)}-pass`;
  if (!(await page.locator("#new-password").isVisible().catch(() => false))) { await context.close(); return { landed, password: null }; }
  await page.fill("#new-password", password); await page.fill("#confirm-password", password);
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL((u) => !/reset-password|set-password/.test(u.pathname), { timeout: 30_000 }).catch(() => undefined);
  const after = new URL(page.url()).pathname;
  await context.close();
  return { landed, after, password };
}

async function main() {
  const app: ChildProcess = spawn("npx", ["next", "dev", "-p", "3000", "-H", "localhost"], { env, stdio: "ignore", detached: true });
  try {
    for (let i = 0; i < 180; i += 1) { if ((await fetch(`${APP}/login`).catch(() => null))?.ok) break; await new Promise((r) => setTimeout(r, 1000)); }
    const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });

    // 1. Signup entry opens the invite waitlist and saves a request.
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Request an invite" }).click();
    const panel = page.getByTestId("invite-only");
    await panel.waitFor();
    await page.screenshot({ path: `${OUT}/auth-1-invite-only.png` });
    const panelText = (await panel.innerText()).replace(/\s+/g, " ");
    check("signup entry opens the branded invite-only panel, with no password field", /Thank you for wanting to join NYNZ/.test(panelText) && /private testing phase/.test(panelText) && !(await page.locator("#password").isVisible().catch(() => false)));
    const waitEmail = `waitlist-${Date.now()}@example.com`;
    await page.fill("#waitlist-email", waitEmail);
    await page.getByRole("button", { name: "Request an invite" }).click();
    await page.getByText("You're on the list.").waitFor({ timeout: 20_000 });
    await page.screenshot({ path: `${OUT}/auth-2-on-the-list.png` });
    const { data: row } = await admin.from("signup_waitlist").select("email,requests").eq("email", waitEmail).maybeSingle();
    check("the request is saved in the waitlist", row?.requests === 1);
    const deep = await browser.newPage();
    await deep.goto(`${APP}/login?mode=signup`, { waitUntil: "networkidle" });
    check("a direct /login?mode=signup link also opens the waitlist", await deep.getByTestId("invite-only").isVisible());

    // 2. Password reset from an emailed link (generated exactly as the email's link).
    const email = `reset-${Date.now()}@example.com`;
    await admin.auth.admin.createUser({ email, password: "Original-pass-123", email_confirm: true });
    const recovery = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: `${APP}/auth/callback?next=/reset-password` } });
    const reset = await setPasswordFrom(browser, recovery.data.properties!.action_link, "auth-3-reset-password.png");
    check("the reset link opens Choose a new password on NYNZ", reset.landed === "/reset-password", reset.landed);
    check("the new password signs in and the old one does not", Boolean(reset.password) && await signIn(browser, email, reset.password!) && !(await signIn(browser, email, "Original-pass-123")));

    // 3. Invitation link: accept, choose a password, sign in.
    const invited = `invited-${Date.now()}@example.com`;
    const invite = await admin.auth.admin.generateLink({ type: "invite", email: invited, options: { redirectTo: `${APP}/auth/callback?next=${encodeURIComponent("/account/set-password?then=/dashboard")}` } });
    const accept = await setPasswordFrom(browser, invite.data.properties!.action_link, "auth-4-accept-invite.png");
    check("the invitation link opens Choose your password on NYNZ", accept.landed === "/account/set-password", accept.landed);
    check("the invited person signs in with the password they chose", Boolean(accept.password) && await signIn(browser, invited, accept.password!));

    // 4. A used or broken link explains itself.
    const used = await browser.newPage();
    await used.goto(recovery.data.properties!.action_link, { waitUntil: "networkidle" });
    check("a used reset link ends on the login page with a clear notice", /\/login/.test(used.url()) && /expired|not valid/i.test(await used.locator("body").innerText()), new URL(used.url()).pathname);
    await browser.close();
  } finally {
    try { if (app.pid) process.kill(-app.pid, "SIGKILL"); } catch { /* gone */ }
  }
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
