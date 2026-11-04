/**
 * Secure owner browser handoff for production verification.
 *
 *   tsx scripts/ops/owner-browser.ts signin   # opens a visible Chrome window; the owner signs in themselves
 *   tsx scripts/ops/owner-browser.ts status   # headless: is the stored session still the owner?
 *
 * The browser uses a dedicated temporary profile (NYNZ_OWNER_PROFILE, mode 700),
 * never the person's everyday Chrome profile. Credentials are typed by the owner
 * into nynz.in directly; nothing is read from or written to chat, logs or Git.
 * Delete the profile directory to end the session (`signout` also signs out).
 */
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright-core";
import { createServerClient } from "@supabase/ssr";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

export const BASE = process.env.NYNZ_VERIFY_BASE_URL || "https://www.nynz.in";
export const PROFILE = process.env.NYNZ_OWNER_PROFILE || "";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function ownerContext(headless = true, viewport = { width: 1366, height: 900 }): Promise<BrowserContext> {
  if (process.env.NYNZ_OWNER_CDP) {
    const browser = await chromium.connectOverCDP(process.env.NYNZ_OWNER_CDP);
    const context = browser.contexts()[0];
    // Disconnect from the explicitly opened task browser; do not close the
    // owner's sign-in or provider tabs when a verifier finishes.
    context.close = async () => { await browser.close(); };
    return context;
  }
  if (!PROFILE) throw new Error("Set NYNZ_OWNER_PROFILE to a private directory");
  mkdirSync(PROFILE, { recursive: true }); chmodSync(PROFILE, 0o700);
  return chromium.launchPersistentContext(PROFILE, { executablePath: CHROME, headless, viewport });
}

export async function whoAmI(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  const onDashboard = new URL(page.url()).pathname === "/dashboard";
  // The account button contains an avatar initial (and hides the email on
  // phones). Verify the actual browser session with Supabase Auth instead of
  // treating the button's first line as the account identity.
  const cookies = await context.cookies(BASE);
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll: () => cookies.map(({ name, value }) => ({ name, value })), setAll: () => undefined } });
  const { data: { user } } = await client.auth.getUser();
  await page.close();
  return { signedIn: onDashboard && Boolean(user), email: user?.email || "", userId: user?.id || null };
}

async function main() {
  const mode = process.argv[2];
  if (mode === "signin") {
    const context = await ownerContext(false);
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${BASE}/login?next=/admin`);
    console.log("[owner-browser] A Chrome window is open at the NYNZ sign-in page. Waiting up to 20 minutes for the owner to sign in…");
    let closed = false;
    context.on("close", () => { closed = true; });
    page.on("close", () => { closed = true; });
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline && !closed) {
      const path = new URL(page.url()).pathname;
      if (path === "/admin" || path === "/dashboard") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (closed) { console.log("[owner-browser] The window was closed before sign-in finished. Nothing was stored."); process.exit(3); }
    const path = new URL(page.url()).pathname;
    if (path !== "/admin" && path !== "/dashboard") { console.log("[owner-browser] Timed out without a sign-in."); await context.close(); process.exit(2); }
    await page.waitForTimeout(1500);
    console.log(`[owner-browser] Signed in; landed on ${path}. Closing the window; the session stays in the private profile.`);
    await context.close();
    return;
  }
  if (mode === "status") {
    const context = await ownerContext(true);
    console.log(JSON.stringify(await whoAmI(context)));
    await context.close();
    return;
  }
  if (mode === "signout") {
    const context = await ownerContext(true);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard`);
    await page.evaluate(async () => { await fetch("/auth/signout", { method: "POST" }).catch(() => undefined); });
    await context.close();
    rmSync(PROFILE, { recursive: true, force: true });
    console.log("[owner-browser] Profile deleted.");
    return;
  }
  throw new Error("usage: owner-browser.ts signin|status|signout");
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(`[owner-browser] ${error instanceof Error ? error.message : error}`); process.exit(1); });
