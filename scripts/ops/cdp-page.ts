/**
 * Drives the owner's already signed-in Chrome window over its local debugging
 * port (127.0.0.1 only). Never types credentials.
 *   CDP=http://127.0.0.1:9333 OUT=<dir> npx tsx scripts/ops/cdp-page.ts <goto URL | shot | text | click TEXT>
 */
import { chromium } from "playwright-core";
const [cmd, ...rest] = process.argv.slice(2);
const arg = rest.join(" ");
const browser = await chromium.connectOverCDP(process.env.CDP || "http://127.0.0.1:9333");
const context = browser.contexts()[0];
const page = context.pages().find((p) => /hostinger/.test(p.url())) || context.pages()[0];
if (cmd === "goto") await page.goto(arg, { waitUntil: "domcontentloaded" });
if (cmd === "click") await page.getByText(arg, { exact: false }).first().click();
if (cmd === "button") await page.getByRole("button", { name: arg }).last().click();
if (cmd === "link") await page.getByRole("link", { name: arg }).first().click();
await page.waitForTimeout(cmd === "shot" || cmd === "text" ? 500 : 6000);
await page.screenshot({ path: `${process.env.OUT}/hp.png` });
const text = (await page.locator("body").innerText().catch(() => "")).replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n");
console.log(page.url());
if (cmd !== "shot") console.log(text.slice(0, Number(process.env.MAX || 3000)));
await browser.close(); // disconnects only; the window stays open
