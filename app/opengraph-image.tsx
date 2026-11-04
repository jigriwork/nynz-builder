import { ImageResponse } from "next/og";

export const alt = "NYNZ: build real web apps from a brief";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#070b12", color: "#f4f1e8", padding: 72 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: "#c7ff4a", color: "#071019", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 800 }}>N</div>
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>NYNZ</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: -3, lineHeight: 1.02 }}>Build real web apps from a brief.</div>
        <div style={{ fontSize: 30, color: "rgba(244,241,232,.6)" }}>Plan, generate, preview, edit and export React source.</div>
      </div>
    </div>,
    size,
  );
}
