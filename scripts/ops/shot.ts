/** Screenshot a public page (read-only). URL=... OUT=file [W=1440 H=900] */
import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: Number(process.env.W || 1440), height: Number(process.env.H || 900) } });
await p.goto(process.env.URL!, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await p.screenshot({ path: process.env.OUT! });
await b.close();
