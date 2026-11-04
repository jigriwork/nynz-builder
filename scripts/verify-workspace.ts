/** No paid calls. Disposable verified .invalid account; no email is delivered. */
import { config } from "dotenv";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright-core";
import JSZip from "jszip";

config({ path: ".env.local", quiet: true });
const base = process.env.NYNZ_VERIFY_BASE_URL || "http://localhost:3100";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { path, method, body });
}

async function main() {
  const email = `workspace-${randomUUID()}@nynz-verify.invalid`;
  const password = randomBytes(24).toString("base64url");
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("Could not create disposable account");
  const userId = created.data.user.id;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let checks = 0;
  const check = (label: string, passed: boolean) => { if (!passed) throw new Error(label); checks++; console.log(`PASS ${label}`); };
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${base}/login`);
    await page.fill("#email", email); await page.fill("#password", password);
    await page.getByRole("button", { name: /^Sign in/ }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30000 });
    check("customer sign-in reaches workspace", true);
    const project = await api(page, "/api/projects", "POST", { name: "Workspace verification" });
    check("customer creates a project", project.status === 201);
    const id = project.body.project.id;
    const source = "export default function App(){ return <main>Searchable orchid fixture</main> }";
    const saved = await api(page, `/api/projects/${id}/files`, "PUT", { files: [{ path: "src/App.tsx", content: source, baseHash: null }, { path: "README.md", content: "# Customer-authored instructions", baseHash: null }] });
    check("source fixture saves with checked hashes", saved.status === 200);
    await page.goto(`${base}/projects/${id}`);
    await page.locator('[data-builder-ready="true"]').waitFor();
    await page.getByRole("button", { name: "Search project", exact: true }).click();
    const search = page.getByRole("textbox", { name: "Search filenames and contents" });
    await search.fill("orchid");
    check("content search locates the correct file", await page.getByRole("dialog").getByRole("button", { name: /src\/App.tsx:1/ }).isVisible());
    await page.getByRole("dialog").getByRole("button", { name: /src\/App.tsx:1/ }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.locator('textarea[spellcheck="false"]');
    await editor.fill(source.replace("orchid", "iris"));
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/projects/${id}/files`) && r.request().method() === "PUT"),
      editor.evaluate((element) => element.blur()),
    ]);
    check("manual edit saves through the actual builder", response.status() === 200);
    const current = await api(page, `/api/projects/${id}/files`);
    const app = current.body.files.find((f: any) => f.path === "src/App.tsx");
    check("saved edit persists on the server", app.content.includes("iris"));
    const stale = await api(page, `/api/projects/${id}/files`, "PUT", { files: [{ path: app.path, content: "stale", baseHash: null }] });
    check("stale writer is rejected", stale.status === 409);
    const archive = await context.request.get(`${base}/api/projects/${id}/export`);
    const zip = await JSZip.loadAsync(await archive.body());
    check("real downloaded ZIP preserves customer README", await zip.file("README.md")?.async("string") === "# Customer-authored instructions");
    check("export contains the saved source and no environment files", Boolean((await zip.file("src/App.tsx")?.async("string"))?.includes("iris")) && !Object.keys(zip.files).some((path) => /(^|\/)\.env/.test(path)));
    check("customer cannot open admin console", (await page.goto(`${base}/admin`))?.status() === 404);
    await page.goto(`${base}/dashboard`);
    check("customer workspace remains available", new URL(page.url()).pathname === "/dashboard");
    const removed = await api(page, `/api/projects/${id}`, "DELETE");
    check("fixture project deletion succeeds", removed.status === 204);
    console.log(`${checks}/${checks} workspace browser checks passed; no paid requests made.`);
  } finally {
    await browser?.close().catch(() => undefined);
    const removed = await db.auth.admin.deleteUser(userId);
    if (removed.error) throw new Error("Disposable account cleanup failed; inspect workspace verification fixtures");
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Workspace verification failed"); process.exitCode = 1; });
