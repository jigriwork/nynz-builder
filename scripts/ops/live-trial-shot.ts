import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 1200, height: 700 } });
const err = await p.goto("http://localhost:3000/", { waitUntil: "load" }).then(() => "loaded", (e) => String(e.message).split("\n")[0]);
await p.waitForTimeout(1500);
await p.screenshot({ path: `${process.env.LIVE_DIR}/02-confirmation-redirect.png` });
console.log(err);
await b.close();
