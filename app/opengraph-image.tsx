import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Link preview image for WhatsApp, X, LinkedIn, iMessage, Slack and search results. */
export const alt = "NYNZ: Your idea. A working app. Describe your app and NYNZ builds it live.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#070b12";
const PAPER = "#f4f1e8";
const LIME = "#c7ff4a";

export default async function OpenGraphImage() {
  const wordmark = `data:image/png;base64,${(await readFile(join(process.cwd(), "public/brand/nynz-wordmark-spaced.png"))).toString("base64")}`;
  const font = (weight: number) => readFile(join(process.cwd(), `app/fonts/Geist-${weight}.woff`));
  const [regular, semibold, bold] = await Promise.all([font(400), font(600), font(700)]);
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: INK, color: PAPER, fontFamily: "Geist", padding: "56px 72px", backgroundImage: "linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)", backgroundSize: "56px 56px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={wordmark} width={186} height={60} alt="" />
        <div style={{ display: "flex", fontSize: 24, color: "rgba(244,241,232,.55)" }}>nynz.in</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 96, fontWeight: 600, letterSpacing: -4, lineHeight: 1 }}>Your idea.</div>
        <div style={{ display: "flex", fontSize: 96, fontWeight: 600, letterSpacing: -4, lineHeight: 1.05, color: LIME }}>A working app.</div>
        <div style={{ display: "flex", marginTop: 22, fontSize: 30, color: "rgba(244,241,232,.65)", maxWidth: 900 }}>Describe it in plain words. NYNZ writes real code and runs it live in minutes.</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, width: 660, padding: "14px 14px 14px 26px", borderRadius: 20, border: "1px solid rgba(255,255,255,.14)", background: "#101824" }}>
          <div style={{ display: "flex", flex: 1, fontSize: 26, color: "rgba(244,241,232,.75)" }}>Class booking for a yoga studio</div>
          <div style={{ display: "flex", alignItems: "center", padding: "12px 20px", borderRadius: 12, background: LIME, color: "#071019", fontSize: 22, fontWeight: 700 }}>Build this app →</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, letterSpacing: 2, color: "rgba(244,241,232,.85)" }}>
          <span>MADE IN</span>
          <span style={{ display: "flex", fontWeight: 800 }}><span style={{ color: "#ff9933" }}>IN</span><span style={{ color: "#ffffff" }}>D</span><span style={{ color: "#2fbf3a" }}>IA</span></span>
          <svg width="22" height="20" viewBox="0 0 24 22"><path d="M12 21.6 10.3 20C4.2 14.5 0 10.7 0 6.1 0 2.6 2.7 0 6.1 0 8.1 0 10 .9 12 2.6 14 .9 15.9 0 17.9 0 21.3 0 24 2.6 24 6.1c0 4.6-4.2 8.4-10.3 13.9z" fill="#ff3b3b" /></svg>
        </div>
      </div>
    </div>,
    { ...size, fonts: [{ name: "Geist", data: regular, weight: 400 }, { name: "Geist", data: semibold, weight: 600 }, { name: "Geist", data: bold, weight: 700 }] },
  );
}
