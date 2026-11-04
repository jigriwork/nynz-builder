"use client";

import Link from "next/link";
import { VersionTag } from "@/components/version-tag";
import { InformationLinks } from "@/components/information-links";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Box, Check, ChevronDown, Code2, Download, Globe2, History, Layers3, Lock, Paperclip, Play, ShieldCheck, Smartphone, MessageSquareText, Zap } from "lucide-react";
import { NynzBrand } from "@/components/nynz-brand";
import { PromptGuide } from "@/components/prompt-guide";
import { MadeInOdisha } from "@/components/made-in-odisha";
import { STARTERS } from "@/lib/prompt-starters";
import { BuildPipeline, Reveal, buildStages, ease } from "@/components/nynz-motion";

const typedExamples = STARTERS.slice(0, 4).map((starter) => starter.title);
const marquee = ["Client portals", "Analytics dashboards", "Booking flows", "Internal CRMs", "Storefronts", "Habit trackers", "Admin panels", "Landing pages", "Event RSVPs", "Inventory tools", "Recipe boxes", "Team wikis"];
const features = [
  { icon: Play, title: "Live preview", text: "Every build runs as a real application in its own isolated workspace, not a static mock-up.", wide: true },
  { icon: Globe2, title: "Website references", text: "Paste a public URL and NYNZ uses its content and style as direction." },
  { icon: History, title: "Checkpoints", text: "Save known-good versions and roll back in one click." },
  { icon: Smartphone, title: "Responsive by default", text: "Switch the preview to mobile and see your app at phone width." },
  { icon: Download, title: "Export the source", text: "Download a clean, runnable project whenever you like. No lock-in.", wide: true },
];
const faqs = [
  ["What kind of apps can NYNZ build?", "Responsive web applications including dashboards, portals, internal tools, storefronts, landing pages and more."],
  ["Do I own the code?", "Yes. Every file is visible and editable in the builder, and you can export the full project at any time."],
  ["Where does my app run?", "Each build runs in a secure isolated preview, served from a separate origin so it can’t access your NYNZ account."],
  ["Can I change things after the first build?", "Absolutely. Ask for changes in plain language. NYNZ edits the existing source instead of starting over."],
];
const demoLogs = ["Reading the brief", "Plan approved · 4 steps", "Writing 14 files", "Installing dependencies", "Production build passed", "Preview is live"];

/**
 * Typing placeholder written straight to the textarea, so the animation never
 * re-renders the page (it previously re-rendered the whole homepage ~25 times a
 * second).
 */
function useTypedPlaceholder(ref: React.RefObject<HTMLTextAreaElement | null>, lines: string[], enabled: boolean) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!enabled) { node.placeholder = "Describe the app you want to build…"; return; }
    let line = 0, char = 0, deleting = false, timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const target = lines[line];
      char += deleting ? -1 : 1;
      node.placeholder = target.slice(0, char);
      let delay = deleting ? 18 : 42;
      if (!deleting && char === target.length) { deleting = true; delay = 1800; }
      else if (deleting && char === 0) { deleting = false; line = (line + 1) % lines.length; delay = 300; }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 900);
    return () => clearTimeout(timer);
  }, [ref, lines, enabled]);
}

export default function HomePage() {
  // The composer keeps its own text; the page only re-renders when it switches
  // between empty and non-empty, so typing never re-renders the homepage.
  const promptRef = useRef("");
  const [hasPrompt, setHasPrompt] = useState(false);
  const [reference, setReference] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const reduce = useReducedMotion();
  useTypedPlaceholder(composerRef, typedExamples, !reduce && !focused && !hasPrompt);
  const setPrompt = (text: string) => { promptRef.current = text; if (composerRef.current) composerRef.current.value = text; setHasPrompt(Boolean(text.trim())); };

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 50_000) { setError("Text briefs must be smaller than 50 KB."); return; }
    setAttachment({ name: file.name, content: await file.text() });
    setError("");
  }

  function start(event: FormEvent) {
    event.preventDefault();
    const prompt = promptRef.current;
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


  const words = ["Your", "idea."];
  return <main className="nynz-dark min-h-screen overflow-x-hidden bg-[#070b12] text-[#f4f1e8] selection:bg-[#c7ff4a] selection:text-[#071019]">
    <header className="sticky top-0 z-40 border-b border-transparent bg-[#070b12]/60 backdrop-blur-xl transition-colors">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 md:px-8">
        <Link href="/" aria-label="NYNZ home"><NynzBrand className="h-7" /></Link>
        <nav className="hidden items-center gap-8 text-[13px] text-[#f4f1e8]/60 md:flex">
          <a href="#product" className="transition hover:text-[#f4f1e8]">Product</a>
          <a href="#how" className="transition hover:text-[#f4f1e8]">How it works</a>
          <a href="#faq" className="transition hover:text-[#f4f1e8]">FAQ</a>
          <Link href="/pricing" className="transition hover:text-[#f4f1e8]">Pricing</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden rounded-full px-4 py-2 text-[13px] text-white/65 transition hover:text-white sm:inline-flex">Sign in</Link>
          <Link href="/login" className="group inline-flex items-center gap-2 rounded-full bg-[#f4f1e8] px-4 py-2 text-[13px] font-medium text-[#071019] transition hover:bg-white">Start building <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></Link>
        </div>
      </div>
    </header>

    <div className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-16 h-[980px] nynz-hero-grid" />
      <div aria-hidden className="nynz-float pointer-events-none absolute -top-64 left-1/2 h-[650px] w-[900px] -translate-x-1/2 rounded-full bg-[#294662]/25 blur-[170px]" />
      <div aria-hidden className="nynz-float-slow pointer-events-none absolute left-[8%] top-[380px] h-[300px] w-[420px] rounded-full bg-[#c7ff4a]/[.06] blur-[130px]" />
      <div aria-hidden className="nynz-orbit pointer-events-none absolute left-1/2 top-[250px] h-[760px] w-[760px] -translate-x-1/2 rounded-full opacity-60 [mask-image:radial-gradient(circle,transparent_54%,black_56%,black_57%,transparent_62%)]" style={{ background: "conic-gradient(from 0deg, transparent 0deg, rgba(199,255,74,.55) 40deg, transparent 90deg, transparent 180deg, rgba(90,151,199,.45) 230deg, transparent 290deg)" }} />

      <section className="relative z-10 mx-auto max-w-[1180px] px-5 pb-20 pt-16 text-center md:px-8 md:pb-28 md:pt-24">
        <motion.a href="#how" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6, ease }} className="group mx-auto inline-flex items-center gap-2 rounded-full border border-white/[.1] bg-white/[.03] py-1 pl-1 pr-3 text-[12px] text-white/65 backdrop-blur transition hover:border-[#c7ff4a]/30">
          <span className="rounded-full bg-[#c7ff4a] px-2 py-0.5 text-[10px] font-semibold text-[#071019]">New</span> Real applications, live in minutes <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </motion.a>
        <h1 className="mx-auto mt-7 max-w-[1180px] text-[3.1rem] font-medium leading-[.94] tracking-[-.07em] sm:text-7xl md:text-[6rem]">
          {words.map((word, index) => <motion.span key={word} initial={{ opacity: 0, y: 30, filter: "blur(10px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: .8, delay: .1 + index * .09, ease }} className="mr-[.22em] inline-block">{word}</motion.span>)}
          <motion.span initial={{ opacity: 0, y: 30, filter: "blur(10px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: .9, delay: .32, ease }} className="nynz-text-shine block pb-2 sm:inline">A working app.</motion.span>
        </h1>
        <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .45, ease }} className="mx-auto mt-6 max-w-2xl text-base leading-7 text-[#f4f1e8]/60 md:text-lg">
          Describe what you need. NYNZ writes the source, runs the build and gives you a live app to shape with every message.
        </motion.p>

        <motion.form onSubmit={start} initial={{ opacity: 0, y: 24, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .8, delay: .55, ease }} className="nynz-composer group relative mx-auto mt-11 max-w-[900px] rounded-[26px] border border-white/[.12] bg-[#101824] p-2 text-left shadow-[0_40px_120px_rgba(0,0,0,.55)]" style={{ animation: "none" }}>
          <div className="rounded-[20px] border border-white/[.055] bg-[#0b121c]">
            <div className="flex items-center justify-between px-5 pt-4 text-[10px] uppercase tracking-[.18em] text-white/40">
              <span className="flex items-center gap-2"><span aria-hidden className="relative flex h-2 w-2"><span className="nynz-ping absolute inset-0 rounded-full bg-[#c7ff4a]/60" /><span className="relative h-2 w-2 rounded-full bg-[#c7ff4a]" /></span> New application</span>
              <span className="hidden sm:inline">Compiled, editable React source</span>
            </div>
            <textarea ref={composerRef} defaultValue="" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(event) => { promptRef.current = event.target.value; const has = Boolean(event.target.value.trim()); if (has !== hasPrompt) setHasPrompt(has); if (error) setError(""); }} rows={4} maxLength={30_000} aria-label="Application description" className="min-h-[140px] w-full resize-none bg-transparent px-5 pb-5 pt-4 text-[18px] leading-7 text-[#f4f1e8] outline-none placeholder:text-white/35 md:text-[21px]" />
            <div className="mx-2 flex flex-col gap-2 border-t border-white/[.07] p-2.5 md:flex-row md:items-center">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.035] px-3.5 text-xs text-white/65 transition hover:bg-white/[.07] hover:text-white"><Paperclip className="h-3.5 w-3.5" /> Attach brief</button>
                <input ref={fileRef} onChange={attach} type="file" accept=".txt,.md,.json,.csv,text/plain,text/markdown,application/json,text/csv" className="hidden" />
                <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.035] px-3.5 text-white/50 transition focus-within:border-[#c7ff4a]/30 sm:min-w-[210px] md:max-w-[310px]"><Globe2 className="h-3.5 w-3.5 shrink-0 text-[#c7ff4a]/80" /><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Add a website reference" aria-label="Website reference" className="min-w-0 flex-1 bg-transparent text-xs text-white/80 outline-none placeholder:text-white/40" /></label>
                <AnimatePresence>{attachment && <motion.button initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .9 }} type="button" onClick={() => setAttachment(null)} className="h-10 max-w-[180px] truncate rounded-xl bg-[#c7ff4a]/10 px-3 text-xs text-[#c7ff4a]">{attachment.name} ×</motion.button>}</AnimatePresence>
              </div>
              <motion.button whileTap={{ scale: .97 }} disabled={!hasPrompt} className="group/button relative inline-flex h-11 shrink-0 items-center justify-center gap-3 overflow-hidden rounded-xl bg-[#c7ff4a] px-5 text-[13px] font-semibold text-[#071019] shadow-[0_8px_30px_rgba(199,255,74,.25)] transition hover:bg-[#d5ff72] hover:shadow-[0_10px_40px_rgba(199,255,74,.4)] disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none">Build this app <ArrowRight className="h-4 w-4 transition-transform group-hover/button:translate-x-0.5" /></motion.button>
            </div>
          </div>
          <AnimatePresence>{error && <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} role="alert" className="px-4 py-3 text-xs text-red-300">{error}</motion.p>}</AnimatePresence>
        </motion.form>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: .8 }}>
          <PromptGuide getValue={() => promptRef.current} onChange={(text) => { setPrompt(text); setError(""); composerRef.current?.focus(); }} />
        </motion.div>

        <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: 1 }} className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[12px] text-white/50">
          {[[Code2, "Real, editable source"], [ShieldCheck, "Isolated sandbox previews"], [Lock, "Export anytime, no lock-in"]].map(([Icon, label]) => { const ItemIcon = Icon as typeof Code2; return <li key={String(label)} className="flex items-center gap-2"><ItemIcon className="h-3.5 w-3.5 text-[#c7ff4a]/80" />{String(label)}</li>; })}
        </motion.ul>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: 1.1 }} className="mt-6 flex justify-center"><MadeInOdisha /></motion.div>
      </section>
    </div>

    <div aria-hidden className="relative border-y border-white/[.06] bg-[#080d15] py-5 [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
      <div className="nynz-marquee flex w-max gap-3">{[...marquee, ...marquee].map((item, index) => <span key={index} className="flex items-center gap-3 whitespace-nowrap rounded-full border border-white/[.07] bg-white/[.02] px-4 py-2 text-[13px] text-white/55"><Box className="h-3.5 w-3.5 text-[#c7ff4a]/70" />{item}</span>)}</div>
    </div>

    <BuilderShowcase />
    <LiveBuild />

    <section className="px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-[1240px]">
        <Reveal><p className="text-[11px] font-medium uppercase tracking-[.22em] text-[#c7ff4a]">Everything you need</p><h2 className="mt-3 max-w-2xl text-4xl font-medium tracking-[-.055em] md:text-6xl">Built for shipping, not just demos.</h2></Reveal>
        <div className="mt-12 grid grid-cols-1 gap-3 md:grid-cols-3">{features.map(({ icon: Icon, title, text, wide }, index) => <Reveal key={title} delay={index * .06} className={wide ? "md:col-span-2" : ""}>
          <article className="nynz-edge group relative h-full min-h-[210px] overflow-hidden rounded-[22px] border border-white/[.08] bg-[#0b121b] p-7 transition duration-300 hover:-translate-y-1 hover:bg-[#0d1520]">
            <div aria-hidden className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[#c7ff4a]/[.0] blur-3xl transition duration-500 group-hover:bg-[#c7ff4a]/[.08]" />
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/[.08] bg-white/[.04] text-[#c7ff4a] transition duration-300 group-hover:scale-110 group-hover:bg-[#c7ff4a] group-hover:text-[#071019]"><Icon className="h-5 w-5" /></span>
            <h3 className="mt-10 text-xl font-medium tracking-[-.03em]">{title}</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/55">{text}</p>
          </article>
        </Reveal>)}</div>
      </div>
    </section>

    <section id="how" className="bg-[#f0ede4] px-5 py-24 text-[#0b121b] md:px-8 md:py-32"><div className="mx-auto max-w-[1240px]"><div className="grid grid-cols-1 gap-12 lg:grid-cols-[.8fr_1.2fr]"><Reveal><p className="text-[11px] font-semibold uppercase tracking-[.22em] text-[#597800]">From brief to browser</p><h2 className="mt-4 max-w-lg text-5xl font-medium leading-[.98] tracking-[-.065em] md:text-7xl">A build process you can trust.</h2><p className="mt-6 max-w-sm text-base leading-7 text-[#0b121b]/60">No black box. Every stage is visible, every file is yours, and every version can be restored.</p></Reveal><div className="grid gap-px overflow-hidden rounded-[22px] border border-[#0b121b]/10 bg-[#0b121b]/10 sm:grid-cols-2">{[[MessageSquareText,"01","Describe","Start with a plain-language brief, text attachment or public website reference."],[Layers3,"02","Plan","See the intended structure and build stages before the result is complete."],[Play,"03","Preview","Open and interact with the working application in a secure live preview."],[Code2,"04","Own","Inspect files, request focused edits, save versions and export the source."]].map(([Icon,n,title,text], index) => { const ItemIcon = Icon as typeof MessageSquareText; return <Reveal key={String(n)} delay={index * .08}><article className="group h-full min-h-[250px] bg-[#f7f4ec] p-6 transition-colors duration-300 hover:bg-white md:p-8"><div className="flex items-center justify-between"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#0b121b] text-[#c7ff4a] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"><ItemIcon className="h-4 w-4" /></span><span className="font-mono text-[11px] text-[#0b121b]/40">{String(n)}</span></div><h3 className="mt-16 text-2xl font-medium tracking-[-.04em]">{String(title)}</h3><p className="mt-3 text-sm leading-6 text-[#0b121b]/60">{String(text)}</p></article></Reveal>; })}</div></div></div></section>

    <section id="faq" className="px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-12 lg:grid-cols-[.8fr_1.2fr]">
        <Reveal><p className="text-[11px] font-medium uppercase tracking-[.22em] text-[#c7ff4a]">FAQ</p><h2 className="mt-3 text-4xl font-medium tracking-[-.055em] md:text-5xl">Questions, answered.</h2></Reveal>
        <div className="divide-y divide-white/[.08] border-y border-white/[.08]">{faqs.map(([question, answer], index) => <Reveal key={question} delay={index * .05}><Faq question={question} answer={answer} /></Reveal>)}</div>
      </div>
    </section>

    <section className="px-5 pb-24 md:px-8">
      <Reveal className="mx-auto max-w-[1240px]">
        <div className="relative overflow-hidden rounded-[32px] border border-white/[.1] bg-[#0b121b] px-6 py-20 text-center md:py-28">
          <div aria-hidden className="absolute inset-0 nynz-dots opacity-60" />
          <div aria-hidden className="nynz-breathe absolute left-1/2 top-full h-[420px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#c7ff4a]/20 blur-[120px]" />
          <h2 className="relative mx-auto max-w-3xl text-5xl font-medium leading-[.98] tracking-[-.065em] md:text-7xl">Stop describing it. <span className="nynz-text-shine">Start using it.</span></h2>
          <p className="relative mx-auto mt-6 max-w-lg text-base leading-7 text-white/60">Your first app is one sentence away.</p>
          <div className="relative mt-10 flex flex-wrap justify-center gap-3"><button onClick={() => { composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); composerRef.current?.focus(); }} className="group inline-flex h-12 items-center gap-3 rounded-full bg-[#c7ff4a] px-6 text-[14px] font-semibold text-[#071019] shadow-[0_10px_40px_rgba(199,255,74,.35)] transition hover:bg-[#d5ff72]">Build your app <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></button><Link href="/login" className="inline-flex h-12 items-center rounded-full border border-white/[.14] px-6 text-[14px] text-white/80 transition hover:bg-white/[.06]">Sign in</Link></div>
        </div>
      </Reveal>
    </section>

    <footer className="px-5 pb-10 md:px-8"><div className="mx-auto flex max-w-[1240px] flex-col gap-5 border-t border-white/[.08] pt-8 sm:flex-row sm:items-center sm:justify-between"><NynzBrand className="h-6" /><p className="text-xs text-white/45">Real source. Isolated previews. Your project. <VersionTag className="ml-2" /></p><Link href="/login" className="group inline-flex items-center gap-2 text-xs text-[#c7ff4a]">Start building <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></Link></div><InformationLinks className="mx-auto mt-7 max-w-[1240px]"/></footer>
  </main>;
}

function BuilderShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [18, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [.9, 1]);
  const opacity = useTransform(scrollYProgress, [0, .5], [.3, 1]);
  const reduce = useReducedMotion();
  return <section id="product" className="relative px-5 py-24 md:px-8 md:py-32">
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/3 h-[500px] w-[1000px] -translate-x-1/2 rounded-full bg-[#294662]/20 blur-[160px]" />
    <div className="relative mx-auto max-w-[1240px]">
      <Reveal className="mb-12 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="text-[11px] font-medium uppercase tracking-[.22em] text-[#c7ff4a]">The builder</p><h2 className="mt-3 max-w-2xl text-4xl font-medium tracking-[-.055em] md:text-6xl">See the work. Shape the result.</h2></div><p className="max-w-sm text-sm leading-6 text-white/55">A preview-first workspace with the conversation, build state and source always within reach. Try the example below: ask for three real changes and watch the working app update, then jump back to any version.</p></Reveal>
      <div ref={ref} style={{ perspective: 1400 }}>
        <motion.div style={reduce ? undefined : { rotateX, scale, opacity, transformOrigin: "center top" }} className="overflow-hidden rounded-[20px] border border-white/[.12] bg-[#0d0e11] shadow-[0_60px_160px_rgba(0,0,0,.6),0_0_0_1px_rgba(199,255,74,.04)]">
          <div className="flex h-10 items-center gap-1.5 border-b border-white/[.08] bg-[#0a0f17] px-4"><i className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" /><i className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" /><i className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" /><span className="mx-auto flex items-center gap-2 rounded-md bg-white/[.04] px-4 py-1 text-[10px] text-white/45"><Lock className="h-2.5 w-2.5" /> Interactive example</span></div>
          <BuilderMock />
        </motion.div>
      </div>
    </div>
  </section>;
}

type DemoClass = { id: string; time: string; name: string; teacher: string; level: string; spots: number; capacity: number };
const DEMO_DAYS: Array<{ day: string; date: string; classes: DemoClass[] }> = [
  { day: "Mon", date: "10", classes: [{ id: "m1", time: "07:00", name: "Sunrise Vinyasa", teacher: "Meera", level: "All levels", spots: 3, capacity: 14 }, { id: "m2", time: "12:30", name: "Lunchtime Stretch", teacher: "Arjun", level: "Gentle", spots: 0, capacity: 10 }, { id: "m3", time: "18:30", name: "Power Flow", teacher: "Sana", level: "Intermediate", spots: 6, capacity: 16 }] },
  { day: "Tue", date: "11", classes: [{ id: "t1", time: "08:00", name: "Hatha Basics", teacher: "Arjun", level: "Beginner", spots: 8, capacity: 12 }, { id: "t2", time: "19:00", name: "Yin & Breath", teacher: "Meera", level: "Gentle", spots: 0, capacity: 12 }] },
  { day: "Wed", date: "12", classes: [{ id: "w1", time: "07:00", name: "Sunrise Vinyasa", teacher: "Sana", level: "All levels", spots: 1, capacity: 14 }, { id: "w2", time: "17:30", name: "Core & Balance", teacher: "Kabir", level: "Intermediate", spots: 5, capacity: 12 }, { id: "w3", time: "20:00", name: "Restorative", teacher: "Meera", level: "Gentle", spots: 2, capacity: 10 }] },
];
const DEMO_BRIEF = "Build a class booking app for a small yoga studio called Stillwater. Members browse a weekly timetable, see spots left, and book or cancel a class. Calm, airy design with soft greens.";
const DEMO_STEPS = [
  { label: "v1", name: "Built", ask: null, reply: "Your Stillwater booking app is ready: a weekly timetable with live spots and one-tap booking. Try booking a class." },
  { label: "v2", name: "Waitlist", ask: "Add a waitlist when a class is full", reply: "Done. Full classes now show Join waitlist with your place in line. 2 files changed." },
  { label: "v3", name: "My bookings", ask: "Show my bookings with a cancel button", reply: "Added a My bookings panel that updates as you book, with Cancel on each class. 3 files changed." },
  { label: "v4", name: "Evening theme", ask: "Switch to a calm evening theme", reply: "Switched to a dark evening palette across every screen. 1 file changed." },
] as const;

/**
 * Interactive example of building with NYNZ: each chat request visibly changes
 * a working app (v1 to v4), and earlier versions can be reopened. Static,
 * fictional and self-contained: no network requests, accounts or tokens.
 */
function BuilderMock() {
  const [version, setVersion] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);
  const [booked, setBooked] = useState<Record<string, boolean>>({ m3: true });
  const [waitlist, setWaitlist] = useState<Record<string, number>>({});
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const hasWaitlist = version >= 1, hasBookings = version >= 2, evening = version >= 3;
  const isNew = (step: number) => version === step;
  const day = DEMO_DAYS[dayIndex];
  const allClasses = DEMO_DAYS.flatMap((d) => d.classes.map((c) => ({ ...c, day: d.day })));
  const mine = allClasses.filter((c) => booked[c.id]);
  const theme = evening
    ? { page: "#0f141c", panel: "#161e2a", head: "#0b1018", ink: "#e8eef2", sub: "rgba(232,238,242,.55)", line: "rgba(255,255,255,.07)", accent: "#9fd8a7", accentInk: "#0b1410", chip: "#1f2a38" }
    : { page: "#f4f7f2", panel: "#ffffff", head: "#1f3d2f", ink: "#16241c", sub: "rgba(22,36,28,.55)", line: "rgba(0,0,0,.06)", accent: "#1f3d2f", accentInk: "#ffffff", chip: "#dcefe2" };
  const next = DEMO_STEPS[version + 1];
  const newTag = <span className="nynz-pop-in ml-1.5 rounded-full bg-[#c7ff4a] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#071019]">New</span>;
  return <div className="bg-[#080c13] text-left">
    <div className="flex flex-wrap items-center gap-2 border-b border-white/[.07] px-3 py-2.5 sm:px-4">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#c7ff4a]/15 text-[#c7ff4a]"><Box className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 truncate text-[13px] font-medium">Stillwater booking</span>
      <span className="rounded-full border border-[#c7ff4a]/30 bg-[#c7ff4a]/10 px-2.5 py-1 text-[10px] font-medium text-[#c7ff4a]">Interactive example</span>
      <div role="group" aria-label="Preview size" className="ml-auto flex rounded-lg border border-white/[.08] p-0.5 text-[11px]">{(["desktop", "phone"] as const).map((d) => <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 ${device === d ? "bg-white/[.1] text-white" : "text-white/50 hover:text-white"}`}>{d === "desktop" ? <Globe2 className="h-3 w-3" /> : <Smartphone className="h-3 w-3" />}{d === "desktop" ? "Desktop" : "Phone"}</button>)}</div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr]">
      <aside className="flex flex-col gap-2.5 border-b border-white/[.07] bg-[#0a0f17] p-4 md:border-b-0 md:border-r">
        <div role="group" aria-label="Versions" className="flex flex-wrap gap-1.5">{DEMO_STEPS.map((step, index) => <button key={step.label} type="button" disabled={index > version} onClick={() => setVersion(index)} aria-pressed={index === version} title={index > version ? "Ask for this change first" : `Open ${step.label}`} className={`rounded-full border px-2.5 py-1 text-[10px] transition ${index === version ? "border-[#c7ff4a]/50 bg-[#c7ff4a]/15 text-[#c7ff4a]" : index < version ? "border-white/15 text-white/70 hover:bg-white/[.06]" : "border-white/[.06] text-white/25"}`}>{step.label} · {step.name}</button>)}</div>
        <p className="rounded-2xl rounded-tr-md bg-white/[.07] px-3.5 py-2.5 text-[12px] leading-5 text-white/85">{DEMO_BRIEF}</p>
        {DEMO_STEPS.slice(1, version + 1).map((step) => <p key={step.label} className="nynz-pop-in ml-6 rounded-2xl rounded-tr-md bg-white/[.07] px-3.5 py-2 text-[12px] leading-5 text-white/85">{step.ask}</p>)}
        <p key={version} className="nynz-pop-in rounded-2xl rounded-tl-md border border-[#c7ff4a]/20 bg-[#c7ff4a]/[.06] px-3.5 py-2.5 text-[12px] leading-5 text-white/80"><span className="mr-1.5 font-semibold text-[#c7ff4a]">NYNZ</span>{DEMO_STEPS[version].reply}</p>
        {next ? <button type="button" onClick={() => setVersion(version + 1)} className="nynz-lift group mt-1 flex items-center gap-2 rounded-xl border border-[#c7ff4a]/30 bg-[#c7ff4a]/[.08] px-3 py-2.5 text-left text-[12px] text-white hover:bg-[#c7ff4a]/[.14]"><span className="min-w-0 flex-1"><span className="block text-[10px] uppercase tracking-[.14em] text-[#c7ff4a]/80">Tap to ask NYNZ</span>{next.ask}</span><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#c7ff4a] text-[#071019] transition-transform group-hover:translate-x-0.5"><ArrowRight className="h-3.5 w-3.5" /></span></button>
          : <button type="button" onClick={() => setVersion(0)} className="mt-1 rounded-xl border border-white/10 px-3 py-2 text-[12px] text-white/70 hover:bg-white/[.05]">Start again from v1</button>}
      </aside>
      <div className="min-w-0 bg-[#0d1117] p-3 sm:p-5">
        <div className={`mx-auto overflow-hidden border shadow-[0_20px_60px_rgba(0,0,0,.35)] transition-[max-width,background-color,color] duration-500 ${device === "phone" ? "max-w-[340px] rounded-[26px]" : "max-w-none rounded-xl"}`} style={{ background: theme.page, color: theme.ink, borderColor: theme.line }}>
          <div className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-500 ${isNew(3) ? "nynz-pop-in" : ""}`} style={{ background: theme.head, color: "#fff" }}>
            <div><p className="text-[10px] uppercase tracking-[.2em]" style={{ color: evening ? theme.accent : "#bfe3c9" }}>Stillwater{isNew(3) && newTag}</p><p className="text-[15px] font-semibold">{evening ? "Evening classes" : "This week's classes"}</p></div>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px]" aria-live="polite"><span key={mine.length} className="nynz-bump">{mine.length}</span> booked</span>
          </div>
          <div className={`grid ${hasBookings && device === "desktop" ? "md:grid-cols-[1fr_200px]" : ""}`}>
            <div>
              <div role="tablist" aria-label="Day" className="flex gap-1.5 px-3 py-2.5" style={{ background: theme.panel, borderBottom: `1px solid ${theme.line}` }}>{DEMO_DAYS.map((d, index) => <button key={d.day} role="tab" type="button" aria-selected={index === dayIndex} onClick={() => setDayIndex(index)} className="flex min-w-[52px] flex-col items-center rounded-xl px-3 py-1.5 text-[11px] transition-colors" style={index === dayIndex ? { background: theme.accent, color: theme.accentInk } : { color: theme.sub }}><span>{d.day}</span><span className="text-[15px] font-semibold">{d.date}</span></button>)}</div>
              <ul key={dayIndex}>{day.classes.map((c, rowIndex) => {
                const isBooked = Boolean(booked[c.id]);
                const full = c.spots === 0;
                const place = waitlist[c.id];
                return <li key={c.id} style={{ animationDelay: `${rowIndex * 60}ms`, borderBottom: `1px solid ${theme.line}` }} className={`nynz-pop-in flex items-center gap-3 px-4 py-3 ${device === "phone" ? "flex-wrap" : ""}`}>
                  <span className="w-12 shrink-0 font-mono text-[12px]" style={{ color: theme.sub }}>{c.time}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{c.name}</span><span className="block text-[11px]" style={{ color: theme.sub }}>{c.teacher} · {c.level}</span></span>
                  <span className="text-[11px]" style={{ color: full ? "#d0703f" : theme.sub }}>{full ? (hasWaitlist && place ? `Waitlist #${place}` : "Full") : `${c.spots - (isBooked ? 1 : 0)} of ${c.capacity} left`}</span>
                  {full ? (hasWaitlist ? <span className={`relative ${isNew(1) ? "nynz-highlight" : ""}`}><button type="button" onClick={() => setWaitlist((w) => ({ ...w, [c.id]: w[c.id] ? 0 : 3 }))} className="rounded-lg border px-3 py-1.5 text-[12px] font-medium" style={place ? { background: "#d0703f22", color: "#d0703f", borderColor: "transparent" } : { color: "#d0703f", borderColor: "#d0703f66" }}>{place ? "Leave waitlist" : "Join waitlist"}</button>{isNew(1) && newTag}</span> : <span className="rounded-lg px-3 py-1.5 text-[12px]" style={{ background: theme.line, color: theme.sub }}>Full</span>)
                    : <button type="button" onClick={() => setBooked((b) => ({ ...b, [c.id]: !b[c.id] }))} className="rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors" style={isBooked ? { background: theme.chip, color: evening ? theme.ink : theme.accent } : { background: theme.accent, color: theme.accentInk }}>{isBooked ? "Booked ✓" : "Book"}</button>}
                </li>;
              })}</ul>
            </div>
            {hasBookings && <aside className={`p-4 ${isNew(2) ? "nynz-pop-in nynz-highlight" : ""}`} style={{ background: theme.panel, borderLeft: device === "desktop" ? `1px solid ${theme.line}` : undefined, borderTop: device === "phone" ? `1px solid ${theme.line}` : undefined }}>
              <p className="text-[12px] font-semibold">My bookings{isNew(2) && newTag}</p>
              {mine.length ? <ul className="mt-2 space-y-2">{mine.map((c) => <li key={c.id} className="nynz-pop-in flex items-center gap-2 rounded-lg p-2 text-[11px]" style={{ background: theme.page }}><span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.name}</span><span style={{ color: theme.sub }}>{c.day} · {c.time}</span></span><button type="button" onClick={() => setBooked((b) => ({ ...b, [c.id]: false }))} className="rounded-md px-2 py-1 text-[10px]" style={{ color: "#d0703f" }}>Cancel</button></li>)}</ul>
                : <p className="mt-2 text-[11px]" style={{ color: theme.sub }}>No bookings yet. Book a class to see it here.</p>}
            </aside>}
          </div>
          <p className="px-4 pb-3 pt-2 text-[10px]" style={{ color: theme.sub }}>Fictional studio and demonstration data.</p>
        </div>
      </div>
    </div>
  </div>;
}

/** Self-running demo that loops through the real build stages. */
function LiveBuild() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .3 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (reduce) { setStep(buildStages.length - 1); return; }
    if (!visible) return;
    const timer = setTimeout(() => setStep((value) => (value + 1) % (buildStages.length + 2)), step >= buildStages.length - 1 ? 2600 : 1300);
    return () => clearTimeout(timer);
  }, [step, visible, reduce]);
  const stage = Math.min(step, buildStages.length - 1);
  const live = step >= buildStages.length - 1;
  return <section className="border-y border-white/[.06] bg-[#080d15] px-5 py-24 md:px-8 md:py-32">
    <div ref={ref} className="mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-14 lg:grid-cols-[.9fr_1.1fr]">
      <Reveal>
        <p className="text-[11px] font-medium uppercase tracking-[.22em] text-[#c7ff4a]">Watch it happen <span className="ml-2 rounded-full border border-white/15 px-2 py-0.5 text-[9px] tracking-[.14em] text-white/55">Illustration</span></p>
        <h2 className="mt-3 text-4xl font-medium tracking-[-.055em] md:text-6xl">From sentence to live app in one flow.</h2>
        <p className="mt-6 max-w-md text-base leading-7 text-white/55">NYNZ plans the structure, writes every file, installs dependencies, runs a production build and serves the result. You see each step as it happens.</p>
        <div className="mt-8 grid max-w-md grid-cols-3 gap-3">{[["6 stages", "Visible as they run"], ["100%", "Source you own"], ["1 click", "Export or restore"]].map(([value, label]) => <div key={label} className="rounded-2xl border border-white/[.08] bg-white/[.02] p-4"><p className="text-xl font-medium tracking-[-.03em] text-[#c7ff4a]">{value}</p><p className="mt-1 text-[11px] leading-4 text-white/50">{label}</p></div>)}</div>
      </Reveal>
      <Reveal delay={.1}>
        <div className="nynz-edge relative overflow-hidden rounded-[24px] bg-[#0b121b] p-2 shadow-[0_40px_120px_rgba(0,0,0,.5)]">
          <div className="rounded-[18px] border border-white/[.06] bg-[#0a0f17] p-5">
            <div className="flex items-center justify-between"><p className="flex items-center gap-2 text-[12px] font-medium"><Zap className="h-3.5 w-3.5 text-[#c7ff4a]" /> Fieldnote inventory</p><span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] transition-colors ${live ? "bg-[#c7ff4a]/15 text-[#c7ff4a]" : "bg-white/[.06] text-white/60"}`}>{live ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#c7ff4a]" />}{live ? "Live" : buildStages[stage].label}</span></div>
            <div className="mt-5 overflow-x-auto pb-1"><BuildPipeline status={live ? "ready" : buildStages[stage].id} compact /></div>
            <div className="mt-5 h-[148px] overflow-hidden rounded-xl border border-white/[.06] bg-[#070a10] p-3 font-mono text-[11px] leading-6">
              {demoLogs.slice(0, Math.min(step + 1, demoLogs.length)).map((line, index) => <motion.div key={line} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3"><span className="text-white/30">00:0{index * 2}</span><span className="text-[#c7ff4a]/70">›</span><span className={index === demoLogs.length - 1 ? "text-[#c7ff4a]" : "text-white/70"}>{line}</span></motion.div>)}
            </div>
            <div className="relative mt-3 h-[150px] overflow-hidden rounded-xl bg-[#f1eee5] p-4 text-[#101820]">
              <AnimatePresence mode="wait">{live ? <motion.div key="app" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .5, ease }}>
                <div className="flex items-center justify-between"><p className="text-lg font-medium tracking-[-.04em]">Inventory, at a glance.</p><span className="rounded-md bg-[#101820] px-2 py-1 text-[9px] text-white">+ Add item</span></div>
                <div className="mt-3 grid grid-cols-3 gap-2">{[["In stock", "248"], ["Low stock", "12"], ["Value", "₹1.8L"]].map(([label, value], index) => <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .15 + index * .08 }} className={`rounded-lg p-2.5 ${index === 1 ? "bg-[#dfff8a]" : "bg-white"}`}><p className="text-[9px] text-[#101820]/45">{label}</p><p className="mt-2 text-base font-medium">{value}</p></motion.div>)}</div>
              </motion.div> : <motion.div key="wire" exit={{ opacity: 0 }} className="space-y-2.5"><div className="h-4 w-1/2 animate-pulse rounded bg-[#101820]/10" /><div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-[#101820]/[.07]" />)}</div><div className="h-3 w-3/4 animate-pulse rounded bg-[#101820]/[.07]" /></motion.div>}</AnimatePresence>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  </section>;
}

function Faq({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return <div>
    <button onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center justify-between gap-6 py-6 text-left text-[17px] font-medium tracking-[-.02em] transition hover:text-[#c7ff4a]">{question}<ChevronDown className={`h-4 w-4 shrink-0 text-white/50 transition-transform duration-300 ${open ? "rotate-180 text-[#c7ff4a]" : ""}`} /></button>
    <AnimatePresence initial={false}>{open && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .3, ease }} className="overflow-hidden"><p className="max-w-xl pb-6 text-[15px] leading-7 text-white/60">{answer}</p></motion.div>}</AnimatePresence>
  </div>;
}
