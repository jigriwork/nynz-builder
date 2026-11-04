"use client";

import { FormEvent, useState } from "react";
import { CalendarCheck2, Handshake, Lightbulb, ListChecks, Package, PenLine, ShoppingBag, Trophy, X } from "lucide-react";
import { STARTERS, draftToPrompt, type StarterDraft } from "@/lib/prompt-starters";

const TIPS: Array<[string, string]> = [
  ["Purpose", "What the app is for. “Track orders for my ceramics shop.”"],
  ["Users", "Who uses it. “Shop staff on a laptop, the owner on a phone.”"],
  ["Features", "The key actions. “Add products, adjust stock, move orders to Shipped.”"],
  ["Look", "How it should feel. “Warm and earthy, large readable text.”"],
  ["Data", "Demonstration data saved in the browser, or your own connected Supabase project."],
];

const STARTER_ICONS = { Booking: CalendarCheck2, Inventory: Package, CRM: Handshake, Portal: Trophy, Storefront: ShoppingBag, Tracker: ListChecks } as const;

const field = "w-full rounded-xl border border-white/[.1] bg-white/[.035] px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-[#c7ff4a]/45";

/**
 * Compact prompt help for a composer: writing tips, a structured "Help me
 * write my prompt" form and curated starter ideas. Everything only fills the
 * composer; nothing submits, creates a project or uses credits. Existing text
 * is replaced only after the person confirms.
 */
export function PromptGuide({ getValue, onChange }: { getValue: () => string; onChange: (text: string) => void }) {
  const [panel, setPanel] = useState<"none" | "tips" | "helper">("none");
  const [draft, setDraft] = useState<StarterDraft>({ name: "", purpose: "", users: "", features: "", look: "", data: "demo" });
  const put = (text: string) => {
    const value = getValue();
    if (value.trim() && value.trim() !== text.trim() && !window.confirm("Replace the text you have already written in the box?")) return false;
    onChange(text);
    return true;
  };
  function useDraft(event: FormEvent) {
    event.preventDefault();
    if (!draft.purpose.trim() && !draft.features.trim()) return;
    if (put(draftToPrompt(draft))) setPanel("none");
  }
  const toggle = (next: "tips" | "helper") => setPanel((current) => (current === next ? "none" : next));
  return <div className="mx-auto mt-4 max-w-[900px] text-left">
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button type="button" onClick={() => toggle("tips")} aria-expanded={panel === "tips"} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[.09] bg-white/[.025] px-3 text-[12px] text-white/65 transition hover:border-[#c7ff4a]/30 hover:text-white"><Lightbulb className="h-3.5 w-3.5 text-[#c7ff4a]" /> How to write a good prompt</button>
      <button type="button" onClick={() => toggle("helper")} aria-expanded={panel === "helper"} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[.09] bg-white/[.025] px-3 text-[12px] text-white/65 transition hover:border-[#c7ff4a]/30 hover:text-white"><PenLine className="h-3.5 w-3.5 text-[#c7ff4a]" /> Help me write my prompt</button>
    </div>
    {panel === "tips" && <div className="nynz-pop-in relative mt-3 rounded-2xl border border-white/[.09] bg-[#0b121b] p-4">
      <button type="button" onClick={() => setPanel("none")} aria-label="Close tips" className="absolute right-3 top-3 text-white/45 hover:text-white"><X className="h-4 w-4" /></button>
      <p className="text-[12px] font-medium text-white/85">Describe these five things and NYNZ can plan a better app:</p>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">{TIPS.map(([term, text]) => <div key={term} className="rounded-xl bg-white/[.03] p-2.5"><dt className="text-[11px] font-medium text-[#c7ff4a]">{term}</dt><dd className="mt-0.5 text-[12px] leading-5 text-white/65">{text}</dd></div>)}</dl>
      <p className="mt-3 text-[11px] leading-5 text-white/50">Payments, real sign-in and publishing need extra setup, so ask for a demonstration of those flows unless your own backend is connected.</p>
    </div>}
    {panel === "helper" && <form onSubmit={useDraft} className="nynz-pop-in relative mt-3 grid gap-2.5 rounded-2xl border border-white/[.09] bg-[#0b121b] p-4 sm:grid-cols-2">
      <button type="button" onClick={() => setPanel("none")} aria-label="Close prompt helper" className="absolute right-3 top-3 text-white/45 hover:text-white"><X className="h-4 w-4" /></button>
      <p className="text-[12px] font-medium text-white/85 sm:col-span-2">Answer what you can. You can edit the brief before building.</p>
      <label className="text-[11px] text-white/60">App name (optional)<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Stillwater" className={`${field} mt-1`} /></label>
      <label className="text-[11px] text-white/60">What it is for<input value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} placeholder="lets members book yoga classes" className={`${field} mt-1`} /></label>
      <label className="text-[11px] text-white/60">Who uses it<input value={draft.users} onChange={(e) => setDraft({ ...draft, users: e.target.value })} placeholder="studio members and the studio manager" className={`${field} mt-1`} /></label>
      <label className="text-[11px] text-white/60">Look and feel<input value={draft.look} onChange={(e) => setDraft({ ...draft, look: e.target.value })} placeholder="calm, airy, soft greens" className={`${field} mt-1`} /></label>
      <label className="text-[11px] text-white/60 sm:col-span-2">Essential features and actions (one per line)<textarea value={draft.features} onChange={(e) => setDraft({ ...draft, features: e.target.value })} rows={3} placeholder={"Browse a weekly timetable\nBook or cancel a class\nJoin a waitlist when full"} className={`${field} mt-1 resize-none`} /></label>
      <fieldset className="text-[11px] text-white/60 sm:col-span-2"><legend className="mb-1">Data</legend><div className="flex flex-wrap gap-3">
        <label className="inline-flex items-center gap-2"><input type="radio" name="data" checked={draft.data === "demo"} onChange={() => setDraft({ ...draft, data: "demo" })} className="accent-[#c7ff4a]" /> Demonstration data (recommended to start)</label>
        <label className="inline-flex items-center gap-2"><input type="radio" name="data" checked={draft.data === "backend"} onChange={() => setDraft({ ...draft, data: "backend" })} className="accent-[#c7ff4a]" /> I will connect my own Supabase project</label>
      </div></fieldset>
      <div className="flex items-center gap-3 sm:col-span-2"><button disabled={!draft.purpose.trim() && !draft.features.trim()} className="h-9 rounded-xl bg-[#c7ff4a] px-4 text-[12px] font-semibold text-[#071019] disabled:opacity-40">Put this brief in the box</button><span className="text-[11px] text-white/45">Nothing is built until you press Build.</span></div>
    </form>}
    <div className="mt-4">
      <p className="mb-2 text-center text-[10px] font-medium uppercase tracking-[.2em] text-white/40">Starter ideas</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{STARTERS.map((starter) => { const Icon = STARTER_ICONS[starter.label]; return <button key={starter.label} type="button" onClick={() => put(starter.prompt)} title={starter.prompt} className="nynz-lift group flex min-w-0 items-start gap-2.5 rounded-2xl border border-white/[.08] bg-white/[.025] p-3 text-left transition hover:border-[#c7ff4a]/30 hover:bg-[#c7ff4a]/[.05]">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[.06] text-[#c7ff4a] transition group-hover:bg-[#c7ff4a] group-hover:text-[#071019]"><Icon className="h-4 w-4" /></span>
        <span className="min-w-0"><span className="block text-[10px] font-medium uppercase tracking-[.14em] text-white/45">{starter.label}</span><span className="mt-0.5 line-clamp-2 block text-[12px] leading-[1.35] text-white/75 group-hover:text-white">{starter.title}</span></span>
      </button>; })}</div>
    </div>
  </div>;
}
