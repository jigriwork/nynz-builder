"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Box, Coins, FilePlus2, LoaderCircle, LogOut, Pencil, Search, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { NynzBrand, NynzIcon } from "@/components/nynz-brand";
import { ProjectArt, ease } from "@/components/nynz-motion";
import { formatDate } from "@/lib/format-date";
import { ProjectNameDialog } from "@/components/project-name-dialog";
import { PromptGuide } from "@/components/prompt-guide";
import { MadeInOdisha } from "@/components/made-in-odisha";
import { AppPoster, type ProjectCard } from "@/components/app-poster";
import { AccountMenu, type AccountSummary } from "@/components/account-menu";
import { usePresence } from "@/hooks/use-presence";

type Project = { id: string; name: string; description: string; status: string; preview_url: string | null; updated_at: string };
type Draft = { prompt: string; reference?: string; attachment?: { name: string; content: string } | null; createdAt: number; projectId?: string };

const filters = [["all", "All"], ["ready", "Live"], ["building", "Building"], ["draft", "Draft"], ["failed", "Failed"]] as const;
const statusStyle: Record<string, { label: string; dot: string; text: string }> = {
  ready: { label: "Live", dot: "bg-[#c7ff4a]", text: "text-[#c7ff4a]" },
  failed: { label: "Failed", dot: "bg-red-400", text: "text-red-300" },
  draft: { label: "Draft", dot: "bg-white/40", text: "text-white/55" },
};
const building = (status: string) => !["ready", "failed", "draft"].includes(status);
function projectName(prompt: string) {
  const named = prompt.match(/\b(?:called|named)\s+["“]?([\p{L}\p{N}][\p{L}\p{N}'’-]*(?:\s+[A-Z0-9][\p{L}\p{N}'’-]*){0,2})/u)?.[1];
  const inferred = prompt.replace(/^(?:please\s+)?(?:build|create|make|design|develop)\s+(?:(?:me|us)\s+)?(?:(?:a|an|the)\s+)?/i, "").split(/[,.!?\n]/)[0].replace(/["”]+$/, "").trim();
  return named || (inferred ? inferred.charAt(0).toUpperCase() + inferred.slice(1, 72) : "New NYNZ app");
}

export default function DashboardClient({ initialProjects, account, cards = {} }: { initialProjects: Project[]; account: AccountSummary; cards?: Record<string, ProjectCard> }) {
  usePresence();
  const [projects, setProjects] = useState(initialProjects);
  // The composer keeps its own text; the dashboard (and its layout-animated
  // project grid) only re-renders when the box switches between empty and not.
  const promptRef = useRef("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [hasPrompt, setHasPrompt] = useState(false);
  const setPrompt = (text: string) => { promptRef.current = text; if (composerRef.current) composerRef.current.value = text; setHasPrompt(Boolean(text.trim())); };
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number][0]>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const router = useRouter();
  const resumedDraft = useRef(false);

  async function startFromDraft(draft: Draft) {
    try {
      if (draft.projectId) { router.push(`/projects/${draft.projectId}`); return; }
      setBusy(true);
      const name = projectName(String(draft.prompt || "New NYNZ app"));
      const res = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description: String(draft.prompt || "").slice(0, 500) }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not create project");
      sessionStorage.setItem("nynz_build_draft", JSON.stringify({ ...draft, projectId: body.project.id }));
      router.push(`/projects/${body.project.id}`);
    } catch (cause) { setBusy(false); setError(cause instanceof Error ? cause.message : "Could not create project"); }
  }

  useEffect(() => {
    if (resumedDraft.current) return;
    resumedDraft.current = true;
    const raw = sessionStorage.getItem("nynz_build_draft");
    if (!raw) return;
    try { startFromDraft(JSON.parse(raw)); } catch { sessionStorage.removeItem("nynz_build_draft"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const prompt = promptRef.current;
    if (prompt.trim().length < 12) { setError("Tell NYNZ a little more about what you want to build."); return; }
    const draft: Draft = { prompt: prompt.trim(), reference: "", attachment: null, createdAt: Date.now() };
    sessionStorage.setItem("nynz_build_draft", JSON.stringify(draft));
    startFromDraft(draft);
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
  }

  async function createBlank() {
    setBusy(true);
    const res = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Untitled app" }) });
    const body = await res.json();
    if (res.ok) router.push(`/projects/${body.project.id}`); else { setBusy(false); setError(body.error); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this project and its versions?")) return;
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) setProjects((value) => value.filter((project) => project.id !== id));
  }

  const counts = useMemo(() => ({ all: projects.length, ready: projects.filter((p) => p.status === "ready").length, building: projects.filter((p) => building(p.status)).length, draft: projects.filter((p) => p.status === "draft").length, failed: projects.filter((p) => p.status === "failed").length }), [projects]);
  const visible = useMemo(() => projects.filter((project) => {
    if (filter === "building" ? !building(project.status) : filter !== "all" && project.status !== filter) return false;
    const q = query.trim().toLowerCase();
    return !q || project.name.toLowerCase().includes(q) || project.description?.toLowerCase().includes(q);
  }), [projects, filter, query]);

  return <main data-dashboard-ready={mounted} className="nynz-dark relative min-h-screen overflow-hidden bg-[#070b12] text-[#f4f1e8] selection:bg-[#c7ff4a] selection:text-[#071019]">
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[640px] nynz-hero-grid" />
    <div aria-hidden className="nynz-float pointer-events-none absolute -top-72 left-[20%] h-[560px] w-[760px] rounded-full bg-[#294662]/25 blur-[160px]" />
    <div aria-hidden className="nynz-float-slow pointer-events-none absolute -right-40 top-20 h-[380px] w-[480px] rounded-full bg-[#c7ff4a]/[.05] blur-[130px]" />

    <header className="sticky top-0 z-30 border-b border-white/[.07] bg-[#070b12]/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between px-5 md:px-8">
        <Link href="/"><NynzBrand className="h-7" /></Link>
        <div className="flex items-center gap-2.5">{account.availableCredits !== null && <Link href="/billing" title="Credits available. Credits are charged from measured provider cost." className="hidden h-9 items-center gap-2 rounded-full border border-[#c7ff4a]/15 bg-[#c7ff4a]/[.05] px-3 text-[11px] text-[#c7ff4a] md:flex"><Coins className="h-3.5 w-3.5" /><span>{account.availableCredits.toLocaleString()}</span><span className="text-white/35">credits</span></Link>}<AccountMenu account={account} /></div>
      </div>
    </header>

    <div className="relative mx-auto max-w-[1320px] px-5 pb-20 pt-14 md:px-8 md:pt-20">
      <section className="mx-auto max-w-[880px] text-center">
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5, ease }} className="inline-flex items-center gap-2 rounded-full border border-[#c7ff4a]/20 bg-[#c7ff4a]/[.06] px-3 py-1.5 text-[11px] font-medium text-[#c7ff4a]"><NynzIcon className="h-4 w-4" /> Your workspace</motion.p>
        <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .05, ease }} className="mt-5 text-5xl font-medium tracking-[-.065em] md:text-7xl">What will you <span className="nynz-text-shine">build</span> today?</motion.h1>
        <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .12, ease }} className="mx-auto mt-4 max-w-xl text-base leading-7 text-white/55">Describe an app and NYNZ will plan it, write it and run it live in a few minutes.</motion.p>

        <form onSubmit={submit} className="nynz-composer relative mx-auto mt-9 rounded-[24px] border border-white/[.1] bg-[#0f1722] p-2 text-left shadow-[0_40px_120px_rgba(0,0,0,.5)]">
          <div className="rounded-[18px] border border-white/[.05] bg-[#0b121b]">
            <textarea ref={composerRef} defaultValue="" onChange={(event) => { promptRef.current = event.target.value; const has = Boolean(event.target.value.trim()); if (has !== hasPrompt) setHasPrompt(has); if (error) setError(""); }} onKeyDown={onKey} rows={3} maxLength={30_000} placeholder="Describe the app you want to build…" aria-label="Application description" className="w-full resize-none bg-transparent px-5 pb-3 pt-5 text-[17px] leading-7 outline-none placeholder:text-white/35" />
            <div className="flex items-center gap-2 border-t border-white/[.06] p-2.5">
              <button type="button" onClick={createBlank} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-[12px] text-white/55 transition hover:bg-white/[.05] hover:text-white disabled:opacity-40"><FilePlus2 className="h-4 w-4" /> Blank project</button>
              <span className="ml-auto hidden text-[11px] text-white/30 sm:inline">Press Enter to build</span>
              <motion.button whileTap={{ scale: .96 }} disabled={busy || !hasPrompt} className="group inline-flex h-10 items-center gap-2 rounded-xl bg-[#c7ff4a] px-4 text-[13px] font-semibold text-[#071019] shadow-[0_8px_28px_rgba(199,255,74,.2)] transition hover:bg-[#d5ff72] disabled:cursor-not-allowed disabled:opacity-35">{busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#071019]/20 border-t-[#071019]" /> : <>Build <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}</motion.button>
            </div>
          </div>
          <AnimatePresence>{error && <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} role="alert" className="px-4 py-2.5 text-xs text-red-300">{error}</motion.p>}</AnimatePresence>
        </form>
        <PromptGuide getValue={() => promptRef.current} onChange={(text) => { setPrompt(text); setError(""); composerRef.current?.focus(); }} />
      </section>

      <section className="mt-20">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div><div className="flex flex-wrap items-center gap-3"><h2 className="text-2xl font-medium tracking-[-.04em]">Projects</h2><MadeInOdisha /></div><p className="mt-1 text-[13px] text-white/45">{projects.length ? `${projects.length} application${projects.length === 1 ? "" : "s"} · ${counts.ready} live` : "No applications yet"}</p></div>
          {projects.length > 0 && <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex overflow-x-auto rounded-xl border border-white/[.08] bg-white/[.02] p-1">{filters.map(([id, label]) => <button key={id} onClick={() => setFilter(id)} className={`relative whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] transition ${filter === id ? "text-[#071019]" : "text-white/55 hover:text-white"}`}>{filter === id && <motion.span layoutId="dash-filter" transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-lg bg-[#c7ff4a]" />}<span className="relative">{label}<span className={`ml-1.5 text-[10px] ${filter === id ? "text-[#071019]/60" : "text-white/30"}`}>{counts[id]}</span></span></button>)}</div>
            <label className="flex h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.02] px-3 text-white/45 transition focus-within:border-[#c7ff4a]/35 sm:w-60"><Search className="h-3.5 w-3.5 shrink-0" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/35" /></label>
          </div>}
        </div>

        {projects.length === 0 ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid min-h-[300px] place-items-center rounded-[24px] border border-dashed border-white/[.11] bg-white/[.015] text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/[.1] bg-white/[.035] text-[#c7ff4a]"><Box className="h-5 w-5" /></span><h3 className="mt-5 text-lg font-medium">Your first build starts here</h3><p className="mt-2 text-sm text-white/50">Describe an app above and watch it come to life.</p></div></motion.div>
        : <motion.div layout className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">{visible.map((project, index) => {
            const style = statusStyle[project.status] || { label: "Building", dot: "bg-amber-300", text: "text-amber-200" };
            const isBuilding = building(project.status);
            return <motion.article layout key={project.id} initial={{ opacity: 0, y: 20, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: .96 }} transition={{ duration: .45, delay: Math.min(index * .05, .3), ease }} className="group relative overflow-hidden rounded-[22px] border border-white/[.08] bg-[#0c131d] p-2 transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-1 hover:border-white/[.16] hover:shadow-[0_30px_80px_rgba(0,0,0,.45)]">
              <a href={`/projects/${project.id}`} className="block">
                <div className="relative aspect-[16/10] overflow-hidden rounded-[16px] bg-[#131d29]">
                  {!isBuilding && cards[project.id] && (cards[project.id].heading || cards[project.id].title) ? <AppPoster card={cards[project.id]} name={project.name} /> : <ProjectArt seed={project.id} building={isBuilding} />}
                  <span className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-white/[.1] bg-[#070b12]/70 px-2.5 py-1 text-[10px] backdrop-blur-md"><span className="relative flex h-1.5 w-1.5">{(isBuilding || project.status === "ready") && <span className={`absolute inset-0 animate-ping rounded-full ${style.dot} opacity-60`} />}<span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} /></span><span className={style.text}>{style.label}</span></span>
                  <span className="absolute bottom-3 right-3 z-10 grid h-9 w-9 translate-y-2 place-items-center rounded-full bg-[#c7ff4a] text-[#071019] opacity-0 shadow-[0_8px_24px_rgba(199,255,74,.35)] transition duration-300 group-hover:translate-y-0 group-hover:opacity-100"><ArrowUpRight className="h-4 w-4" /></span>
                </div>
                <div className="px-3 pb-2 pt-4"><h3 className="truncate pr-8 text-[15px] font-medium">{project.name}</h3><p className="mt-1 line-clamp-1 text-[12px] text-white/45">{project.description || "No description yet"}</p><p className="mt-3 pr-16 text-[11px] text-white/35">Updated {formatDate(project.updated_at)}</p></div>
              </a>
              <button type="button" onClick={() => setRenaming(project)} aria-label={`Rename ${project.name}`} title="Rename project" className="absolute bottom-4 right-12 grid h-8 w-8 place-items-center rounded-lg text-white/40 transition hover:bg-white/[.06] hover:text-[#c7ff4a]"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => remove(project.id)} aria-label={`Delete ${project.name}`} title="Delete project" className="absolute bottom-4 right-4 grid h-8 w-8 place-items-center rounded-lg text-white/30 opacity-0 transition hover:bg-red-400/10 hover:text-red-300 focus:opacity-100 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
            </motion.article>;
          })}</AnimatePresence>
          {visible.length === 0 && <p className="col-span-full py-16 text-center text-sm text-white/45">No projects match this view.</p>}
        </motion.div>}
      </section>
    </div>
    {renaming && <ProjectNameDialog project={renaming} onClose={() => setRenaming(null)} onSaved={updated => setProjects(value => value.map(project => project.id === updated.id ? { ...project, name: updated.name, updated_at: updated.updated_at } : project))} />}
  </main>;
}
