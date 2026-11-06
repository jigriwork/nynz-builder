/**
 * Post-deploy checks for 0.5.4 on production with existing test accounts:
 * screenshots of the homepage, sign-in and builder at desktop and phone
 * widths; the lime "Start building" button; invite-only access; and the
 * preview new-tab route for a signed-out visitor and another account. Every
 * request to a preview host is blocked, so no sandbox is woken. A temporary
 * empty project is created for the builder and deleted at the end.
 *   OUT=<dir> A_STATE=<state.json> B_STATE=<state.json> npx tsx scripts/ops/verify-release-054.ts
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser, type BrowserContext } from "playwright-core";

config({ path: ".env.local", quiet: true });
const APP = "https://www.nynz.in";
const OUT = process.env.OUT!;
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const a = JSON.parse(readFileSync(process.env.A_STATE!, "utf8")), b = JSON.parse(readFileSync(process.env.B_STATE!, "utf8"));
const accountA = { email: a.inviteInbox.address as string, password: a.invitePassword as string };
const accountB = { email: b.inbox.address as string, password: b.accountPassword as string };
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); };
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const previewRequests: string[] = [];

async function context(browser: Browser, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  await ctx.route(/\.preview\.nynz\.in|\/preview-session/, (route) => { previewRequests.push(new URL(route.request().url()).pathname); return route.abort(); });
  return ctx;
}
async function signIn(ctx: BrowserContext, who: { email: string; password: string }) {
  const page = await ctx.newPage();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", who.email); await page.fill("#password", who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  return page;
}

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const userA = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === accountA.email)!;
const { data: project } = await admin.from("projects").insert({ owner_id: userA.id, name: "Release 0.5.4 check (empty)" }).select("id").single();
try {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const ctx = await context(browser, viewport);
    const page = await ctx.newPage();
    await page.goto(`${APP}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/home-${name}.png` });
    if (name === "desktop") {
      const button = page.getByRole("link", { name: /Start building/ }).first();
      const style = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
      check("homepage: Start building is NYNZ lime", style === "rgb(199, 255, 74)", style);
      const nav = await page.getByRole("link", { name: "How it works" }).first().evaluate((el) => { const s = getComputedStyle(el); return `${s.color} ${s.fontSize} ${s.fontWeight}`; });
      check("homepage: navigation is bright, 14px, medium weight", /^rgb\(231, 236, 243\) 14px 500$/.test(nav), nav);
    }
    await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/login-${name}.png` });
    await page.getByRole("button", { name: "Request an invite" }).click();
    check(`sign-in (${name}): "Request an invite" opens the invite-only panel`, await page.getByTestId("invite-only").isVisible());
    await page.screenshot({ path: `${OUT}/invite-${name}.png` });
    const signedIn = await signIn(ctx, accountA);
    await signedIn.goto(`${APP}/projects/${project!.id}`, { waitUntil: "networkidle" });
    await signedIn.waitForTimeout(1500);
    await signedIn.screenshot({ path: `${OUT}/builder-${name}.png` });
    check(`builder (${name}) loads`, /What should we build|Describe your app/.test(await signedIn.locator("body").innerText()));
    await ctx.close();
  }

  // Preview new-tab route, without touching any preview host.
  const out = await browser.newContext();
  const so = await out.newPage();
  const r1 = await so.request.get(`${APP}/api/projects/${project!.id}/preview-session`, { maxRedirects: 0 });
  check("new-tab route, signed out: sent to sign in", r1.status() === 303 && /\/login\?next=%2Fprojects%2F/.test(r1.headers().location || ""), `${r1.status()} ${(r1.headers().location || "").replace(/^https:\/\/www\.nynz\.in/, "")}`);
  await out.close();
  const bctx = await browser.newContext();
  const bpage = await signIn(bctx, accountB);
  const r2 = await bpage.request.get(`${APP}/api/projects/${project!.id}/preview-session`, { maxRedirects: 0 });
  check("new-tab route, another account: no preview link, sent to NYNZ's project page (not found for them)", r2.status() === 303 && (r2.headers().location || "").endsWith(`/projects/${project!.id}`) && !/preview\.nynz\.in/.test(r2.headers().location || ""), `${r2.status()} ${r2.headers().location || ""}`);
  await bpage.goto(`${APP}/projects/${project!.id}`, { waitUntil: "networkidle" });
  check("another account opening the project page sees not found", /404|hasn.t been built/i.test(await bpage.locator("body").innerText()));
  await bctx.close();

  // Invite-only stays on.
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const email = `direct-signup-${randomBytes(4).toString("hex")}@example.com`;
  const { error } = await anon.auth.signUp({ email, password: randomBytes(18).toString("base64url") });
  check("direct public signup is still refused", Boolean(error), error ? `${error.status} ${error.message}` : "accepted");
  check("no request reached a preview host or preview link during these checks", previewRequests.length === 0, previewRequests.join(", "));
} finally {
  await browser.close();
  await admin.from("projects").delete().eq("id", project!.id);
}
console.log(results.join("\n"));
