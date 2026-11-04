"use client";

/** Last-resort error boundary (replaces the root layout). No internal details are shown. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body style={{ margin: 0, background: "#070b12", color: "#f4f1e8", fontFamily: "system-ui, sans-serif" }}>
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, textAlign: "center" }}>
      <div style={{ maxWidth: 420 }}>
        <h1 style={{ fontSize: 28, fontWeight: 500 }}>NYNZ is having trouble loading.</h1>
        <p style={{ color: "rgba(244,241,232,.65)", lineHeight: 1.6 }}>Your projects and files are safe. Please try again in a moment.{error.digest ? ` Reference: ${error.digest}.` : ""}</p>
        <button onClick={reset} style={{ marginTop: 16, height: 40, padding: "0 16px", borderRadius: 12, border: 0, background: "#c7ff4a", color: "#071019", fontWeight: 600, cursor: "pointer" }}>Try again</button>
      </div>
    </main>
  </body></html>;
}
