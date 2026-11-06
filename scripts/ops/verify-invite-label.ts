/** Read-only: the live invite page's label (text, colour, no icon or pill). */
import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
await p.goto("https://www.nynz.in/login?mode=signup", { waitUntil: "networkidle" });
const label = p.getByTestId("invite-only").locator("p", { hasText: /^Invite only$/ });
const info = await label.evaluate((el) => { const s = getComputedStyle(el); return { text: (el as HTMLElement).innerText, color: s.color, transform: s.textTransform, border: s.borderTopWidth, background: s.backgroundColor, icons: el.querySelectorAll("svg").length }; });
console.log(JSON.stringify(info));
await p.screenshot({ path: `${process.env.OUT}/invite-only-live.png` });
await b.close();
