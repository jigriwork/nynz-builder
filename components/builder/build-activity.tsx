"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronRight, CircleDashed, FileCode2, ListChecks, PauseCircle, RotateCcw } from "lucide-react";
import { describeIssue } from "@/lib/platform/build-issues";

/**
 * The builder's account of a build, from what NYNZ already saves: progress
 * events, status, saved steps, the plan check and step charges. Milestones are
 * keyed, so they never repeat, stay in order after a refresh and never become
 * one message per file. Nothing here shows commands, logs or prompts.
 */
export type ActivityBuild = {
  id: string; status: string; mode?: string; request?: string | null; created_at: string; cancel_requested_at?: string | null;
  error_code?: string | null; resume_of?: string | null; resumable?: boolean;
  progress?: Array<{ at?: string; message?: string; percent?: number }>;
  plan?: { summary?: string; steps?: string[]; decisions?: Array<{ question: string; answer: string }>; coverage?: { missing?: string[]; unconfirmed?: string[] }; manifest?: { files?: Array<{ path: string }> }; assumptions?: string[]; browser_test?: { passed?: boolean; checked?: string[]; at?: string } } | null;
  checkpoint?: { done?: string[]; failed_step?: { label?: string } } | null;
};
export type StepCharge = { step: string; credits: number };
type Tone = "done" | "warn" | "bad" | "info" | "live";
export type Milestone = { key: string; at: string; label: string; detail?: string; tone: Tone };

const ACTIVE = ["queued", "planning", "generating", "installing", "running", "validating"];
const fileList = (text: string) => text.split(/,\s*/).map((name) => name.trim()).filter(Boolean);

/** Files written or updated, in order, from "Saved …" / "Updated …" events and saved steps. */
export function filesFor(build: ActivityBuild) {
  const seen = new Set<string>();
  for (const event of build.progress || []) {
    const match = event.message?.match(/^(?:Saved|Updated) (.+)$/);
    if (match) fileList(match[1]).forEach((name) => seen.add(name));
  }
  for (const path of build.checkpoint?.done || []) seen.add(path.split("/").pop() || path);
  return [...seen];
}

export function milestonesFor(build: ActivityBuild): Milestone[] {
  const out = new Map<string, Milestone>();
  const add = (key: string, at: string | undefined, label: string, tone: Tone = "done", detail?: string) => { if (!out.has(key)) out.set(key, { key, at: at || build.created_at, label, tone, detail }); };
  const edit = build.mode === "edit";
  let files = 0, firstFileAt: string | undefined, repairs = 0;
  for (const event of build.progress || []) {
    const m = event.message || "", at = event.at;
    let match: RegExpMatchArray | null;
    if (/^Plan approved/.test(m)) add("approved", at, "Plan approved, building started");
    else if (/^Revising the plan/.test(m)) add(`revise-${at}`, at, "Updating the plan with your changes", "info");
    else if ((match = m.match(/^Continuing from (\d+) finished file/))) add("resumed", at, `Resumed: ${match[1]} finished file${match[1] === "1" ? "" : "s"} reused, not rewritten`, "info");
    else if (/^Resuming from the generated files after a restart/.test(m)) add("restarted", at, "Picked up again after a server restart", "info");
    else if ((match = m.match(/^(?:Saved|Updated) (.+)$/))) { files += fileList(match[1]).length; firstFileAt ||= at; }
    else if (/^Repairing imports between files/.test(m)) add("imports", at, "Connected the files to each other");
    else if (/^Checking the result against the approved plan/.test(m)) add("review", at, "Reviewed the code against your plan");
    else if (/^Installing application dependencies/.test(m)) add("install", at, "Installed dependencies");
    else if (/^Compiling and typechecking/.test(m)) add("compile", at, "Compiling and type-checking");
    else if ((match = m.match(/^Repairing a compiler issue · pass (\d+)/))) { repairs = Math.max(repairs, Number(match[1])); add(`repair-${match[1]}`, at, `The build check found errors. Repairing (attempt ${match[1]} of 2)`, "warn"); }
    else if (/^Rechecking the repaired application/.test(m)) add("recheck", at, "Rechecking after the repair");
    else if (/^Starting the secure application preview/.test(m)) add("preview", at, "Starting the preview");
    else if (/^Build complete/.test(m)) add("live", at, "Preview is live");
  }
  if (files) out.set("files", { key: "files", at: firstFileAt || build.created_at, label: `${edit ? "Updated" : "Wrote"} ${files} file${files === 1 ? "" : "s"}`, tone: "done", detail: filesFor(build).slice(-6).join(", ") });
  const last = (build.progress || []).at(-1)?.at || build.created_at;
  if (build.status === "succeeded") add("live", last, "Preview is live");
  if (build.status === "succeeded" && out.has("compile")) out.set("compile", { ...out.get("compile")!, label: repairs ? `Compiled and type-checked after ${repairs} repair${repairs === 1 ? "" : "s"}` : "Compiled and type-checked" });
  if (ACTIVE.includes(build.status) && build.cancel_requested_at) add("stopping", build.cancel_requested_at, "Stopping. No new paid work will start", "info");
  const saved = build.checkpoint?.done?.length || 0;
  if (build.status === "cancelled") add("stopped", last, "You stopped the build", "info", saved ? `${saved} finished file${saved === 1 ? " is" : "s are"} saved for Resume. Your live version is unchanged.` : "Your live version is unchanged.");
  if (build.status === "failed") {
    const issue = describeIssue(build.error_code);
    add("failed", last, issue.title, "bad", [build.checkpoint?.failed_step?.label ? `Stopped at: ${build.checkpoint.failed_step.label}.` : "", saved && build.resumable ? `${saved} finished file${saved === 1 ? " is" : "s are"} saved; Resume continues from there.` : ""].filter(Boolean).join(" ") || undefined);
  }
  const list = [...out.values()].sort((a, b) => a.at.localeCompare(b.at));
  if (ACTIVE.includes(build.status) && list.length) list[list.length - 1] = { ...list[list.length - 1], tone: list[list.length - 1].tone === "done" ? "live" : list[list.length - 1].tone };
  return list;
}

export type Check = { label: string; state: "passed" | "failed" | "partial" | "not_run"; detail?: string };

/** What NYNZ actually checked, kept apart: compilation, a responding preview, an AI review, a browser test. */
export function verificationFor(build: ActivityBuild): Check[] {
  const events = (build.progress || []).map((event) => event.message || "");
  const compiled = events.some((m) => /^Compiling and typechecking/.test(m));
  const repairs = events.filter((m) => /^Repairing a compiler issue/.test(m)).length;
  const checks: Check[] = [];
  if (compiled || build.status === "succeeded") checks.push(build.status === "succeeded"
    ? { label: "Compiled and type-checked", state: "passed", detail: repairs ? `Passed after ${repairs} automatic repair${repairs === 1 ? "" : "s"}.` : "The production build passed." }
    : { label: "Compiled and type-checked", state: build.error_code === "BUILD_VALIDATION_FAILED" ? "failed" : "not_run", detail: build.error_code === "BUILD_VALIDATION_FAILED" ? "The production build still had errors, so your previous version was kept." : undefined });
  if (build.status === "succeeded") checks.push({ label: "Preview started and responded", state: "passed", detail: "The app's server answered its first page." });
  const steps = build.plan?.steps || [];
  const coverage = build.plan?.coverage;
  if (steps.length && coverage) {
    const missing = coverage.missing || [], unsure = coverage.unconfirmed || [];
    checks.push({ label: "AI review of the code against your plan", state: missing.length ? "failed" : unsure.length ? "partial" : "passed",
      detail: missing.length ? `Not built yet: ${missing.slice(0, 3).join("; ")}${missing.length > 3 ? "…" : ""}` : unsure.length ? `Couldn't confirm: ${unsure.slice(0, 2).join("; ")}${unsure.length > 2 ? "…" : ""}. Please check these in the preview.` : `All ${steps.length} plan steps were found in the code. This reads the code; it does not click through the app.` });
  }
  const browser = build.plan?.browser_test;
  checks.push(browser ? { label: "Tested in a browser", state: browser.passed ? "passed" : "failed", detail: browser.checked?.join(", ") } : { label: "Not tested in a browser yet", state: "not_run", detail: "Try the main flows in the preview." });
  return checks;
}

const TONE: Record<Tone, string> = { done: "text-[#c7ff4a]", warn: "text-amber-300", bad: "text-red-300", info: "text-sky-300", live: "text-[#c7ff4a]" };
function MilestoneIcon({ tone }: { tone: Tone }) {
  const cls = `mt-0.5 h-3.5 w-3.5 shrink-0 ${TONE[tone]}`;
  if (tone === "live") return <CircleDashed className={`${cls} animate-spin [animation-duration:2.4s]`} />;
  if (tone === "warn") return <RotateCcw className={cls} />;
  if (tone === "bad") return <AlertTriangle className={cls} />;
  if (tone === "info") return <PauseCircle className={cls} />;
  return <Check className={cls} />;
}

/** The milestones of one build, as a quiet list in the conversation. */
export function BuildTimeline({ build, charges }: { build: ActivityBuild; charges?: StepCharge[] }) {
  const milestones = milestonesFor(build);
  if (!milestones.length) return null;
  const finishedBadly = build.status === "failed" || build.status === "cancelled";
  return <section aria-label="Build progress" data-testid="build-timeline" className="mr-5 rounded-2xl border border-white/[.07] bg-white/[.02] px-4 py-3 sm:mr-12">
    <ol className="space-y-2">{milestones.map((m) => <li key={m.key} className="flex gap-2.5 text-[12px] leading-5"><MilestoneIcon tone={m.tone} /><span><span className="text-white/85">{m.label}</span>{m.detail && <span className="block text-white/55">{m.detail}</span>}</span></li>)}</ol>
    {finishedBadly && <ActivityDetails build={build} charges={charges} />}
  </section>;
}

/** "What I verified", shown under the completion reply. */
export function VerifiedBlock({ build }: { build: ActivityBuild }) {
  const checks = verificationFor(build);
  const icon = (state: Check["state"]) => state === "passed" ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#c7ff4a]" /> : state === "failed" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" /> : state === "partial" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" /> : <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/45" />;
  return <div data-testid="what-i-verified" className="mt-3 border-t border-white/[.07] pt-3">
    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[.14em] text-white/55"><ListChecks className="h-3.5 w-3.5" /> What I verified</p>
    <ul className="space-y-1.5">{checks.map((c) => <li key={c.label} className="flex gap-2.5 text-[12px] leading-5">{icon(c.state)}<span><span className="text-white/85">{c.label}</span>{c.detail && <span className="block text-white/55">{c.detail}</span>}</span></li>)}</ul>
  </div>;
}

/** Collapsible: files changed, checks run, step charges. */
export function ActivityDetails({ build, charges }: { build: ActivityBuild; charges?: StepCharge[] }) {
  const [open, setOpen] = useState(false);
  const files = filesFor(build);
  const checks = verificationFor(build).filter((c) => c.state !== "not_run" || /browser/i.test(c.label));
  const byStep = new Map<string, number>();
  for (const charge of charges || []) byStep.set(charge.step, (byStep.get(charge.step) || 0) + charge.credits);
  const total = [...byStep.values()].reduce((sum, value) => sum + value, 0);
  return <div className="mt-3">
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex items-center gap-1.5 text-[12px] font-medium text-white/70 transition hover:text-white"><ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} /> View activity</button>
    {open && <div data-testid="activity-details" className="mt-2 space-y-3 rounded-xl border border-white/[.07] bg-black/20 p-3 text-[12px] leading-5">
      <div><p className="mb-1 text-[11px] uppercase tracking-[.14em] text-white/50">Files {build.mode === "edit" ? "changed" : "written"}</p>{files.length ? <p className="flex flex-wrap gap-1.5">{files.map((f) => <span key={f} className="inline-flex items-center gap-1 rounded-md bg-white/[.05] px-1.5 py-0.5 font-mono text-[11px] text-white/75"><FileCode2 className="h-3 w-3" />{f}</span>)}</p> : <p className="text-white/55">No files were saved.</p>}</div>
      <div><p className="mb-1 text-[11px] uppercase tracking-[.14em] text-white/50">Checks run</p><ul className="space-y-0.5">{checks.map((c) => <li key={c.label} className="text-white/75">{c.state === "passed" ? "Passed" : c.state === "failed" ? "Failed" : c.state === "partial" ? "Partly confirmed" : "Not run"}: {c.label.replace(/^Not tested in a browser yet$/, "Browser test")}</li>)}</ul></div>
      {byStep.size > 0 && <div><p className="mb-1 text-[11px] uppercase tracking-[.14em] text-white/50">Credits charged to this build</p><ul className="space-y-0.5">{[...byStep].map(([step, credits]) => <li key={step} className="flex justify-between gap-3 text-white/75"><span className="truncate">{step}</span><span className="tabular-nums">{credits}</span></li>)}<li className="flex justify-between gap-3 border-t border-white/[.07] pt-1 text-white/85"><span>Total for this build</span><span className="tabular-nums">{total} credit{total === 1 ? "" : "s"}</span></li></ul><p className="mt-1 text-[11px] text-white/55">Covers planning, writing and checking this build. Preview time after the build is charged separately and listed in Plan and billing.</p></div>}
    </div>}
  </div>;
}

/** "What I understood", on the plan card: from the saved request, plan and brief only. */
export function UnderstoodBlock({ build, brief }: { build: ActivityBuild; brief?: { original?: string; changes?: Array<{ status?: string }> } | null }) {
  const request = (build.request || "").split("\n\n")[0].trim();
  const fileCount = (build.plan?.manifest?.files || []).length;
  const stepCount = build.plan?.steps?.length || 0;
  const applied = (brief?.changes || []).filter((c) => c.status === "applied").length;
  const assumptions = (build.plan?.assumptions || []).filter(Boolean);
  const decisions = (build.plan?.decisions || []).filter((d) => d.answer);
  return <div data-testid="what-i-understood" className="mt-3 rounded-xl border border-white/[.07] bg-white/[.03] p-3 text-[12px] leading-5">
    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[.14em] text-white/55">What I understood</p>
    {request && <p className="text-white/75"><span className="text-white/55">You asked for: </span>{request.length > 220 ? `${request.slice(0, 220)}…` : request}</p>}
    {(stepCount > 0 || fileCount > 0) && <p className="mt-1 text-white/75"><span className="text-white/55">{build.mode === "edit" ? "I'll change: " : "I'll create: "}</span>{[stepCount ? `${stepCount} plan step${stepCount === 1 ? "" : "s"}` : "", fileCount ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(" across ")}, listed below.</p>}
    {build.mode === "edit" && brief?.original && <p className="mt-1 text-white/75"><span className="text-white/55">I'll keep: </span>your original brief{applied ? ` and ${applied} earlier change${applied === 1 ? "" : "s"}` : ""}, so existing features stay as they are.</p>}
    {decisions.length > 0 && <div className="mt-1.5"><p className="text-white/55">Your decisions:</p><ul className="list-inside list-disc text-white/75">{decisions.map((d) => <li key={d.question}>{d.question === "Your reply" ? d.answer : `${d.question} ${d.answer}`}</li>)}</ul></div>}
    {assumptions.length > 0 && <div className="mt-1.5"><p className="text-white/55">Assumptions I made (you chose to continue with them):</p><ul className="list-inside list-disc text-white/75">{assumptions.map((a) => <li key={a}>{a}</li>)}</ul></div>}
  </div>;
}
