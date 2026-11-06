"use client";

import { useState } from "react";
import { ArrowRight, MessageCircleQuestion } from "lucide-react";

export type ClarifyQuestion = { id: string; question: string; why: string; options: string[]; recommended: string };
export type ClarifyAnswer = { action: "answer"; answers: Array<{ id: string; answer: string }> } | { action: "assume" };

/**
 * One or two questions NYNZ asks before planning a vague brief, only when the
 * answer changes how the app works. The person can answer, write their own
 * answer, or continue with the assumptions NYNZ states.
 */
export function ClarifyCard({ questions, assumptions, onAnswer }: { questions: ClarifyQuestion[]; assumptions: string[]; onAnswer: (input: ClarifyAnswer) => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = (id: string) => (custom[id] || "").trim() || answers[id] || "";
  const complete = questions.every((q) => value(q.id));
  async function send(input: ClarifyAnswer) {
    setBusy(true); setError("");
    try { await onAnswer(input); } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); } finally { setBusy(false); }
  }
  return <section aria-label="Questions before planning" data-testid="clarify-card" className="rounded-2xl border border-sky-300/25 bg-[#0f1824] p-4">
    <div className="flex items-center gap-2"><MessageCircleQuestion className="h-4 w-4 text-sky-200" /><h2 className="text-[13px] font-medium">{questions.length === 1 ? "One quick choice before I plan" : "Two quick choices before I plan"}</h2></div>
    <p className="mt-1.5 text-[12px] leading-5 text-white/60">These change how the app works, so I'd rather ask than guess. No code has been written and nothing has been charged for building yet.</p>
    <div className="mt-3 space-y-4">{questions.map((q, index) => <fieldset key={q.id} className="space-y-2">
      <legend className="text-[13px] font-medium leading-5 text-white/90">{index + 1}. {q.question}</legend>
      {q.why && <p className="text-[12px] leading-5 text-white/55">{q.why}</p>}
      <div className="flex flex-wrap gap-1.5">{q.options.map((option) => {
        const selected = answers[q.id] === option && !(custom[q.id] || "").trim();
        return <button key={option} type="button" aria-pressed={selected} disabled={busy} onClick={() => { setAnswers((a) => ({ ...a, [q.id]: option })); setCustom((c) => ({ ...c, [q.id]: "" })); }}
          className={`rounded-full border px-3 py-1.5 text-[12px] transition ${selected ? "border-[#c7ff4a]/60 bg-[#c7ff4a]/15 text-[#e9ffc0]" : "border-white/[.12] bg-white/[.03] text-white/80 hover:border-white/30"}`}>{option}{option === q.recommended && <span className="ml-1.5 text-[10px] uppercase tracking-[.1em] text-white/50">recommended</span>}</button>;
      })}</div>
      <input aria-label={`Your own answer to question ${index + 1}`} value={custom[q.id] || ""} onChange={(e) => setCustom((c) => ({ ...c, [q.id]: e.target.value }))} disabled={busy} placeholder="Or write your own answer" className="h-9 w-full rounded-lg border border-white/10 bg-[#080f18] px-3 text-[12px] outline-none placeholder:text-white/40 focus:border-[#c7ff4a]/40" />
    </fieldset>)}</div>
    {error && <p role="alert" className="mt-3 text-[12px] text-red-300">{error}</p>}
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy || !complete} onClick={() => send({ action: "answer", answers: questions.map((q) => ({ id: q.id, answer: value(q.id) })) })} className="flex h-9 items-center gap-1.5 rounded-lg bg-[#c7ff4a] px-3 text-[12px] font-semibold text-[#071019] disabled:opacity-40">Use my answers <ArrowRight className="h-3.5 w-3.5" /></button>
      <button type="button" disabled={busy} onClick={() => send({ action: "assume" })} className="h-9 rounded-lg border border-white/[.14] px-3 text-[12px] text-white/85 transition hover:bg-white/[.06] disabled:opacity-40">Continue with my assumptions</button>
    </div>
    {assumptions.length > 0 && <div className="mt-3 rounded-xl bg-white/[.03] p-3 text-[12px] leading-5"><p className="text-white/55">If you continue, I'll assume:</p><ul className="mt-1 list-inside list-disc text-white/80">{assumptions.map((a) => <li key={a}>{a}</li>)}</ul></div>}
  </section>;
}
