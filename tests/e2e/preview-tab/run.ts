/**
 * "Open in new tab" for private previews, through the real builder button and
 * the real preview host. The NYNZ app (Next dev, :3200) and the preview host
 * (preview-host/api/proxy.ts served on :3001 for *.preview.localhost; the app at
 * app.preview.localhost:3200 so the embedded preview is same-site locally) share a
 * local Supabase stack; E2B is the stateful fake from tests/e2e/preview-host.
 * Checks the embedded preview and the new tab side by side, then access by a
 * signed-out visitor, another account and a replayed link.
 *
 *   npx tsx tests/e2e/preview-tab/run.ts <supabase-workdir>
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext } from "playwright-core";
import { FakeE2B } from "../preview-host/fake-e2b";

const workdir = process.argv[2];
const OUT = process.env.E2E_ARTIFACTS || "/tmp";
const local = Object.fromEntries(execFileSync("supabase", ["status", "-o", "env", "--workdir", workdir], { encoding: "utf8" }).split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(local.API_URL)) throw new Error("Refusing to run: Supabase API is not local");
// Same site as the preview hosts locally (production uses Secure, Partitioned cookies over HTTPS instead).
const APP = "http://app.preview.localhost:3200";
const SECRET = "local-preview-tab-only-0123456789abcdef0123456";
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); console.log(results.at(-1)); };

// Preview host (production code) in this process, with E2B faked.
Object.assign(process.env, { SUPABASE_URL: local.API_URL, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, E2B_API_KEY: "fake-e2b-key", PREVIEW_SIGNING_SECRET: SECRET, NYNZ_APP_ORIGIN: APP, PREVIEW_FRAME_ANCESTORS: APP, PREVIEW_HOST_SUFFIX: "preview.localhost:3001" });
const fake = new FakeE2B();
fake.install();
const handler = (await import(pathToFileURL(path.resolve("preview-host/api/proxy.ts")).href)).default as (req: any, res: any) => Promise<void>;
const previewServer = http.createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url || "/", "http://x");
  const query: Record<string, string> = { path: url.pathname.replace(/^\//, "") };
  url.searchParams.forEach((v, k) => { query[k] = v; });
  const chunks: Buffer[] = [];
  for await (const c of incoming) chunks.push(c as Buffer);
  const req = Object.assign(Readable.from(chunks), { method: incoming.method, headers: incoming.headers, query });
  let status = 200;
  const res = { status(c: number) { status = c; return res; }, setHeader(k: string, v: string) { outgoing.setHeader(k, v); return res; }, send(b: unknown) { outgoing.statusCode = status; outgoing.end(typeof b === "string" || Buffer.isBuffer(b) ? b : String(b ?? "")); return res; } };
  await handler(req, res);
});
await new Promise<void>((r) => previewServer.listen(3001, "127.0.0.1", r));

const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: local.DB_URL });
await db.connect();
const BLANK = ["E2B_API_KEY", "OPENROUTER_API_KEY", "FIRECRAWL_API_KEY", "SARVAM_API_KEY", "VERCEL_TOKEN", "PREVIEW_VERCEL_PROJECT_ID", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"];
const appEnv = { ...process.env, ...Object.fromEntries(BLANK.map((n) => [n, ""])), NODE_ENV: "development" as const, NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL: APP, NEXT_PUBLIC_APP_URL: APP, PREVIEW_SIGNING_SECRET: SECRET, PREVIEW_ORIGIN: "http://{projectId}.preview.localhost:3001" };

async function account(label: string) {
  const email = `${label}-${Date.now()}@example.com`, password = `Pw-${randomUUID()}`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  await db.query("select public.grant_credits($1,'promotional',100,now()+interval '7 days','fixture',null,$2)", [data.user!.id, `fixture:${data.user!.id}`]);
  return { id: data.user!.id, email, password };
}
async function signIn(context: BrowserContext, who: { email: string; password: string }) {
  const page = await context.newPage();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", who.email); await page.fill("#password", who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  return page;
}
const served = async (text: Promise<string>) => (await text.catch(() => "")).includes("Served by ");

async function main() {
  const app: ChildProcess = spawn("npx", ["next", "dev", "-p", "3200", "-H", "127.0.0.1"], { env: appEnv, stdio: "ignore", detached: true });
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    for (let i = 0; i < 180; i += 1) { if ((await fetch("http://127.0.0.1:3200/login").catch(() => null))?.ok) break; await new Promise((r) => setTimeout(r, 1000)); }
    const owner = await account("owner"), other = await account("other");
    const projectId = (await db.query("insert into public.projects(owner_id,name,status) values($1,'Preview tab fixture','ready') returning id", [owner.id])).rows[0].id as string;
    const sandbox = `sbxtab${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await db.query("select public.register_sandbox($1,$2,null,'preview')", [sandbox, projectId]);
    await db.query("update public.platform_resources set state='active' where provider_ref=$1", [sandbox]);
    await db.query("update public.projects set active_sandbox_id=$1, preview_url=$2 where id=$3", [sandbox, `http://${projectId}.preview.localhost:3001`, projectId]);
    fake.create(sandbox, 600);
    const previewOrigin = `http://${projectId}.preview.localhost:3001`;

    // Owner: embedded preview, then the builder's own "Open in new tab" button.
    const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const ownerPage = await signIn(ownerContext, owner);
    await ownerPage.goto(`${APP}/projects/${projectId}`, { waitUntil: "networkidle" });
    const frame = ownerPage.frameLocator("iframe[title='Application preview']");
    let embedded = false;
    for (let i = 0; i < 30 && !embedded; i += 1) { embedded = await served(frame.locator("body").innerText({ timeout: 2000 })); if (!embedded) await ownerPage.waitForTimeout(1000); }
    await ownerPage.screenshot({ path: `${OUT}/tab-1-builder.png` });
    check("embedded preview loads in the builder", embedded);
    const button = ownerPage.getByRole("link", { name: "Open preview in new tab" });
    const exchangeUsedByIframe = await ownerPage.locator("iframe[title='Application preview']").getAttribute("src");
    const [tab] = await Promise.all([ownerContext.waitForEvent("page"), button.click()]);
    await tab.waitForLoadState("networkidle").catch(() => undefined);
    await tab.waitForTimeout(1500);
    const tabText = await tab.locator("body").innerText().catch(() => "");
    await tab.screenshot({ path: `${OUT}/tab-2-new-tab.png` });
    const tabUrl = new URL(tab.url());
    check("the builder's Open in new tab button opens the working preview for the owner", tabText.includes(`Served by ${sandbox}`), `${tabUrl.origin}${tabUrl.pathname}: ${tabText.replace(/\s+/g, " ").slice(0, 120)}`);
    check("the new tab ends on a clean preview URL (no one-time token in the address bar)", tabUrl.origin === previewOrigin && !tabUrl.searchParams.has("t") && !tabUrl.pathname.startsWith("/__nynz"), tab.url().replace(/t=[^&]+/, "t=…"));
    await tab.goto(`${previewOrigin}/orders`, { waitUntil: "networkidle" });
    check("navigating inside the new tab keeps working", await served(tab.locator("body").innerText()));
    await ownerPage.reload({ waitUntil: "networkidle" });
    let stillEmbedded = false;
    for (let i = 0; i < 30 && !stillEmbedded; i += 1) { stillEmbedded = await served(frame.locator("body").innerText({ timeout: 2000 })); if (!stillEmbedded) await ownerPage.waitForTimeout(1000); }
    check("the same project works in both views at once (embedded preview after the new tab)", stillEmbedded && await served(tab.locator("body").innerText()));

    // Denied: replayed one-time link, signed-out visitor, another account.
    const connectsBefore = fake.calls.filter((c) => c.startsWith(`connect ${sandbox}`)).length;
    const stranger = await browser.newContext();
    const replay = await stranger.newPage();
    if (exchangeUsedByIframe) await replay.goto(exchangeUsedByIframe, { waitUntil: "networkidle" }).catch(() => undefined);
    check("a used preview link cannot be replayed in another browser", !(await served(replay.locator("body").innerText())), (await replay.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 80));
    const signedOut = await stranger.newPage();
    await signedOut.goto(`${APP}/api/projects/${projectId}/preview-session`, { waitUntil: "networkidle" }).catch(() => undefined);
    const signedOutUrl = new URL(signedOut.url());
    check("a signed-out visitor using the button's link is sent to sign in, not to the preview", !(await served(signedOut.locator("body").innerText())) && signedOutUrl.origin === APP && signedOutUrl.pathname === "/login", `${signedOutUrl.pathname}`);
    const direct = await stranger.newPage();
    await direct.goto(`${previewOrigin}/`, { waitUntil: "networkidle" }).catch(() => undefined);
    check("opening the preview address directly without a session is refused", !(await served(direct.locator("body").innerText())), (await direct.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 80));
    const otherContext = await browser.newContext();
    const otherPage = await signIn(otherContext, other);
    await otherPage.goto(`${APP}/api/projects/${projectId}/preview-session`, { waitUntil: "networkidle" }).catch(() => undefined);
    const otherUrl = new URL(otherPage.url());
    const otherText = await otherPage.locator("body").innerText().catch(() => "");
    check("another signed-in account cannot open this project's preview (ends on NYNZ's not-found page)", !otherText.includes("Served by ") && otherUrl.origin === APP && /404|hasn.t been built/i.test(otherText), `${otherUrl.pathname}`);
    const otherDirect = await otherContext.newPage();
    await otherDirect.goto(`${previewOrigin}/`, { waitUntil: "networkidle" }).catch(() => undefined);
    check("another account opening the preview address directly is refused", !(await served(otherDirect.locator("body").innerText())));
    check("denied attempts never woke the sandbox", fake.calls.filter((c) => c.startsWith(`connect ${sandbox}`)).length === connectsBefore);
  } finally {
    await browser.close();
    try { if (app.pid) process.kill(-app.pid, "SIGKILL"); } catch { /* gone */ }
    previewServer.close(); await db.end();
  }
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
