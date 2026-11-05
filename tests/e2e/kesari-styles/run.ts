/**
 * Local before/after check for the Kesari Threads styling mismatch (NYNZ 0.4.0
 * production validation). "before" builds the app exactly as production
 * generated it; "after" runs the same files through the 0.4.1 pipeline
 * (stylesheet step with the screens' class names, then the styles step), with
 * a local stand-in answering instead of the AI. Both are built with Vite and
 * photographed at desktop and phone widths: landing, navigation, mobile menu
 * and Orders. Real-model stylesheet quality needs a paid run.
 *
 *   OUT=<dir> NODE_MODULES=<dir with react, react-dom, vite, @vitejs/plugin-react> \
 *     npx tsx tests/e2e/kesari-styles/run.ts
 */
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync, spawn } from "node:child_process";
import { chromium, type Page } from "playwright-core";
import { generateWithOpenRouter } from "../../../lib/platform/openrouter";
import { styleGaps } from "../../../lib/platform/build-engine";
import { FIXED_STARTER_PATHS } from "../../../lib/platform/starter";
import { classesFromStylesRequest, heuristicCss } from "../../fixtures/heuristic-css";

const OUT = process.env.OUT!;
const NODE_MODULES = process.env.NODE_MODULES!;
type Files = Array<{ path: string; content: string }>;
const build: Files = JSON.parse(readFileSync("tests/fixtures/kesari-threads/build.json", "utf8")).files;
const reply = (value: unknown) => new Response(JSON.stringify({ id: crypto.randomUUID(), model: "anthropic/claude-sonnet-5.5", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } }), { status: 200 });

// After: the 0.4.1 pipeline writes the stylesheet with the screens' class names in context,
// the stand-in returns the same mismatched stylesheet production got, and the styles step fills the gaps.
process.env.OPENROUTER_API_KEY = "local-only";
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  const user: string = body.messages[1].content;
  if (body.response_format.json_schema.name === "nynz_styles") return reply({ files: [{ path: "src/index.css", content: heuristicCss(classesFromStylesRequest(user)) }] });
  const paths = (user.split("GENERATE THESE FILES NOW:\n")[1]?.split("\n\n")[0] || "").split("\n").map((line) => line.split(":")[0]).filter(Boolean);
  return reply({ files: paths.map((path) => build.find((file) => file.path === path)) });
}) as typeof fetch;
const manifest = { plan: { summary: "Kesari Threads", steps: ["Landing", "Orders"] }, message: "Ready", files: build.map((file) => ({ path: file.path, purpose: file.path })) };
const output = await generateWithOpenRouter({ prompt: "Kesari Threads", files: [], mode: "create", approvedManifest: manifest, completed: build.filter((file) => file.path !== "src/index.css" && !FIXED_STARTER_PATHS.has(file.path)) });
const after = build.map((file) => output.result.files.find((item) => item.path === file.path) || file);
console.log(`unstyled class names: before ${styleGaps(build).missing.length}, after ${styleGaps(after).missing.length}`);

function stage(name: string, files: Files) {
  const dir = join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  for (const file of files) { mkdirSync(dirname(join(dir, file.path)), { recursive: true }); writeFileSync(join(dir, file.path), file.content); }
  symlinkSync(NODE_MODULES, join(dir, "node_modules"));
  execSync("npx vite build --logLevel error", { cwd: dir, stdio: "inherit" });
  return dir;
}
async function shots(name: string, dir: string, port: number) {
  const server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: dir, stdio: "ignore", detached: true });
  for (let i = 0; i < 40; i += 1) { if (await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok).catch(() => false)) break; await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const notes: string[] = [];
  try {
    for (const [label, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]] as const) {
      const page: Page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: "networkidle" });
      await page.screenshot({ path: join(OUT, `${name}-landing-${label}.png`) });
      const nav = await page.evaluate(() => { const el = document.querySelector(".l-nav, nav"); if (!el) return "none"; const cs = getComputedStyle(el); return `${cs.display}/${cs.flexDirection}`; });
      const burger = page.locator(".hamburger, [aria-label*='menu' i]").first();
      const burgerVisible = await burger.isVisible().catch(() => false);
      notes.push(`${name} ${label}: nav ${nav}; menu button ${burgerVisible ? "visible" : "hidden"}`);
      if (label === "phone" && burgerVisible) { await burger.click(); await page.waitForTimeout(400); await page.screenshot({ path: join(OUT, `${name}-menu-open-phone.png`) }); }
      if (label === "phone" && burgerVisible) await burger.click().catch(() => undefined);
      await page.locator("button:visible, a:visible").filter({ hasText: /Explore demo/i }).first().click();
      await page.getByRole("button", { name: /Sign in as Manager/i }).click();
      // Navigation for the screenshot only (the unstyled "before" page overlays its own menu).
      await page.locator("aside button, nav button, aside a, nav a").filter({ hasText: /^Orders$/ }).first().evaluate((el) => (el as HTMLElement).click());
      await page.waitForTimeout(500);
      const card = await page.evaluate(() => { const el = document.querySelector(".order-card"); if (!el) return "none"; const cs = getComputedStyle(el); return `padding ${cs.paddingTop}, border ${cs.borderTopWidth}`; });
      notes.push(`${name} ${label}: order card ${card}`);
      await page.screenshot({ path: join(OUT, `${name}-orders-${label}.png`) });
      await page.close();
    }
  } finally { await browser.close(); try { process.kill(-server.pid!, "SIGKILL"); } catch { /* gone */ } }
  return notes;
}
const notes = [...await shots("before", stage("before", build), 4310), ...await shots("after", stage("after", after), 4311)];
console.log(notes.join("\n"));
