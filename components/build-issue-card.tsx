"use client";

import { useState } from "react";
import Link from "next/link";
import { Coins, PauseCircle, Play, RotateCcw, Square, Terminal, Wrench } from "lucide-react";
import { describeIssue, type IssueTone } from "@/lib/platform/build-issues";

const TONE: Record<IssueTone, { icon: typeof PauseCircle; ring: string; text: string }> = {
  paused: { icon: PauseCircle, ring: "border-amber-300/25 bg-amber-300/[.05]", text: "text-amber-200" },
  credits: { icon: Coins, ring: "border-[#c7ff4a]/25 bg-[#c7ff4a]/[.05]", text: "text-[#c7ff4a]" },
  fixable: { icon: Wrench, ring: "border-sky-300/25 bg-sky-300/[.05]", text: "text-sky-200" },
  retry: { icon: RotateCcw, ring: "border-red-300/25 bg-red-300/[.05]", text: "text-red-200" },
  stopped: { icon: Square, ring: "border-white/15 bg-white/[.03]", text: "text-white/75" },
};

export type ResumeInfo = { saved: number; total: number; failedStep?: string | null; message?: string | null };

/**
 * Why the last build stopped and the one action that helps. When finished
 * steps are saved, Resume continues from the first unfinished step; Start over
 * (replanning and regenerating everything) needs an explicit confirmation.
 */
export function BuildIssueCard({ code, hasPreview, resume, onResume, onStartOver, onLogs, checkoutAvailable = false }: { code: string | null | undefined; hasPreview: boolean; resume?: ResumeInfo | null; onResume?: () => Promise<void>; onStartOver: () => Promise<void> | void; onLogs: () => void; checkoutAvailable?: boolean }) {
  const issue = describeIssue(code);
  const tone = TONE[issue.tone];
  const Icon = tone.icon;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const run = async (action: () => Promise<void> | void) => { if (busy) return; setBusy(true); try { await action(); } finally { setBusy(false); } };
  return <section role="status" className={`nynz-pop-in rounded-2xl border p-4 ${tone.ring}`}>
    <div className={`flex items-center gap-2 text-[12px] font-medium ${tone.text}`}><Icon className="h-4 w-4 shrink-0" /> {issue.title}</div>
    <p className="mt-2 text-[12px] leading-5 text-white/65">{resume?.message || issue.body}</p>
    {resume && <p className="mt-2 text-[11px] leading-5 text-white/55">{resume.total ? `${resume.saved} of ${resume.total} planned files are saved.` : `${resume.saved} finished step${resume.saved === 1 ? " is" : "s are"} saved.`}{resume.failedStep ? ` Stopped at: ${resume.failedStep}.` : ""}</p>}
    {hasPreview && issue.tone !== "stopped" && <p className="mt-2 text-[11px] text-white/45">Your previous working version is still live in the preview.</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {issue.action === "billing" && code === "TRIAL_BUDGET" && checkoutAvailable && <Link href="/pricing" className="nynz-lift inline-flex items-center gap-1.5 rounded-lg bg-[#c7ff4a] px-3 py-1.5 text-[11px] font-semibold text-[#071019]">Choose a plan</Link>}
      {issue.action === "billing" && code !== "TRIAL_BUDGET" && <Link href="/billing" className="nynz-lift inline-flex items-center gap-1.5 rounded-lg bg-[#c7ff4a] px-3 py-1.5 text-[11px] font-semibold text-[#071019]"><Coins className="h-3.5 w-3.5" /> Add credits</Link>}
      {resume && onResume && <button disabled={busy} onClick={() => run(onResume)} className="nynz-lift inline-flex items-center gap-1.5 rounded-lg bg-[#c7ff4a] px-3 py-1.5 text-[11px] font-semibold text-[#071019] disabled:opacity-50"><Play className="h-3.5 w-3.5" /> Resume</button>}
      {!resume && (issue.action === "retry" || issue.action === "wait") && <button disabled={busy} onClick={() => run(onStartOver)} className="nynz-lift inline-flex items-center gap-1.5 rounded-lg bg-white/[.08] px-3 py-1.5 text-[11px] text-white/85 hover:bg-white/[.12] disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" /> Try again</button>}
      {resume && !confirming && <button disabled={busy} onClick={() => setConfirming(true)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] text-white/55 hover:bg-white/[.06] hover:text-white"><RotateCcw className="h-3.5 w-3.5" /> Start over</button>}
      <button onClick={onLogs} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] text-white/50 hover:bg-white/[.06] hover:text-white"><Terminal className="h-3.5 w-3.5" /> Build log</button>
    </div>
    {resume && confirming && <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-[11px] leading-5 text-white/65">
      Start over plans and writes the whole app again. Saved steps are not reused, so it uses credits again. Resume is usually better.
      <div className="mt-2 flex gap-2"><button disabled={busy} onClick={() => run(async () => { await onStartOver(); setConfirming(false); })} className="rounded-lg bg-white/[.1] px-3 py-1.5 text-white/85 disabled:opacity-50">Start over anyway</button><button onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-white/50">Keep my progress</button></div>
    </div>}
  </section>;
}
