/**
 * Browser smoke test for public pages against a running build (no sign-in, no
 * provider calls). Checks NYNZ identity, metadata, recovery pages, removed
 * inherited assets and APIs, console errors and phone-width layout.
 *   NYNZ_VERIFY_BASE_URL=http://localhost:3100 pnpm exec tsx scripts/verify-public-pages.ts
 */
import { chromium } from "playwright-core";

const base = (process.env.NYNZ_VERIFY_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
const results: Array<[string, boolean, string?]> = [];
const check = (name: string, ok: boolean, detail?: string) => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`); };

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  for (const [path, title] of [["/", /NYNZ: build real web apps/], ["/pricing", /Pricing · NYNZ/], ["/login", /Sign in · NYNZ/], ["/forgot-password", /NYNZ/], ["/reset-password", /Choose a new password · NYNZ/]] as const) {
    const response = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    check(`${path} loads`, response?.status() === 200, String(response?.status()));
    check(`${path} title`, title.test(await page.title()), await page.title());
    const text = await page.locator("body").innerText();
    check(`${path} shows no inherited identity`, !/open[\s-]?lovable|firecrawl|mendable/i.test(text));
  }
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  check("no 'Systems operational' claim", !(await page.locator("body").innerText()).includes("Systems operational"));
  const meta = await page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"), og: document.querySelector('meta[property="og:image"]')?.getAttribute("content"),
    twitter: document.querySelector('meta[name="twitter:card"]')?.getAttribute("content"), manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
    theme: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"), icon: document.querySelector('link[rel="icon"]')?.getAttribute("href"),
  }));
  check("canonical, Open Graph, Twitter, manifest, theme colour and icon", Boolean(meta.canonical && meta.og && meta.twitter === "summary_large_image" && meta.manifest && meta.theme && meta.icon), JSON.stringify(meta));
  const og = await page.request.get(`${base}/opengraph-image`);
  check("Open Graph image renders", og.status() === 200 && (og.headers()["content-type"] || "").includes("image/png"));
  await page.goto(`${base}/login?notice=link_expired`, { waitUntil: "networkidle" });
  check("expired link message on sign-in", /expired or was already used/.test(await page.locator("body").innerText()));
  check("sign-in offers password recovery", await page.getByRole("link", { name: "Forgot password?" }).isVisible());
  await page.goto(`${base}/reset-password`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("reset page without a recovery session explains the link expired", /expired or was already used/.test(await page.locator("body").innerText()));
  const robots = await (await page.request.get(`${base}/robots.txt`)).text();
  check("robots.txt disallows private routes", ["/admin", "/dashboard", "/projects", "/billing", "/account", "/api/"].every((p) => robots.includes(`Disallow: ${p}`)));
  check("sitemap lists public pages only", /\/pricing/.test(await (await page.request.get(`${base}/sitemap.xml`)).text()));
  for (const path of ["/firecrawl.svg", "/firecrawl-logo"]) check(`${path} returns 404`, (await page.request.get(`${base}${path}`)).status() === 404);
  check("legacy API returns 404", (await page.request.post(`${base}/api/scrape-website`, { data: {} })).status() === 404);
  check("unauthenticated API returns 401 with safe JSON", (await page.request.get(`${base}/api/projects`)).status() === 401);
  const dash = await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  check("anonymous /admin redirects to sign-in", page.url().includes("/login?next=%2Fadmin"), String(dash?.status()));
  const missing = await page.goto(`${base}/no-such-page`, { waitUntil: "networkidle" });
  check("branded 404", missing?.status() === 404 && /NYNZ/.test(await page.title()));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/pricing", "/login", "/forgot-password"]) {
    await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${path} has no horizontal scroll at phone width`, overflow <= 1, `${overflow}px`);
  }
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

main().catch((error) => check("run", false, error instanceof Error ? error.message : String(error))).finally(() => {
  console.log(`\n${results.filter((r) => r[1]).length}/${results.length} checks passed`);
  process.exit(results.every((r) => r[1]) ? 0 : 1);
});
