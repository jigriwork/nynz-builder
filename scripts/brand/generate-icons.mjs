/**
 * Regenerates the favicon and app icons from public/brand/nynz-icon.png:
 * a black rounded tile with the bright lime N (no glow, no border).
 *   app/favicon.ico (16, 32, 48, 64), app/icon.png (512), app/apple-icon.png (180, square),
 *   public/brand/app-icon-192.png, app-icon-512.png and app-icon-maskable-512.png (install icons).
 * Usage: node scripts/brand/generate-icons.mjs   (needs local Google Chrome)
 */
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const src = `data:image/png;base64,${readFileSync("public/brand/nynz-icon.png").toString("base64")}`;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
const out = await page.evaluate(async (src) => {
  const img = new Image(); img.src = src; await img.decode();
  const c0 = document.createElement("canvas"); c0.width = img.width; c0.height = img.height;
  const x0 = c0.getContext("2d"); x0.drawImage(img, 0, 0);
  const d = x0.getImageData(0, 0, img.width, img.height).data;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) { const k = (j * img.width + i) * 4; if (d[k + 1] > 180 && d[k + 2] < 140) { minX = Math.min(minX, i); maxX = Math.max(maxX, i); minY = Math.min(minY, j); maxY = Math.max(maxY, j); } }
  const mw = maxX - minX + 1, mh = maxY - minY + 1;
  const m = document.createElement("canvas"); m.width = mw; m.height = mh;
  const mx = m.getContext("2d"); const md = mx.createImageData(mw, mh);
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
    const k = ((j + minY) * img.width + (i + minX)) * 4, o = (j * mw + i) * 4;
    md.data[o] = 0xd6; md.data[o + 1] = 0xff; md.data[o + 2] = 0x3a; md.data[o + 3] = Math.max(0, Math.min(255, (d[k + 1] - 30) * 255 / 225));
  }
  mx.putImageData(md, 0, 0);
  function make(size, { pad, radius }) {
    const big = size * 4; const c = document.createElement("canvas"); c.width = big; c.height = big;
    const x = c.getContext("2d"); const r = big * radius;
    x.fillStyle = "#000000"; x.beginPath(); x.roundRect(0, 0, big, big, r); x.fill();
    const h = big * (1 - pad * 2), w = h * mw / mh, X = (big - w) / 2, Y = (big - h) / 2;
    x.imageSmoothingQuality = "high";
    x.drawImage(m, X, Y, w, h);
    let cur = c; while (cur.width / 2 >= size) { const n = document.createElement("canvas"); n.width = cur.width / 2; n.height = cur.height / 2; const nx = n.getContext("2d"); nx.imageSmoothingQuality = "high"; nx.drawImage(cur, 0, 0, n.width, n.height); cur = n; }
    return cur.toDataURL("image/png");
  }
  return {
    f16: make(16, { pad: .1, radius: 0 }), f32: make(32, { pad: .1, radius: 0 }),
    f48: make(48, { pad: .13, radius: 0 }), f64: make(64, { pad: .13, radius: 0 }),
    tab512: make(512, { pad: .13, radius: 0 }),
    i512: make(512, { pad: .17, radius: .24 }), i192: make(192, { pad: .17, radius: .24 }),
    apple: make(180, { pad: .2, radius: 0 }),
    maskable: make(512, { pad: .26, radius: 0 }),
  };
}, src);
await browser.close();
const png = (k) => Buffer.from(out[k].split(",")[1], "base64");
// ICO container holding PNG images.
const entries = [[16, "f16"], [32, "f32"], [48, "f48"], [64, "f64"]].map(([n, k]) => [n, png(k)]);
const header = Buffer.alloc(6 + 16 * entries.length); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach(([n, data], i) => { const o = 6 + 16 * i; header.writeUInt8(n, o); header.writeUInt8(n, o + 1); header.writeUInt16LE(1, o + 4); header.writeUInt16LE(32, o + 6); header.writeUInt32LE(data.length, o + 8); header.writeUInt32LE(offset, o + 12); offset += data.length; });
writeFileSync("app/favicon.ico", Buffer.concat([header, ...entries.map(([, d]) => d)]));
// Browser-tab icons are fully opaque squares: Safari paints its own coloured
// backing behind transparent corners, which showed as a lime edge.
writeFileSync("app/icon.png", png("tab512"));
writeFileSync("app/apple-icon.png", png("apple"));
writeFileSync("public/brand/app-icon-192.png", png("i192"));
writeFileSync("public/brand/app-icon-512.png", png("i512"));
// Full-bleed with the N inside the safe zone, for Android adaptive icons.
writeFileSync("public/brand/app-icon-maskable-512.png", png("maskable"));
console.log("icons written");
