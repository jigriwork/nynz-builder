/**
 * Strict phone-fit check: every visible text, button, link and image must sit
 * inside the screen unless it is inside a deliberately scrollable container
 * (overflow-x auto/scroll) or decorative (aria-hidden). Catches content that
 * is clipped by overflow-x: hidden, which a scroll-width check cannot see.
 *   tsx scripts/perf/phone-fit.ts http://localhost:3100/ [more URLs]
 */
import { chromium } from "playwright-core";

const FIT = `(() => {
  const vw = window.innerWidth; const bad = [];
  for (const el of document.querySelectorAll("main h1,main h2,main h3,main p,main a,main button,main img,main li,main span,main label,main input,main textarea")) {
    if (el.closest("[aria-hidden=true]")) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let p = el.parentElement, scrolls = false;
    while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll") { scrolls = true; break; } p = p.parentElement; }
    if (scrolls) continue;
    if (r.right > vw + 1 || r.left < -1) bad.push((el.tagName + " " + (el.textContent || "").trim().slice(0, 40)) + " right=" + Math.round(r.right));
  }
  return bad;
})()`;

async function main() {
  const urls = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  let failures = 0;
  for (const width of [360, 390, 430]) for (const url of urls) {
    const page = await (await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" })).newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    for (let y = 0; y < 30000; y += 700) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(60); }
    await page.waitForTimeout(400);
    const bad = await page.evaluate(FIT) as string[];
    failures += bad.length;
    console.log(`${bad.length ? "FAIL" : "PASS"} ${width}px ${url}${bad.length ? `\n  ${bad.slice(0, 8).join("\n  ")}` : ""}`);
  }
  await browser.close();
  process.exit(failures ? 1 : 0);
}
main();
