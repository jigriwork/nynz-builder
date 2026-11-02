"use client";

import { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, LoaderCircle, X } from "lucide-react";

export const ease = [0.2, 0.7, 0.2, 1] as const;

export function Reveal({ children, delay = 0, y = 22, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const reduce = useReducedMotion();
  return <motion.div className={className} initial={reduce ? false : { opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: .7, delay, ease }}>{children}</motion.div>;
}

export const buildStages = [
  { id: "queued", label: "Queued" },
  { id: "planning", label: "Planning" },
  { id: "generating", label: "Writing code" },
  { id: "installing", label: "Installing" },
  { id: "validating", label: "Validating" },
  { id: "ready", label: "Live" },
] as const;

export function stageIndex(status?: string) {
  if (!status) return -1;
  if (status === "running") return 4;
  if (status === "succeeded") return buildStages.length - 1;
  return buildStages.findIndex((stage) => stage.id === status);
}

export function buildPercent(status?: string) {
  if (status === "succeeded" || status === "ready") return 100;
  return ({ queued: 5, planning: 15, generating: 45, installing: 72, running: 84, validating: 92 } as Record<string, number>)[status || ""] || 0;
}

/** Horizontal or vertical pipeline of build stages with the active one animated. */
export function BuildPipeline({ status, failed = false, vertical = false, compact = false, progressPercent }: { status?: string; failed?: boolean; vertical?: boolean; compact?: boolean; progressPercent?: number }) {
  const current = stageIndex(status);
  const percent = Math.max(0, Math.min(100, progressPercent ?? buildPercent(status)));
  return <div className={vertical ? "w-full" : compact ? "flex min-w-0 items-center gap-3" : "min-w-0"} aria-label={`Build ${percent}% complete`}>
    <div className={`flex items-center gap-2 ${compact ? "order-last" : "mb-2"} ${vertical ? "" : "justify-end"}`}><span className="text-[10px] font-medium tabular-nums text-[#c7ff4a]">{percent}%</span><span className={`relative h-1 overflow-hidden rounded-full bg-white/[.08] ${vertical ? "flex-1" : compact ? "w-16" : "w-24"}`}><motion.span className="absolute inset-y-0 left-0 rounded-full bg-[#c7ff4a]" initial={false} animate={{ width: `${percent}%` }} transition={{ duration: .7, ease }} />{percent > 0 && percent < 100 && <span className="nynz-progress-sweep absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-white/40 to-transparent" />}</span></div>
    <ol className={vertical ? "space-y-1" : "flex items-center gap-1.5"}>
    {buildStages.map((stage, index) => {
      const done = index < current || ((status === "ready" || status === "succeeded") && index === current);
      const now = index === current && !done;
      const broken = failed && now;
      return <li key={stage.id} className={vertical ? "flex items-center gap-3 py-1.5" : "flex items-center gap-1.5"}>
        <motion.span className={`relative grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[9px] transition-colors duration-500 ${broken ? "border-red-400/50 bg-red-400/10 text-red-300" : done ? "border-[#c7ff4a]/40 bg-[#c7ff4a]/15 text-[#c7ff4a]" : now ? "border-[#c7ff4a]/60 text-[#c7ff4a]" : "border-white/[.1] text-white/30"}`}>
          {broken ? <X className="h-2.5 w-2.5" /> : done ? <Check className="h-2.5 w-2.5" /> : now ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <span className="h-1 w-1 rounded-full bg-current" />}
          {now && !broken && <span className="absolute inset-0 animate-ping rounded-full border border-[#c7ff4a]/40" />}
        </motion.span>
        <span className={`text-[11px] transition-colors duration-500 ${broken ? "text-red-300" : now ? "text-[#f4f1e8]" : done ? "text-white/60" : "text-white/35"} ${vertical ? "" : compact ? (now ? "whitespace-nowrap" : "hidden") : "hidden whitespace-nowrap xl:inline"}`}>{stage.label}</span>
        {!vertical && index < buildStages.length - 1 && <span className={`relative mx-1 h-px overflow-hidden bg-white/[.1] ${compact ? "w-4" : "w-5 xl:w-7"}`}><motion.span className="absolute inset-y-0 left-0 bg-[#c7ff4a]/70" initial={false} animate={{ width: index < current ? "100%" : "0%" }} transition={{ duration: .6, ease }} /></span>}
      </li>;
    })}
    </ol>
  </div>;
}

function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

const palettes = [
  ["#c7ff4a", "#3d7a8c", "#1a2a44"],
  ["#7cc4ff", "#c7ff4a", "#1b2340"],
  ["#ffb86b", "#c7ff4a", "#2a1d33"],
  ["#9f8cff", "#5ad1b3", "#161d36"],
  ["#5ad1b3", "#f4f1e8", "#122a2c"],
];

/** Deterministic cover art for projects that don't have a live preview yet. */
export function ProjectArt({ seed, building = false }: { seed: string; building?: boolean }) {
  const h = hash(seed);
  const [a, b, base] = palettes[h % palettes.length];
  const layout = h % 3;
  return <div className="absolute inset-0 overflow-hidden" style={{ background: base }}>
    <div className="nynz-float absolute -left-1/4 -top-1/3 h-[120%] w-[80%] rounded-full opacity-40 blur-3xl" style={{ background: a }} />
    <div className="nynz-float-slow absolute -bottom-1/2 -right-1/4 h-[110%] w-[70%] rounded-full opacity-30 blur-3xl" style={{ background: b }} />
    <div className="absolute inset-0 nynz-dots opacity-60" />
    <div className="absolute inset-x-[9%] bottom-0 top-[16%] rounded-t-lg border border-white/[.12] bg-[#0b121b]/60 p-3 backdrop-blur-sm transition-transform duration-500 group-hover:-translate-y-1.5">
      <div className="flex items-center gap-2"><span className="h-2 w-10 rounded-full bg-white/25" /><span className="ml-auto h-2 w-6 rounded-full" style={{ background: a, opacity: .8 }} /></div>
      {layout === 0 && <div className="mt-3 grid grid-cols-3 gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="h-7 rounded" style={{ background: i === 1 ? a : "rgba(255,255,255,.08)", opacity: i === 1 ? .55 : 1 }} />)}</div>}
      {layout === 1 && <div className="mt-3 grid grid-cols-[1fr_2fr] gap-1.5"><span className="h-16 rounded bg-white/[.07]" /><span className="h-16 rounded" style={{ background: `linear-gradient(135deg, ${a}55, ${b}33)` }} /></div>}
      {layout === 2 && <div className="mt-3 flex h-14 items-end gap-1">{[40, 65, 50, 85, 60, 95, 70].map((v, i) => <span key={i} className="flex-1 rounded-sm" style={{ height: `${v}%`, background: i === 5 ? a : "rgba(255,255,255,.1)" }} />)}</div>}
      <div className="mt-2 space-y-1.5">{[90, 70, 80].map((w, i) => <span key={i} className={`block h-1.5 rounded-full ${building ? "nynz-shimmer" : "bg-white/[.08]"}`} style={{ width: `${w}%` }} />)}</div>
    </div>
  </div>;
}
