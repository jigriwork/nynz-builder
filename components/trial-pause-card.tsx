"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PauseCircle, ShieldCheck } from "lucide-react";
import { describeTrialReopen } from "@/lib/billing/trial";

export type TrialPause = { retryAt: string; checkoutAvailable: boolean };

/**
 * Stays in the builder while today's shared free trial allowance is used up:
 * when building reopens, that the project is safe, and "Choose a plan" only
 * when checkout is actually available. It removes itself at the reopen time.
 */
export function TrialPauseCard({ pause, onReopen }: { pause: TrialPause; onReopen: () => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const reopened = now.getTime() >= new Date(pause.retryAt).getTime();
  useEffect(() => { if (reopened) onReopen(); }, [reopened, onReopen]);
  if (reopened) return null;
  return <section role="status" aria-live="polite" data-testid="trial-pause" className="nynz-pop-in rounded-2xl border border-amber-300/25 bg-amber-300/[.05] p-4">
    <div className="flex items-center gap-2 text-[12px] font-medium text-amber-200"><PauseCircle className="h-4 w-4 shrink-0" /> Free trial building is paused for today</div>
    <p className="mt-2 text-[12px] leading-5 text-white/65">Free trials share a daily allowance, and today&apos;s is used up. You can try again from <span className="font-medium text-white/85">{describeTrialReopen(pause.retryAt, now)}</span>.</p>
    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-white/55"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#c7ff4a]" /> Your project and its files are safe, and nothing was charged for this request.</p>
    {pause.checkoutAvailable && <div className="mt-3"><Link href="/pricing" className="nynz-lift inline-flex items-center rounded-lg bg-[#c7ff4a] px-3 py-1.5 text-[11px] font-semibold text-[#071019]">Choose a plan</Link></div>}
  </section>;
}
