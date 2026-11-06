/** Read-only: homepage loads and every image on it renders; the image optimizer returns a resized image. */
import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const failed: string[] = [];
  p.on("response", (r) => { if (/\.(png|jpe?g|webp|svg|ico)(\?|$)|_next\/image/.test(r.url()) && r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const res = await p.goto("https://www.nynz.in/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1000);
  const imgs = await p.locator("img").evaluateAll((els) => els.map((e) => ({ src: (e as HTMLImageElement).currentSrc.replace(/^https:\/\/www\.nynz\.in/, "").slice(0, 70), ok: (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0 })));
  const footer = /v0\.5\.7/.test(await p.locator("body").innerText());
  console.log(`${w}px: homepage ${res?.status()}, ${imgs.filter((i) => i.ok).length}/${imgs.length} images rendered, failed image requests ${failed.length}, footer v0.5.7 ${footer}`);
  if (imgs.some((i) => !i.ok)) console.log("  not rendered:", imgs.filter((i) => !i.ok).map((i) => i.src).join(", "));
  await p.screenshot({ path: `${process.env.OUT}/home-${w}.png` });
  await p.close();
}
const r = await fetch("https://www.nynz.in/_next/image?url=%2Fapple-icon.png&w=64&q=75");
const buf = Buffer.from(await r.arrayBuffer());
console.log(`image optimizer: ${r.status} ${r.headers.get("content-type")} ${buf.length} bytes, x-nextjs-cache ${r.headers.get("x-nextjs-cache")}`);
await b.close();
