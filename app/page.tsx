"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { ArrowRight, Code2, Folder, Globe2, History, Home, Layers3, LayoutGrid, Monitor, Paperclip, Play, Search, Sparkles, Terminal } from "lucide-react";
import { NynzBrand } from "@/components/nynz-brand";

const examples = [
  { label: "Operations", prompt: "Build a calm operations dashboard for a multi-location design studio" },
  { label: "Commerce", prompt: "Create a visual inventory and order tracker for a ceramics brand" },
  { label: "Community", prompt: "Make a member portal for a neighbourhood sports club" },
  { label: "Product", prompt: "Build a focused launch tracker with owners, dates and status views" },
];

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 50_000) { setError("Text briefs must be smaller than 50 KB."); return; }
    setAttachment({ name: file.name, content: await file.text() });
    setError("");
  }

  function start(event: FormEvent) {
    event.preventDefault();
    if (prompt.trim().length < 12) { setError("Tell us a little more about what you want to build."); return; }
    let parsedReference = "";
    if (reference.trim()) {
      try {
        const url = new URL(reference);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
        parsedReference = url.toString();
      } catch { setError("Add a valid public website URL."); return; }
    }
    sessionStorage.setItem("nynz_build_draft", JSON.stringify({ prompt: prompt.trim(), reference: parsedReference, attachment, createdAt: Date.now() }));
    window.location.assign("/dashboard");
  }

  return <main className="min-h-screen overflow-hidden bg-[#070b12] text-[#f4f1e8] selection:bg-[#c7ff4a] selection:text-[#071019]">
    <div className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[920px] nynz-hero-grid" />
      <div aria-hidden className="pointer-events-none absolute -top-64 left-1/2 h-[650px] w-[900px] -translate-x-1/2 rounded-full bg-[#294662]/20 blur-[170px]" />

      <header className="relative z-20 mx-auto flex h-[76px] max-w-[1280px] items-center justify-between px-5 md:px-8">
        <Link href="/" aria-label="NYNZ home"><NynzBrand className="h-7" /></Link>
        <nav className="hidden items-center gap-8 text-[13px] text-[#f4f1e8]/48 md:flex">
          <a href="#how" className="transition hover:text-[#f4f1e8]">How it works</a>
          <a href="#product" className="transition hover:text-[#f4f1e8]">Product</a>
          <span className="flex items-center gap-2"><i className="h-1.5 w-1.5 rounded-full bg-[#c7ff4a] shadow-[0_0_10px_#c7ff4a]" /> Systems operational</span>
        </nav>
        <Link href="/login" className="group inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[.045] px-4 py-2.5 text-[13px] transition hover:border-white/25 hover:bg-white/[.075]">
          Sign in <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </header>

      <section className="relative z-10 mx-auto max-w-[1180px] px-5 pb-24 pt-28 text-center md:px-8 md:pb-32 md:pt-40">
        <h1 className="mx-auto max-w-[1180px] text-[3rem] font-medium leading-[.94] tracking-[-.07em] sm:text-7xl md:text-[5.75rem]">
          Your idea. <span className="block text-[#f4f1e8]/82 sm:inline">A working app.</span>
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-base leading-7 text-[#f4f1e8]/48 md:text-lg">
          Describe what you need. NYNZ writes the source, runs the build and gives you a live app to shape with every message.
        </p>

        <form onSubmit={start} className="nynz-composer group relative mx-auto mt-12 max-w-[900px] rounded-[26px] border border-white/[.13] bg-[#101824]/95 p-2 text-left shadow-[0_40px_120px_rgba(0,0,0,.52)] backdrop-blur-2xl transition focus-within:border-[#c7ff4a]/35">
          <div className="rounded-[20px] border border-white/[.055] bg-[#0b121c]">
            <div className="flex items-center justify-between px-5 pt-4 text-[10px] uppercase tracking-[.18em] text-white/26">
              <span>New application</span>
              <span className="hidden sm:inline">React + TypeScript</span>
            </div>
            <textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); setError(""); }} rows={4} maxLength={30_000} placeholder="Describe the app you want to build…" aria-label="Application description" className="min-h-[150px] w-full resize-none bg-transparent px-5 pb-5 pt-5 text-[19px] leading-7 text-[#f4f1e8] outline-none placeholder:text-white/22 md:text-[22px]" />
            <div className="mx-2 flex flex-col gap-2 border-t border-white/[.07] p-2.5 md:flex-row md:items-center">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.035] px-3.5 text-xs text-white/52 transition hover:bg-white/[.07] hover:text-white"><Paperclip className="h-3.5 w-3.5" /> Attach brief</button>
                <input ref={fileRef} onChange={attach} type="file" accept=".txt,.md,.json,.csv,text/plain,text/markdown,application/json,text/csv" className="hidden" />
                <label className="flex h-10 min-w-[210px] flex-1 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.035] px-3.5 text-white/40 md:max-w-[310px]"><Globe2 className="h-3.5 w-3.5 shrink-0 text-[#c7ff4a]/75" /><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Add a website reference" aria-label="Website reference" className="min-w-0 flex-1 bg-transparent text-xs text-white/70 outline-none placeholder:text-white/28" /></label>
                {attachment && <button type="button" onClick={() => setAttachment(null)} className="h-10 max-w-[180px] truncate rounded-xl bg-[#c7ff4a]/10 px-3 text-xs text-[#c7ff4a]">{attachment.name} ×</button>}
              </div>
              <button disabled={!prompt.trim()} className="group/button inline-flex h-11 shrink-0 items-center justify-center gap-4 rounded-xl bg-[#c7ff4a] px-5 text-[13px] font-semibold text-[#071019] shadow-[0_8px_28px_rgba(199,255,74,.14)] transition hover:bg-[#d5ff72] disabled:cursor-not-allowed disabled:opacity-30">Build this app <ArrowRight className="h-4 w-4 transition-transform group-hover/button:translate-x-0.5" /></button>
            </div>
          </div>
          {error && <p role="alert" className="px-4 py-3 text-xs text-red-300">{error}</p>}
        </form>

        <div className="mx-auto mt-7 max-w-[900px] text-left">
          <p className="mb-3 text-center text-[9px] font-medium uppercase tracking-[.2em] text-white/22">Or start from an example</p>
          <div className="grid gap-2 sm:grid-cols-2">{examples.map((example) => <button key={example.label} onClick={() => { setPrompt(example.prompt); window.scrollTo({ top: 170, behavior: "smooth" }); }} className="group flex items-center gap-3 rounded-xl border border-white/[.065] bg-white/[.025] px-4 py-3 text-left transition hover:border-white/[.14] hover:bg-white/[.05]"><span className="rounded-md bg-white/[.06] px-2 py-1 text-[9px] uppercase tracking-[.14em] text-white/34 group-hover:text-[#c7ff4a]">{example.label}</span><span className="min-w-0 flex-1 truncate text-xs text-white/42 group-hover:text-white/70">{example.prompt}</span><ArrowRight className="h-3.5 w-3.5 text-white/18 transition group-hover:translate-x-0.5 group-hover:text-[#c7ff4a]" /></button>)}</div>
        </div>
      </section>
    </div>

    <section id="product" className="border-y border-white/[.07] bg-[#0a0f17] px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="text-[10px] font-medium uppercase tracking-[.22em] text-[#c7ff4a]">The builder</p><h2 className="mt-3 max-w-2xl text-4xl font-medium tracking-[-.055em] md:text-6xl">See the work. Shape the result.</h2></div><p className="max-w-sm text-sm leading-6 text-white/40">A preview-first workspace with the conversation, build state and source always within reach.</p></div>
        <div className="overflow-hidden rounded-[26px] border border-white/[.11] bg-[#0d1520] shadow-[0_48px_120px_rgba(0,0,0,.45)]">
          <div className="flex h-14 items-center border-b border-white/[.08] px-4 md:px-5"><NynzBrand className="h-5" /><span className="mx-3 text-white/15">/</span><span className="text-xs text-white/50">Fieldnote inventory</span><div className="ml-auto flex items-center gap-2"><span className="hidden rounded-full border border-[#c7ff4a]/15 bg-[#c7ff4a]/[.055] px-3 py-1.5 text-[9px] uppercase tracking-[.15em] text-[#c7ff4a] sm:block">Example interface</span><span className="rounded-lg bg-[#c7ff4a] px-3 py-2 text-[10px] font-semibold text-[#071019]">Export</span></div></div>
          <div className="grid min-h-[540px] lg:grid-cols-[46px_320px_1fr]">
            <aside className="hidden flex-col items-center border-r border-white/[.08] bg-[#0a111a] py-3 lg:flex">{[LayoutGrid,Home,Search,Folder,History,Terminal].map((Icon,index)=><span key={index} className={`mb-1 grid h-8 w-8 place-items-center rounded-md ${index===0?"bg-white/[.08] text-white/70":"text-white/25"}`}><Icon className="h-3.5 w-3.5" /></span>)}</aside>
            <aside className="hidden border-r border-white/[.08] bg-[#0c131d] lg:flex lg:flex-col"><div className="border-b border-white/[.07] px-4 py-4 text-[10px] font-medium text-white/65">Build with NYNZ</div><div className="flex-1 p-4"><p className="text-[9px] uppercase tracking-[.16em] text-white/24">You</p><div className="ml-7 mt-2 rounded-xl bg-white/[.09] p-3 text-[11px] leading-5 text-white/68">Build a calm inventory dashboard for a ceramics studio.</div><div className="mt-5 border-t border-white/[.07] pt-4"><div className="flex justify-between text-[10px]"><span>Build plan</span><span className="text-white/25">4 steps</span></div>{["Set the visual system", "Build inventory overview", "Add low-stock states", "Validate the production build"].map((item,index)=><div key={item} className="mt-3 flex gap-3 text-[9px] text-white/34"><span className="font-mono text-[#c7ff4a]">0{index+1}</span>{item}</div>)}</div><div className="mt-5 border-l border-[#c7ff4a]/50 bg-[#c7ff4a]/[.025] px-3 py-2"><p className="flex items-center gap-2 text-[9px] text-[#c7ff4a]"><span className="h-2.5 w-2.5 rounded-full border border-[#c7ff4a] border-t-transparent" /> Installing</p><p className="mt-2 text-[9px] text-white/28">Installing dependencies in E2B</p></div></div><div className="m-3 rounded-lg border border-white/[.1] bg-white/[.025] p-3 text-[10px] text-white/24">Ask for a change…</div></aside>
            <div className="flex flex-col bg-[#111a26]"><div className="flex h-11 items-center gap-1 border-b border-white/[.07] px-3"><span className="flex items-center gap-2 rounded-md bg-white/[.08] px-3 py-2 text-[10px] text-white/75"><Monitor className="h-3 w-3" /> Preview</span><span className="px-3 py-2 text-[10px] text-white/25">Code</span><span className="px-3 py-2 text-[10px] text-white/25">Logs</span><span className="mx-auto hidden w-48 truncate rounded-md border border-white/[.08] bg-black/20 px-3 py-1.5 text-[9px] text-white/25 xl:block">/inventory</span><span className="flex items-center gap-2 text-[9px] text-white/28"><i className="h-1.5 w-1.5 rounded-full bg-[#c7ff4a]" /> Live</span></div><div className="m-2.5 flex-1 rounded-xl bg-[#f1eee5] p-5 text-[#101820] md:m-4 md:p-7"><div className="flex items-start justify-between"><div><p className="text-[9px] uppercase tracking-[.18em] text-[#101820]/35">Studio inventory</p><h3 className="mt-2 text-2xl font-medium tracking-[-.045em] md:text-3xl">Everything in its place.</h3></div><span className="rounded-lg bg-[#101820] px-3 py-2 text-[9px] text-white">+ Add item</span></div><div className="mt-8 grid grid-cols-3 gap-2 md:gap-3">{[["In stock","248"],["Low stock","12"],["Value","₹1.8L"]].map(([label,value],index)=><div key={label} className={`rounded-xl p-3 md:p-4 ${index===1?"bg-[#dfff8a]":"bg-white"}`}><p className="text-[9px] text-[#101820]/35">{label}</p><p className="mt-4 text-lg font-medium md:text-2xl">{value}</p></div>)}</div><div className="mt-3 rounded-xl bg-white p-4"><div className="mb-3 flex justify-between text-[10px]"><span>Recent items</span><span className="text-[#101820]/35">Updated now</span></div>{["Sand glaze bowl","Taper holder","Stoneware mug"].map((item,index)=><div key={item} className="grid grid-cols-[1fr_auto] border-t border-[#101820]/[.07] py-3 text-[10px]"><span>{item}</span><span className={index===1?"text-orange-600":"text-[#101820]/35"}>{index===1?"6 · Low":"Healthy"}</span></div>)}</div></div></div>
          </div>
        </div>
      </div>
    </section>

    <section id="how" className="bg-[#f0ede4] px-5 py-24 text-[#0b121b] md:px-8 md:py-32"><div className="mx-auto max-w-[1240px]"><div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr]"><div><p className="text-[10px] font-semibold uppercase tracking-[.22em] text-[#597800]">From brief to browser</p><h2 className="mt-4 max-w-lg text-5xl font-medium leading-[.98] tracking-[-.065em] md:text-7xl">A build process you can trust.</h2></div><div className="grid gap-px overflow-hidden rounded-[22px] border border-[#0b121b]/10 bg-[#0b121b]/10 sm:grid-cols-2">{[[Sparkles,"01","Describe","Start with a plain-language brief, text attachment or public website reference."],[Layers3,"02","Plan","See the intended structure and build stages before the result is complete."],[Play,"03","Preview","Run the generated React application inside an isolated E2B environment."],[Code2,"04","Own","Inspect files, request focused edits, save versions and export the source."]].map(([Icon,n,title,text]) => { const ItemIcon = Icon as typeof Sparkles; return <article key={String(n)} className="min-h-[250px] bg-[#f7f4ec] p-6 md:p-8"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#0b121b] text-[#c7ff4a]"><ItemIcon className="h-4 w-4" /></span><span className="text-[10px] font-mono text-[#0b121b]/28">{String(n)}</span></div><h3 className="mt-16 text-2xl font-medium tracking-[-.04em]">{String(title)}</h3><p className="mt-3 text-sm leading-6 text-[#0b121b]/50">{String(text)}</p></article>; })}</div></div></div></section>
    <footer className="bg-[#070b12] px-5 py-8 md:px-8"><div className="mx-auto flex max-w-[1240px] flex-col gap-5 border-t border-white/[.08] pt-8 sm:flex-row sm:items-center sm:justify-between"><NynzBrand className="h-6" /><p className="text-xs text-white/28">Real source. Isolated previews. Your project.</p><Link href="/login" className="inline-flex items-center gap-2 text-xs text-[#c7ff4a]">Start building <ArrowRight className="h-3.5 w-3.5" /></Link></div></footer>
  </main>;
}
