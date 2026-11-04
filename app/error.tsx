"use client";

import Link from "next/link";

/** Route-level error page: plain language plus a reference support can look up; no internal details. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="nynz-dark grid min-h-screen place-items-center bg-[#070b12] px-5 text-[#f4f1e8]">
    <div className="max-w-md text-center">
      <p className="text-[10px] uppercase tracking-[.2em] text-[#c7ff4a]">Something went wrong</p>
      <h1 className="mt-3 text-3xl font-medium tracking-[-.04em]">This page could not load.</h1>
      <p className="mt-3 text-sm leading-6 text-white/60">Your projects and files are safe. Try again, or return to your workspace.{error.digest ? ` If this keeps happening, contact support with reference ${error.digest}.` : ""}</p>
      <div className="mt-6 flex justify-center gap-3"><button onClick={reset} className="h-10 rounded-xl bg-[#c7ff4a] px-4 text-[13px] font-semibold text-[#071019]">Try again</button><Link href="/dashboard" className="inline-flex h-10 items-center rounded-xl border border-white/15 px-4 text-[13px] text-white/80">Workspace</Link></div>
    </div>
  </main>;
}
