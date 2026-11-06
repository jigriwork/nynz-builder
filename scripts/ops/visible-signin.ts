/**
 * Opens a visible Chrome window with a private profile at a sign-in page and
 * waits for the owner to sign in themselves (nothing is typed or read by this
 * script). The session stays in the profile for later headless steps.
 *   PROFILE=<dir> START=<url> DONE=<regex on the signed-in URL> npx tsx scripts/ops/visible-signin.ts
 */
import { chmodSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
const PROFILE = process.env.PROFILE!, START = process.env.START!, DONE = new RegExp(process.env.DONE!);
mkdirSync(PROFILE, { recursive: true }); chmodSync(PROFILE, 0o700);
const context = await chromium.launchPersistentContext(PROFILE, { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: false, viewport: { width: 1360, height: 900 } });
const page = context.pages()[0] || await context.newPage();
await page.goto(START);
await page.bringToFront();
console.log("window open; waiting up to 20 minutes for the sign-in");
let closed = false; context.on("close", () => { closed = true; });
const deadline = Date.now() + 20 * 60_000;
while (Date.now() < deadline && !closed) {
  if (DONE.test(page.url()) && !/login|auth|sign-?in|verify/i.test(new URL(page.url()).pathname)) break;
  await new Promise((r) => setTimeout(r, 2000));
}
if (closed) { console.log("window closed before sign-in"); process.exit(3); }
const ok = DONE.test(page.url());
await page.waitForTimeout(4000);
await page.screenshot({ path: `${PROFILE}/../hpanel-after-signin.png` }).catch(() => undefined);
console.log(ok ? `signed in; on ${new URL(page.url()).hostname}${new URL(page.url()).pathname}` : "timed out without a sign-in");
await context.close();
process.exit(ok ? 0 : 2);
