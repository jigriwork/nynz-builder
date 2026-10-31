"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff } from "lucide-react";
import { NynzBrand } from "@/components/nynz-brand";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loop, setLoop] = useState(2);

  useEffect(() => {
    const timer = setInterval(() => setLoop((value) => (value + 1) % 3), 1600);
    return () => clearInterval(timer);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setMessage("");
    const supabase = createClient();
    const result = mode === "signin" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (result.error) return setMessage(result.error.message);
    if (mode === "signup" && !result.data.session) return setMessage("Check your inbox to confirm your email, then return here to sign in.");
    window.location.assign("/dashboard");
  }

  const isSignup = mode === "signup";
  return <main className="relative min-h-screen overflow-hidden bg-[#070b12] text-[#f4f1e8] selection:bg-[#c7ff4a] selection:text-[#071019]">
    <div aria-hidden className="absolute inset-0 nynz-auth-grid" />
    <div aria-hidden className="absolute -right-32 -top-48 h-[700px] w-[700px] rounded-full bg-[#274c68]/25 blur-[150px]" />
    <div aria-hidden className="absolute -bottom-64 left-[12%] h-[500px] w-[500px] rounded-full bg-[#c7ff4a]/[.05] blur-[120px]" />
    <header className="relative z-10 mx-auto flex h-[76px] max-w-[1280px] items-center justify-between px-5 md:px-8">
      <Link href="/"><NynzBrand className="h-7" /></Link>
      <Link href="/" className="inline-flex items-center gap-2 text-xs text-white/40 transition hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Back to home</Link>
    </header>

    <div className="relative z-10 mx-auto grid min-h-[calc(100vh-76px)] max-w-[1180px] items-center gap-10 px-5 pb-16 pt-6 md:px-8 lg:grid-cols-[1fr_480px] lg:gap-20">
      <section className="hidden lg:block">
        <p className="text-[10px] font-medium uppercase tracking-[.2em] text-[#c7ff4a]">NYNZ Builder</p>
        <h1 className="mt-6 max-w-2xl text-[4.6rem] font-medium leading-[.95] tracking-[-.07em]">Your projects.<br /><span className="text-white/55">Ready when you are.</span></h1>
        <p className="mt-6 max-w-lg text-base leading-7 text-white/42">Return to active builds, inspect every stage of the work and keep complete control of your source.</p>
        <div className="mt-12 max-w-xl overflow-hidden rounded-[22px] border border-white/[.1] bg-[#0d1520]/80 p-2 shadow-[0_35px_90px_rgba(0,0,0,.35)] backdrop-blur-xl">
          <div className="rounded-[16px] border border-white/[.06] bg-[#0a111a] p-5">
            <div className="flex items-center justify-between"><span className="text-[9px] uppercase tracking-[.18em] text-white/25">A transparent build loop</span><span className="flex items-center gap-2 text-[9px] text-[#c7ff4a]"><i className="h-1.5 w-1.5 rounded-full bg-[#c7ff4a] shadow-[0_0_9px_#c7ff4a]" /> Ready</span></div>
            <div className="mt-5 grid grid-cols-3 gap-2">{[["01","Plan"],["02","Generate"],["03","Preview"]].map(([n,label],index)=><div key={n} className={`rounded-xl border p-3 transition-colors duration-500 ${index===loop?"border-[#c7ff4a]/30 bg-[#c7ff4a]/[.08]":"border-white/[.07] bg-white/[.025]"}`}><span className="font-mono text-[9px] text-white/40">{n}</span><div className="mt-7 flex items-center gap-2 text-[11px] text-white/70"><span className={`grid h-4 w-4 place-items-center rounded-full transition-colors duration-500 ${index<=loop?"bg-[#c7ff4a]/15 text-[#c7ff4a]":"bg-white/[.06] text-white/30"}`}>{index===loop?<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#c7ff4a]" />:<Check className="h-2.5 w-2.5" />}</span>{label}</div></div>)}</div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[480px]">
        <div className="rounded-[26px] border border-white/[.11] bg-[#101823]/90 p-2 shadow-[0_40px_120px_rgba(0,0,0,.5)] backdrop-blur-2xl">
          <form onSubmit={submit} className="rounded-[20px] border border-white/[.06] bg-[#0b121b] p-6 sm:p-8">
            <div className="mb-8"><p className="text-[10px] font-medium uppercase tracking-[.2em] text-[#c7ff4a]">{isSignup ? "Create your workspace" : "Welcome back"}</p><h2 className="mt-3 text-3xl font-medium tracking-[-.05em] sm:text-4xl">{isSignup ? "Start building." : "Continue building."}</h2><p className="mt-3 text-sm leading-6 text-white/38">{isSignup ? "One account for your projects, builds and saved versions." : "Sign in to open your projects and active builds."}</p></div>
            <label className="mb-2 block text-[11px] font-medium text-white/60" htmlFor="email">Email address</label>
            <input id="email" className="mb-5 h-12 w-full rounded-xl border border-white/[.1] bg-white/[.035] px-4 text-sm text-white caret-[#c7ff4a] outline-none transition placeholder:text-white/18 focus:border-[#c7ff4a]/45 focus:bg-white/[.05]" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" required />
            <div className="mb-2 flex items-center justify-between"><label className="text-[11px] font-medium text-white/60" htmlFor="password">Password</label><span className="text-[10px] text-white/25">Minimum 8 characters</span></div>
            <div className="relative mb-5"><input id="password" className="h-12 w-full rounded-xl border border-white/[.1] bg-white/[.035] px-4 pr-12 text-sm text-white caret-[#c7ff4a] outline-none transition placeholder:text-white/18 focus:border-[#c7ff4a]/45 focus:bg-white/[.05]" type={showPassword ? "text" : "password"} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete={isSignup ? "new-password" : "current-password"} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 grid w-12 place-items-center text-white/28 hover:text-white/60">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
            {message && <p role="alert" className={`mb-5 rounded-xl border p-3 text-xs leading-5 ${message.startsWith("Check") ? "border-[#c7ff4a]/20 bg-[#c7ff4a]/[.06] text-[#c7ff4a]" : "border-red-400/20 bg-red-400/[.06] text-red-300"}`}>{message}</p>}
            <button disabled={loading} className="group flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#c7ff4a] text-[13px] font-semibold text-[#071019] transition hover:bg-[#d5ff72] disabled:opacity-45">{loading ? "Please wait…" : isSignup ? "Create workspace" : "Sign in"}{!loading && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}</button>
            <div className="mt-5 flex items-center justify-center gap-2 text-xs text-white/32"><span>{isSignup ? "Already have an account?" : "New to NYNZ?"}</span><button type="button" onClick={() => { setMode(isSignup ? "signin" : "signup"); setMessage(""); }} className="font-medium text-[#c7ff4a] hover:text-[#d5ff72]">{isSignup ? "Sign in" : "Create one"}</button></div>
          </form>
        </div>
      </section>
    </div>
  </main>;
}
