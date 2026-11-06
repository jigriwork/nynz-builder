/**
 * Supabase CLI sign-in without copying codes by hand. Starts `supabase login`
 * in a pseudo-terminal, opens its login link in a visible Chrome window with
 * a dedicated temporary profile, waits for the owner to sign in to Supabase
 * themselves, approves the CLI, reads the verification code from the page
 * and types it into the CLI. The token is stored by the CLI (keychain); it is
 * never printed. Screenshots go to LIVE_DIR for progress.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const DIR = process.env.LIVE_DIR!;
for (const f of ["login-url.txt", "login-code.txt", "login-result.txt"]) rmSync(`${DIR}/${f}`, { force: true });
// expect gives the CLI a real terminal; the code is handed over through a private file.
const cli = spawn("expect", [`${DIR}/login.exp`, DIR], { stdio: "ignore" });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

let url = "";
for (let i = 0; i < 60 && !url; i += 1) { if (existsSync(`${DIR}/login-url.txt`)) url = readFileSync(`${DIR}/login-url.txt`, "utf8").trim(); await wait(500); }
if (!url) { log("CLI did not print a login link"); process.exit(1); }
log("CLI is waiting; opening Chrome for the Supabase sign-in");

const context = await chromium.launchPersistentContext(`${DIR}/supabase-profile`, { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: false, viewport: { width: 1280, height: 860 } });
const page = context.pages()[0] || await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.bringToFront();

let code = "";
const deadline = Date.now() + 15 * 60_000;
let shot = 0;
while (!code && Date.now() < deadline) {
  await wait(3000);
  if (shot++ % 5 === 0) await page.screenshot({ path: `${DIR}/supabase-login.png` }).catch(() => undefined);
  if (!/\/dashboard\/cli\/login/.test(page.url())) {
    // Signed in but taken elsewhere: return to the CLI approval page.
    if (/\/dashboard\/(projects|org|new|account)/.test(page.url())) await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    continue;
  }
  const body = await page.locator("body").innerText().catch(() => "");
  const approve = page.getByRole("button", { name: /authorize|approve|confirm|allow/i }).first();
  if (await approve.isVisible().catch(() => false)) { log("signed in; approving the CLI"); await approve.click().catch(() => undefined); continue; }
  const found = body.match(/verification code[^A-Za-z0-9]*([A-Za-z0-9]{6,12})/i) || body.match(/\b([a-f0-9]{8})\b/);
  if (found && /code/i.test(body)) code = found[1];
}
if (!code) { log("timed out waiting for the Supabase sign-in"); await page.screenshot({ path: `${DIR}/supabase-login.png` }); await context.close(); cli.kill(); process.exit(1); }
log("verification code read from the page; entering it into the CLI");
writeFileSync(`${DIR}/login-code.txt`, code, { mode: 0o600 });
let result = "";
for (let i = 0; i < 120 && !result; i += 1) { if (existsSync(`${DIR}/login-result.txt`)) result = readFileSync(`${DIR}/login-result.txt`, "utf8").trim(); await wait(500); }
rmSync(`${DIR}/login-url.txt`, { force: true });
log(result === "ok" ? "CLI signed in" : `CLI did not confirm sign-in (${result || "no answer"})`);
await page.screenshot({ path: `${DIR}/supabase-login.png` }).catch(() => undefined);
await context.close();
process.exit(result === "ok" ? 0 : 1);
