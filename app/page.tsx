"use client";

import Link from "next/link";
import { VersionTag } from "@/components/version-tag";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Box, Check, ChevronDown, Code2, Download, Globe2, History, Layers3, Lock, Paperclip, Play, ShieldCheck, Smartphone, Sparkles, Zap } from "lucide-react";
import { NynzBrand } from "@/components/nynz-brand";
import { BuildPipeline, Reveal, buildStages, ease } from "@/components/nynz-motion";

const examples = [
  { label: "Operations", prompt: "Build a calm operations dashboard for a multi-location design studio" },
  { label: "Commerce", prompt: "Create a visual inventory and order tracker for a ceramics brand" },
  { label: "Community", prompt: "Make a member portal for a neighbourhood sports club" },
  { label: "Product", prompt: "Build a focused launch tracker with owners, dates and status views" },
];
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

function useTypedPlaceholder(lines: string[], enabled: boolean) {
  const [text, setText] = useState("Describe the app you want to build…");
  useEffect(() => {
    if (!enabled) return;
    let line = 0, char = 0, deleting = false, timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const target = lines[line];
      char += deleting ? -1 : 1;
      setText(target.slice(0, char));
      let delay = deleting ? 18 : 42;
      if (!deleting && char === target.length) { deleting = true; delay = 1800; }
      else if (deleting && char === 0) { deleting = false; line = (line + 1) % lines.length; delay = 300; }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 900);
    return () => clearTimeout(timer);
  }, [lines, enabled]);
  return text;
}

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const reduce = useReducedMotion();
  const placeholder = useTypedPlaceholder(examples.map((example) => example.prompt), !reduce && !focused && !prompt);

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

  function pickExample(text: string) {
    setPrompt(text); setError("");
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    composerRef.current?.focus();
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

        <motion.form onSubmit={start} initial={{ opacity: 0, y: 24, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .8, delay: .55, ease }} className="nynz-composer group relative mx-auto mt-11 max-w-[900px] rounded-[26px] border border-white/[.12] bg-[#101824]/95 p-2 text-left shadow-[0_40px_120px_rgba(0,0,0,.55)] backdrop-blur-2xl" style={{ animation: "none" }}>
          <div className="rounded-[20px] border border-white/[.055] bg-[#0b121c]">
            <div className="flex items-center justify-between px-5 pt-4 text-[10px] uppercase tracking-[.18em] text-white/40">
              <span className="flex items-center gap-2"><Sparkles className="h-3 w-3 text-[#c7ff4a]" /> New application</span>
              <span className="hidden sm:inline">Compiled, editable React source</span>
            </div>
            <textarea ref={composerRef} value={prompt} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(event) => { setPrompt(event.target.value); setError(""); }} rows={4} maxLength={30_000} placeholder={focused ? "Describe the app you want to build…" : placeholder} aria-label="Application description" className="min-h-[140px] w-full resize-none bg-transparent px-5 pb-5 pt-4 text-[18px] leading-7 text-[#f4f1e8] outline-none placeholder:text-white/35 md:text-[21px]" />
            <div className="mx-2 flex flex-col gap-2 border-t border-white/[.07] p-2.5 md:flex-row md:items-center">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.035] px-3.5 text-xs text-white/65 transition hover:bg-white/[.07] hover:text-white"><Paperclip className="h-3.5 w-3.5" /> Attach brief</button>
                <input ref={fileRef} onChange={attach} type="file" accept=".txt,.md,.json,.csv,text/plain,text/markdown,application/json,text/csv" className="hidden" />
                <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.035] px-3.5 text-white/50 transition focus-within:border-[#c7ff4a]/30 sm:min-w-[210px] md:max-w-[310px]"><Globe2 className="h-3.5 w-3.5 shrink-0 text-[#c7ff4a]/80" /><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Add a website reference" aria-label="Website reference" className="min-w-0 flex-1 bg-transparent text-xs text-white/80 outline-none placeholder:text-white/40" /></label>
                <AnimatePresence>{attachment && <motion.button initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .9 }} type="button" onClick={() => setAttachment(null)} className="h-10 max-w-[180px] truncate rounded-xl bg-[#c7ff4a]/10 px-3 text-xs text-[#c7ff4a]">{attachment.name} ×</motion.button>}</AnimatePresence>
              </div>
              <motion.button whileTap={{ scale: .97 }} disabled={!prompt.trim()} className="group/button relative inline-flex h-11 shrink-0 items-center justify-center gap-3 overflow-hidden rounded-xl bg-[#c7ff4a] px-5 text-[13px] font-semibold text-[#071019] shadow-[0_8px_30px_rgba(199,255,74,.25)] transition hover:bg-[#d5ff72] hover:shadow-[0_10px_40px_rgba(199,255,74,.4)] disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none">Build this app <ArrowRight className="h-4 w-4 transition-transform group-hover/button:translate-x-0.5" /></motion.button>
            </div>
          </div>
          <AnimatePresence>{error && <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} role="alert" className="px-4 py-3 text-xs text-red-300">{error}</motion.p>}</AnimatePresence>
        </motion.form>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: .8 }} className="mx-auto mt-6 max-w-[900px]">
          <p className="mb-3 text-[10px] font-medium uppercase tracking-[.2em] text-white/35">Or start from an example</p>
          <div className="flex flex-wrap justify-center gap-2">{examples.map((example) => <button key={example.label} type="button" onClick={() => pickExample(example.prompt)} className="group inline-flex max-w-full items-center gap-2 rounded-full border border-white/[.08] bg-white/[.025] py-1.5 pl-1.5 pr-3.5 text-left transition hover:border-[#c7ff4a]/30 hover:bg-[#c7ff4a]/[.05]"><span className="rounded-full bg-white/[.07] px-2 py-0.5 text-[10px] uppercase tracking-[.12em] text-white/55 transition group-hover:bg-[#c7ff4a] group-hover:text-[#071019]">{example.label}</span><span className="truncate text-[12px] text-white/60 group-hover:text-white">{example.prompt.replace(/^(Build|Create|Make) (a|an) /, "")}</span></button>)}</div>
        </motion.div>

        <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, delay: 1 }} className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[12px] text-white/50">
          {[[Code2, "Real, editable source"], [ShieldCheck, "Isolated sandbox previews"], [Lock, "Export anytime, no lock-in"]].map(([Icon, label]) => { const ItemIcon = Icon as typeof Code2; return <li key={String(label)} className="flex items-center gap-2"><ItemIcon className="h-3.5 w-3.5 text-[#c7ff4a]/80" />{String(label)}</li>; })}
        </motion.ul>
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
        <div className="mt-12 grid gap-3 md:grid-cols-3">{features.map(({ icon: Icon, title, text, wide }, index) => <Reveal key={title} delay={index * .06} className={wide ? "md:col-span-2" : ""}>
          <article className="nynz-edge group relative h-full min-h-[210px] overflow-hidden rounded-[22px] border border-white/[.08] bg-[#0b121b] p-7 transition duration-300 hover:-translate-y-1 hover:bg-[#0d1520]">
            <div aria-hidden className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[#c7ff4a]/[.0] blur-3xl transition duration-500 group-hover:bg-[#c7ff4a]/[.08]" />
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/[.08] bg-white/[.04] text-[#c7ff4a] transition duration-300 group-hover:scale-110 group-hover:bg-[#c7ff4a] group-hover:text-[#071019]"><Icon className="h-5 w-5" /></span>
            <h3 className="mt-10 text-xl font-medium tracking-[-.03em]">{title}</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/55">{text}</p>
          </article>
        </Reveal>)}</div>
      </div>
    </section>

    <section id="how" className="bg-[#f0ede4] px-5 py-24 text-[#0b121b] md:px-8 md:py-32"><div className="mx-auto max-w-[1240px]"><div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr]"><Reveal><p className="text-[11px] font-semibold uppercase tracking-[.22em] text-[#597800]">From brief to browser</p><h2 className="mt-4 max-w-lg text-5xl font-medium leading-[.98] tracking-[-.065em] md:text-7xl">A build process you can trust.</h2><p className="mt-6 max-w-sm text-base leading-7 text-[#0b121b]/60">No black box. Every stage is visible, every file is yours, and every version can be restored.</p></Reveal><div className="grid gap-px overflow-hidden rounded-[22px] border border-[#0b121b]/10 bg-[#0b121b]/10 sm:grid-cols-2">{[[Sparkles,"01","Describe","Start with a plain-language brief, text attachment or public website reference."],[Layers3,"02","Plan","See the intended structure and build stages before the result is complete."],[Play,"03","Preview","Open and interact with the working application in a secure live preview."],[Code2,"04","Own","Inspect files, request focused edits, save versions and export the source."]].map(([Icon,n,title,text], index) => { const ItemIcon = Icon as typeof Sparkles; return <Reveal key={String(n)} delay={index * .08}><article className="group h-full min-h-[250px] bg-[#f7f4ec] p-6 transition-colors duration-300 hover:bg-white md:p-8"><div className="flex items-center justify-between"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#0b121b] text-[#c7ff4a] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"><ItemIcon className="h-4 w-4" /></span><span className="font-mono text-[11px] text-[#0b121b]/40">{String(n)}</span></div><h3 className="mt-16 text-2xl font-medium tracking-[-.04em]">{String(title)}</h3><p className="mt-3 text-sm leading-6 text-[#0b121b]/60">{String(text)}</p></article></Reveal>; })}</div></div></div></section>

    <section id="faq" className="px-5 py-24 md:px-8 md:py-32">
      <div className="mx-auto grid max-w-[1100px] gap-12 lg:grid-cols-[.8fr_1.2fr]">
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

    <footer className="px-5 pb-10 md:px-8"><div className="mx-auto flex max-w-[1240px] flex-col gap-5 border-t border-white/[.08] pt-8 sm:flex-row sm:items-center sm:justify-between"><NynzBrand className="h-6" /><p className="text-xs text-white/45">Real source. Isolated previews. Your project. <VersionTag className="ml-2" /></p><Link href="/login" className="group inline-flex items-center gap-2 text-xs text-[#c7ff4a]">Start building <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></Link></div></footer>
  </main>;
}

function BuilderShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [18, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [.9, 1]);
  const opacity = useTransform(scrollYProgress, [0, .5], [.3, 1]);
  return <section id="product" className="relative px-5 py-24 md:px-8 md:py-32">
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/3 h-[500px] w-[1000px] -translate-x-1/2 rounded-full bg-[#294662]/20 blur-[160px]" />
    <div className="relative mx-auto max-w-[1240px]">
      <Reveal className="mb-12 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="text-[11px] font-medium uppercase tracking-[.22em] text-[#c7ff4a]">The builder</p><h2 className="mt-3 max-w-2xl text-4xl font-medium tracking-[-.055em] md:text-6xl">See the work. Shape the result.</h2></div><p className="max-w-sm text-sm leading-6 text-white/55">A preview-first workspace with the conversation, build state and source always within reach.</p></Reveal>
      <div ref={ref} style={{ perspective: 1400 }}>
        <motion.div style={{ rotateX, scale, opacity, transformOrigin: "center top" }} className="overflow-hidden rounded-[20px] border border-white/[.12] bg-[#0d0e11] shadow-[0_60px_160px_rgba(0,0,0,.6),0_0_0_1px_rgba(199,255,74,.04)]">
          <div className="flex h-10 items-center gap-1.5 border-b border-white/[.08] bg-[#0a0f17] px-4"><i className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" /><i className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" /><i className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" /><span className="mx-auto flex items-center gap-2 rounded-md bg-white/[.04] px-4 py-1 text-[10px] text-white/45"><Lock className="h-2.5 w-2.5" /> nynz.in/projects/fieldnote</span></div>
          <BuilderMock />
        </motion.div>
      </div>
    </div>
  </section>;
}

const mockPlan = ["Set the visual system", "Build inventory overview", "Add low-stock alerts", "Validate the production build"];
const mockItems = [["Speckled mugs", 42, 80], ["Celadon glaze", 4, 12], ["Stoneware bowls", 26, 55], ["Kiln shelves", 2, 9], ["Bisque plates", 31, 64]] as const;

/** Scripted, self-contained replica of the builder used on the homepage (no live routes). */
function BuilderMock() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const last = buildStages.length - 1;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setStep((value) => (value + 1) % (last + 3)), step >= last ? 3200 : 1200);
    return () => clearTimeout(timer);
  }, [step, visible, last]);
  const stage = Math.min(step, last);
  const live = stage === last;
  const status = live ? "succeeded" : buildStages[stage].id;
  return <div ref={ref} className="bg-[#080c13] text-left">
    <div className="flex h-12 items-center gap-3 border-b border-white/[.07] px-3 sm:px-4">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#c7ff4a]/15 text-[#c7ff4a]"><Box className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 truncate text-[13px] font-medium">Fieldnote inventory</span>
      <div className="ml-auto hidden sm:block"><BuildPipeline status={status} compact /></div>
      <span className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] sm:ml-0 ${live ? "border-[#c7ff4a]/30 bg-[#c7ff4a]/10 text-[#c7ff4a]" : "border-white/[.1] text-white/60"}`}><i className={`h-1.5 w-1.5 rounded-full ${live ? "bg-[#c7ff4a]" : "animate-pulse bg-[#f5c451]"}`} />{live ? "Live" : buildStages[stage].label}</span>
    </div>
    <div className="grid md:h-[540px] md:grid-cols-[320px_1fr]">
      <aside className="hidden flex-col border-r border-white/[.07] bg-[#0a0f17] p-4 md:flex">
        <div className="ml-auto max-w-[90%] rounded-2xl rounded-tr-md bg-white/[.07] px-3.5 py-2.5 text-[12px] leading-5 text-white/85">Build a calm inventory dashboard for a ceramics studio, with low-stock alerts and a quick add flow.</div>
        <AnimatePresence>{step >= 1 && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .4, ease }} className="mt-4 rounded-2xl border border-white/[.07] bg-white/[.025] p-3.5">
          <p className="flex items-center gap-2 text-[11px] font-medium text-[#c7ff4a]"><Sparkles className="h-3.5 w-3.5" /> Plan</p>
          <p className="mt-2 text-[12px] leading-5 text-white/60">A focused stock dashboard with quick item entry.</p>
          <ul className="mt-3 space-y-2">{mockPlan.map((item, index) => { const done = live || stage > index + 1; const now = !live && stage === index + 1; return <li key={item} className="flex items-center gap-2.5 text-[11.5px]"><span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors duration-500 ${done ? "border-[#c7ff4a]/40 bg-[#c7ff4a]/15 text-[#c7ff4a]" : now ? "border-[#c7ff4a]/60" : "border-white/[.12]"}`}>{done ? <Check className="h-2.5 w-2.5" /> : now ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#c7ff4a]" /> : null}</span><span className={done ? "text-white/70" : now ? "text-white" : "text-white/35"}>{item}</span></li>; })}</ul>
        </motion.div>}</AnimatePresence>
        <AnimatePresence>{live && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .4, ease }} className="mt-3 rounded-2xl border border-[#c7ff4a]/20 bg-[#c7ff4a]/[.06] px-3.5 py-2.5 text-[12px] leading-5 text-white/80">Your app is live. Try adding an item, or ask me for a reorder button.</motion.div>}</AnimatePresence>
        <div className="mt-auto flex items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.03] px-3 py-2.5 text-[11.5px] text-white/35">Ask for a change…<span className="ml-auto grid h-6 w-6 place-items-center rounded-lg bg-[#c7ff4a] text-[#071019]"><ArrowRight className="h-3 w-3" /></span></div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <div className="flex h-10 items-center gap-1 border-b border-white/[.07] px-3 text-[11px]">{[["Preview", Play], ["Code", Code2], ["History", History]].map(([label, Icon], index) => { const I = Icon as typeof Play; return <span key={label as string} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 ${index === 0 ? "bg-white/[.07] text-white" : "text-white/40"}`}><I className="h-3 w-3" />{label as string}</span>; })}<span className="ml-auto hidden items-center gap-1 text-white/35 sm:flex"><Globe2 className="h-3.5 w-3.5" /><Smartphone className="h-3.5 w-3.5" /></span></div>
        <div className="relative flex-1 overflow-hidden bg-[#0d1117] p-3 sm:p-5">
          <div className="h-full rounded-xl border border-white/[.07] bg-[#f6f3ec] p-4 text-[#1c1f24] sm:p-5">
            <div className="flex items-center justify-between"><div><p className="text-[10px] font-medium uppercase tracking-[.16em] text-[#8a7f6e]">Fieldnote</p><p className="mt-1 text-lg font-semibold tracking-[-.03em] sm:text-xl">Studio stock</p></div><span className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors duration-500 ${live ? "bg-[#1c1f24] text-white" : "bg-black/[.06] text-transparent"}`}>+ Add item</span></div>
            <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">{[["Items", "248"], ["Low stock", "6"], ["Orders", "14"]].map(([label, value], index) => <div key={label} className="rounded-lg border border-black/[.06] bg-white p-2.5 sm:p-3"><p className="text-[10px] text-[#8a7f6e]">{label}</p>{live ? <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .08, duration: .4, ease }} className={`mt-1 text-base font-semibold sm:text-xl ${index === 1 ? "text-[#c2410c]" : ""}`}>{value}</motion.p> : <span className="mt-2 block h-4 w-10 animate-pulse rounded bg-black/[.07]" />}</div>)}</div>
            <div className="mt-4 overflow-hidden rounded-lg border border-black/[.06] bg-white">{mockItems.map(([name, qty, max], index) => { const low = qty < 5; return <div key={name} className="flex items-center gap-3 border-b border-black/[.05] px-3 py-2.5 last:border-0">{live ? <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .15 + index * .07, duration: .4, ease }} className="flex min-w-0 flex-1 items-center gap-3"><span className="min-w-0 flex-1 truncate text-[12px] font-medium">{name}</span>{low && <span className="rounded-full bg-[#fee2d5] px-2 py-0.5 text-[9.5px] font-medium text-[#c2410c]">Low</span>}<span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-black/[.06] sm:block"><span className={`block h-full rounded-full ${low ? "bg-[#ea580c]" : "bg-[#1c1f24]"}`} style={{ width: `${(qty / max) * 100}%` }} /></span><span className="w-7 text-right text-[12px] tabular-nums text-[#5b5348]">{qty}</span></motion.div> : <span className="h-3 flex-1 animate-pulse rounded bg-black/[.06]" style={{ maxWidth: `${60 + index * 7}%` }} />}</div>; })}</div>
          </div>
          {!live && <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden"><span className="nynz-scan block h-full w-1/3 bg-gradient-to-r from-transparent via-[#c7ff4a] to-transparent" /></div>}
        </div>
      </div>
    </div>
  </div>;
}

/** Self-running demo that loops through the real build stages. */
function LiveBuild() {
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
    if (!visible) return;
    const timer = setTimeout(() => setStep((value) => (value + 1) % (buildStages.length + 2)), step >= buildStages.length - 1 ? 2600 : 1300);
    return () => clearTimeout(timer);
  }, [step, visible]);
  const stage = Math.min(step, buildStages.length - 1);
  const live = step >= buildStages.length - 1;
  return <section className="border-y border-white/[.06] bg-[#080d15] px-5 py-24 md:px-8 md:py-32">
    <div ref={ref} className="mx-auto grid max-w-[1240px] items-center gap-14 lg:grid-cols-[.9fr_1.1fr]">
      <Reveal>
        <p className="text-[11px] font-medium uppercase tracking-[.22em] text-[#c7ff4a]">Watch it happen</p>
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
