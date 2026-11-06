/**
 * Project attachments without a file-count cap, locally: more than 20
 * supported files upload within the size allowance; the 10 MB per file and
 * 50 MB per project rules and content checks still hold; another account can
 * neither read nor write them through NYNZ or directly through Supabase
 * Storage; data-changing requests from another origin are refused; NYNZ's
 * pages carry the security headers. Local Supabase and Next app only.
 *
 *   npx tsx tests/e2e/uploads/run.ts <supabase-workdir>
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright-core";

const workdir = process.argv[2];
const local = Object.fromEntries(execFileSync("supabase", ["status", "-o", "env", "--workdir", workdir], { encoding: "utf8" }).split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(local.API_URL)) throw new Error("Refusing to run: Supabase API is not local");
const APP = "http://127.0.0.1:3700";
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`); console.log(results.at(-1)); };
const env = { ...process.env, NODE_ENV: "development" as const, NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL: APP, PREVIEW_SIGNING_SECRET: "local-uploads-only-0123456789abcdef0123456789", RAZORPAY_KEY_ID: "", RAZORPAY_KEY_SECRET: "" };

async function account(label: string) {
  const email = `uploads-${label}-${Date.now()}@example.com`, password = `Pw-${randomUUID()}`;
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  return { id: data.user!.id, email, password };
}
async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", who.email); await page.fill("#password", who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
}
/** Uploads from inside the page, exactly as the builder does (same-origin browser request). */
const upload = (page: Page, projectId: string, kind: "png" | "bigpng" | "fakepng", name: string) => page.evaluate(`(async () => {
  const pngHead = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
  const size = ${kind === "bigpng" ? 9.5 * 1024 * 1024 : 2048};
  const bytes = new Uint8Array(size);
  ${kind === "fakepng" ? "bytes.set([0x4d,0x5a,0x90,0x00]);" : "bytes.set(pngHead);"}
  const form = new FormData();
  form.append("file", new File([bytes], ${JSON.stringify(name)}, { type: "image/png" }));
  const r = await fetch("/api/projects/${projectId}/assets", { method: "POST", body: form });
  return { status: r.status, body: await r.json().catch(() => ({})) };
})()`) as Promise<{ status: number; body: { error?: string; asset?: { storageName: string } } }>;

async function main() {
  const app: ChildProcess = spawn("npx", ["next", "dev", "-p", "3700", "-H", "127.0.0.1"], { env, stdio: "ignore", detached: true });
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    for (let i = 0; i < 180; i += 1) { if ((await fetch(`${APP}/login`).catch(() => null))?.ok) break; await new Promise((r) => setTimeout(r, 1000)); }
    const a = await account("owner"), b = await account("other");
    const project = (await admin.from("projects").insert({ owner_id: a.id, name: "Uploads check" }).select("id").single()).data!.id as string;
    const pageA = await (await browser.newContext()).newPage();
    await signIn(pageA, a);

    // More than 20 supported files.
    const statuses: number[] = [];
    for (let i = 1; i <= 25; i += 1) statuses.push((await upload(pageA, project, "png", `logo-${i}.png`)).status);
    const listed = await pageA.evaluate(`fetch("/api/projects/${project}/assets").then((r) => r.json())`) as { assets: Array<{ storageName: string; previewUrl: string | null }> };
    check("25 supported files upload (no 20-file cap) and all 25 are listed with previews", statuses.every((s) => s === 201) && listed.assets.length === 25 && listed.assets.every((x) => x.previewUrl), `${statuses.filter((s) => s === 201).length} accepted, ${listed.assets.length} listed`);

    // Existing size and content rules still hold.
    const big: number[] = [];
    for (let i = 1; i <= 5; i += 1) big.push((await upload(pageA, project, "bigpng", `photo-${i}.png`)).status);
    const over = await upload(pageA, project, "bigpng", "photo-6.png");
    check("the 50 MB project allowance still applies (5 × 9.5 MB fit, the next one is refused)", big.every((s) => s === 201) && over.status === 400 && /50 MB/.test(over.body.error || ""), over.body.error);
    const tooBig = await pageA.evaluate(`(async () => { const f = new FormData(); const b = new Uint8Array(11 * 1024 * 1024); b.set([0x89,0x50,0x4e,0x47]); f.append("file", new File([b], "huge.png", { type: "image/png" })); const r = await fetch("/api/projects/${project}/assets", { method: "POST", body: f }); return r.status; })()`);
    const fake = await upload(pageA, project, "fakepng", "not-really.png");
    check("a file over 10 MB and a file whose contents don't match its type are refused", [400, 413].includes(tooBig as number) && fake.status === 400 && /do not match|50 MB/.test(fake.body.error || ""), `over 10 MB: ${tooBig}; mismatched contents: ${fake.status} ${fake.body.error}`);

    // Another account, through NYNZ and directly through Supabase Storage.
    const pageB = await (await browser.newContext()).newPage();
    await signIn(pageB, b);
    const bList = await pageB.evaluate(`fetch("/api/projects/${project}/assets").then((r) => r.status)`);
    const bUpload = await upload(pageB, project, "png", "intruder.png");
    const bDelete = await pageB.evaluate(`fetch("/api/projects/${project}/assets", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ storageName: ${JSON.stringify(listed.assets[0].storageName)} }) }).then((r) => r.status)`);
    check("another account cannot list, upload to or delete from the project through NYNZ", bList === 404 && bUpload.status === 404 && bDelete === 404, `list ${bList}, upload ${bUpload.status}, delete ${bDelete}`);
    const asB = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });
    await asB.auth.signInWithPassword({ email: b.email, password: b.password });
    const direct = asB.storage.from("project-assets");
    const { data: bFiles } = await direct.list(project, { limit: 1000 });
    const { error: readErr } = await direct.download(`${project}/${listed.assets[0].storageName}`);
    const { error: writeErr } = await direct.upload(`${project}/intruder.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { contentType: "image/png" });
    const { data: signErr } = await direct.createSignedUrl(`${project}/${listed.assets[0].storageName}`, 60);
    const total = (await admin.storage.from("project-assets").list(project, { limit: 1000 })).data?.length;
    check("directly through Supabase Storage, another account sees no files and cannot read, sign or write", (bFiles || []).length === 0 && Boolean(readErr) && Boolean(writeErr) && !signErr?.signedUrl && total === 30, `list ${(bFiles || []).length}, read ${readErr ? "refused" : "ALLOWED"}, write ${writeErr ? "refused" : "ALLOWED"}, files still ${total}`);

    // Request-origin protection and security headers.
    const cross = await pageA.request.post(`${APP}/api/projects/${project}/assets`, { headers: { origin: `https://${project}.preview.nynz.in` }, multipart: { file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } } });
    const crossDelete = await pageA.request.delete(`${APP}/api/projects/${project}`, { headers: { origin: "https://evil.example" } });
    const stillThere = (await admin.from("projects").select("id").eq("id", project).maybeSingle()).data;
    check("data-changing requests from a preview or another site are refused before reaching the route", cross.status() === 403 && crossDelete.status() === 403 && Boolean(stillThere), `upload ${cross.status()}, delete ${crossDelete.status()}`);
    const head = await fetch(`${APP}/login`);
    const h = (k: string) => head.headers.get(k) || "";
    check("NYNZ's pages send the security headers", /frame-ancestors 'none'/.test(h("content-security-policy")) && h("x-frame-options") === "DENY" && h("x-content-type-options") === "nosniff" && h("referrer-policy") === "strict-origin-when-cross-origin" && /camera=\(\)/.test(h("permissions-policy")));
  } finally {
    await browser.close();
    try { if (app.pid) process.kill(-app.pid, "SIGKILL"); } catch { /* gone */ }
  }
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
