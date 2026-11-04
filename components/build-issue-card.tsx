"use client";

import Link from "next/link";
import { Coins, PauseCircle, RotateCcw, Square, Terminal, Wrench } from "lucide-react";
import { describeIssue, type IssueTone } from "@/lib/platform/build-issues";

const TONE: Record<IssueTone, { icon: typeof PauseCircle; ring: string; text: string }> = {
  paused: { icon: PauseCircle, ring: "border-amber-300/25 bg-amber-300/[.05]", text: "text-amber-200" },
  credits: { icon: Coins, ring: "border-[#c7ff4a]/25 bg-[#c7ff4a]/[.05]", text: "text-[#c7ff4a]" },
  fixable: { icon: Wrench, ring: "border-sky-300/25 bg-sky-300/[.05]", text: "text-sky-200" },
  retry: { icon: RotateCcw, ring: "border-red-300/25 bg-red-300/[.05]", text: "text-red-200" },
  stopped: { icon: Square, ring: "border-white/15 bg-white/[.03]", text: "text-white/75" },
};

/** Friendly explanation of why the last build stopped, with the one action that helps. */
export function BuildIssueCard({ code, hasPreview, onRetry, onLogs }: { code: string | null | undefined; hasPreview: boolean; onRetry: () => void; onLogs: () => void }) {
  const issue = describeIssue(code);
  const tone = TONE[issue.tone];
  const Icon = tone.icon;
  return <section role="status" className={`nynz-pop-in rounded-2xl border p-4 ${tone.ring}`}>
    <div className={`flex items-center gap-2 text-[12px] font-medium ${tone.text}`}><Icon className="h-4 w-4 shrink-0" /> {issue.title}</div>
    <p className="mt-2 text-[12px] leading-5 text-white/65">{issue.body}</p>
    {hasPreview && issue.tone !== "stopped" && <p className="mt-2 text-[11px] text-white/45">Your previous working version is still live in the preview.</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {issue.action === "billing" && <Link href="/billing" className="nynz-lift inline-flex items-center gap-1.5 rounded-lg bg-[#c7ff4a] px-3 py-1.5 text-[11px] font-semibold text-[#071019]"><Coins className="h-3.5 w-3.5" /> Add credits</Link>}
      {(issue.action === "retry" || issue.action === "wait") && <button onClick={onRetry} className="nynz-lift inline-flex items-center gap-1.5 rounded-lg bg-white/[.08] px-3 py-1.5 text-[11px] text-white/85 hover:bg-white/[.12]"><RotateCcw className="h-3.5 w-3.5" /> Try again</button>}
      <button onClick={onLogs} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] text-white/50 hover:bg-white/[.06] hover:text-white"><Terminal className="h-3.5 w-3.5" /> Build log</button>
    </div>
  </section>;
}
