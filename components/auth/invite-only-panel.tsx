"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { NynzBrand } from "@/components/nynz-brand";

/**
 * Shown instead of the signup form while NYNZ is invite-only: a thank-you,
 * why new accounts are paused, and a single field to ask for an invitation.
 */
export function InviteOnlyPanel({ onSignIn }: { onSignIn: () => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending"); setError("");
    const response = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => null);
    if (response?.ok) { setState("done"); return; }
    const body = await response?.json().catch(() => null);
    setError(body?.error || "We couldn't save your request just now. Please try again in a moment.");
    setState("idle");
  }
  return <div data-testid="invite-only" className="rounded-[20px] border border-white/[.06] bg-[#0b121b] p-6 sm:p-8">
    <NynzBrand className="h-7" />
    <p className="mt-7 inline-flex items-center gap-1.5 rounded-full border border-[#c7ff4a]/25 bg-[#c7ff4a]/[.07] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[.18em] text-[#c7ff4a]"><Sparkles className="h-3 w-3" /> Invite only</p>
    <h2 className="mt-4 text-3xl font-medium tracking-[-.05em] sm:text-[2.1rem]">Thank you for wanting to join NYNZ.</h2>
    <p className="mt-3 text-sm leading-6 text-white/55">We&apos;re in a private testing phase, so new accounts are by invitation for now. Leave your email and we&apos;ll send you an invite as we open more places. We&apos;ll be onboarding soon.</p>
    {state === "done"
      ? <div role="status" className="mt-7 rounded-xl border border-[#c7ff4a]/20 bg-[#c7ff4a]/[.06] p-4 text-sm leading-6 text-[#e9ffc0]"><p className="flex items-center gap-2 font-medium text-[#c7ff4a]"><Check className="h-4 w-4" /> You&apos;re on the list.</p><p className="mt-1 text-white/65">We&apos;ll email <span className="text-white/85">{email}</span> as soon as your invite is ready.</p></div>
      : <form onSubmit={submit} className="mt-7">
        <label className="mb-2 block text-[11px] font-medium text-white/60" htmlFor="waitlist-email">Email address</label>
        <input id="waitlist-email" className="mb-4 h-12 w-full rounded-xl border border-white/[.1] bg-white/[.035] px-4 text-sm text-white caret-[#c7ff4a] outline-none transition placeholder:text-white/18 focus:border-[#c7ff4a]/45 focus:bg-white/[.05]" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" required />
        {error && <p role="alert" className="mb-4 rounded-xl border border-red-400/20 bg-red-400/[.06] p-3 text-xs leading-5 text-red-300">{error}</p>}
        <button disabled={state === "sending"} className="group flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#c7ff4a] text-[13px] font-semibold text-[#071019] transition hover:bg-[#d5ff72] disabled:opacity-45">{state === "sending" ? "Sending…" : "Request an invite"}{state !== "sending" && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}</button>
        <p className="mt-3 text-center text-[11px] leading-5 text-white/40">We&apos;ll only use your email to send your invitation.</p>
      </form>}
    <div className="mt-6 flex items-center justify-center gap-2 text-xs text-white/32"><span>Already have an account?</span><button type="button" onClick={onSignIn} className="font-medium text-[#c7ff4a] hover:text-[#d5ff72]">Sign in</button></div>
  </div>;
}
