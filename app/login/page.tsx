"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setMessage("");
    const supabase = createClient();
    const result = mode === "signin" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (result.error) return setMessage(result.error.message);
    if (mode === "signup" && !result.data.session) return setMessage("Check your email to confirm your account.");
    window.location.assign("/dashboard");
  }
  return <main className="min-h-screen bg-[#f4f2ec] text-[#171713] grid lg:grid-cols-[1.2fr_.8fr]">
    <section className="hidden lg:flex p-16 flex-col justify-between bg-[#141411] text-white">
      <Link href="/" className="text-2xl font-semibold tracking-[-.06em]">NYNZ<span className="text-lime-300">.</span></Link>
      <div><p className="text-lime-300 uppercase text-xs tracking-[.25em] mb-5">Build software by describing it</p><h1 className="text-6xl leading-[.95] tracking-[-.06em] max-w-2xl">From intent to a running React app.</h1><p className="mt-7 text-white/55 max-w-lg text-lg">Persistent projects, isolated previews, real source code, and changes you can roll back.</p></div>
      <p className="text-white/35 text-sm">React + TypeScript web apps · Powered by Sarvam, Firecrawl and E2B</p>
    </section>
    <section className="flex items-center justify-center p-6"><form onSubmit={submit} className="w-full max-w-md bg-white border border-black/10 rounded-3xl p-8 shadow-[0_25px_80px_rgba(0,0,0,.08)]">
      <div className="lg:hidden text-2xl font-semibold mb-10">NYNZ<span className="text-lime-500">.</span></div>
      <p className="text-xs uppercase tracking-[.2em] text-black/45">{mode === "signin" ? "Welcome back" : "Create an account"}</p><h2 className="text-4xl tracking-[-.05em] mt-2 mb-8">{mode === "signin" ? "Sign in to build" : "Start building"}</h2>
      <label className="block text-sm mb-2">Email</label><input className="w-full border border-black/15 rounded-xl px-4 py-3 mb-5 outline-none focus:border-black" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
      <label className="block text-sm mb-2">Password</label><input className="w-full border border-black/15 rounded-xl px-4 py-3 mb-4 outline-none focus:border-black" type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required />
      {message && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg p-3 mb-4">{message}</p>}
      <button disabled={loading} className="w-full bg-[#171713] text-white rounded-xl py-3.5 disabled:opacity-50">{loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button>
      <button type="button" onClick={()=>setMode(mode === "signin" ? "signup" : "signin")} className="w-full mt-4 text-sm text-black/55">{mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}</button>
    </form></section>
  </main>;
}
