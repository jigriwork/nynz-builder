"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowRight, Box, Clock3, ExternalLink, LogOut, Plus, Sparkles, Trash2 } from "lucide-react";
import { NynzBrand } from "@/components/nynz-brand";
import { formatDate } from "@/lib/format-date";

type Project = { id: string; name: string; description: string; status: string; preview_url: string | null; updated_at: string };

export default function DashboardClient({ initialProjects, email }: { initialProjects: Project[]; email: string }) {
  const [projects, setProjects] = useState(initialProjects);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const resumedDraft = useRef(false);

  useEffect(() => {
    if (resumedDraft.current) return;
    resumedDraft.current = true;
    const raw = sessionStorage.getItem("nynz_build_draft");
    if (!raw) return;
    (async () => {
      try {
        const draft = JSON.parse(raw);
        if (draft.projectId) { router.push(`/projects/${draft.projectId}`); return; }
        setBusy(true);
        const projectName = String(draft.prompt || "New NYNZ app").replace(/^(build|create|make)\s+/i, "").split(/[,.!?\n]/)[0].slice(0, 72) || "New NYNZ app";
        const res = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: projectName, description: String(draft.prompt || "").slice(0, 500) }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Could not create project");
        sessionStorage.setItem("nynz_build_draft", JSON.stringify({ ...draft, projectId: body.project.id }));
        router.push(`/projects/${body.project.id}`);
      } catch (error) { setBusy(false); setName(""); console.error(error); }
    })();
  }, [router]);

  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    const res = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const body = await res.json(); setBusy(false);
    if (res.ok) router.push(`/projects/${body.project.id}`);
  }
  async function remove(id: string) {
    if (!confirm("Delete this project and its versions?")) return;
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) setProjects(projects.filter((project) => project.id !== id));
  }
  async function signOut() { await createClient().auth.signOut(); window.location.assign("/"); }

  return <main className="min-h-screen bg-[#070b12] text-[#f4f1e8] selection:bg-[#c7ff4a] selection:text-[#071019]">
    <header className="border-b border-white/[.07] bg-[#090e16]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[70px] max-w-[1320px] items-center justify-between px-5 md:px-8">
        <Link href="/"><NynzBrand className="h-7" /></Link>
        <div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-full border border-white/[.08] bg-white/[.03] px-3 py-2 text-[11px] text-white/40 sm:flex"><span className="grid h-5 w-5 place-items-center rounded-full bg-white/[.07] text-[8px] text-white/55">{email.slice(0, 1).toUpperCase()}</span>{email}</div><button onClick={signOut} aria-label="Sign out" className="grid h-9 w-9 place-items-center rounded-full border border-white/[.08] bg-white/[.03] text-white/35 transition hover:bg-white/[.07] hover:text-white"><LogOut className="h-3.5 w-3.5" /></button></div>
      </div>
    </header>

    <div className="mx-auto max-w-[1320px] px-5 py-12 md:px-8 md:py-16">
      <section className="grid items-end gap-10 border-b border-white/[.08] pb-14 lg:grid-cols-[1fr_420px]">
        <div><p className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.2em] text-[#c7ff4a]"><Sparkles className="h-3 w-3" /> Your workspace</p><h1 className="mt-4 text-5xl font-medium tracking-[-.065em] md:text-7xl">What will you build?</h1><p className="mt-5 max-w-xl text-base leading-7 text-white/40">Open a project or start with a name. You can add the full brief, references and changes inside the builder.</p></div>
        <form onSubmit={create} className="rounded-[22px] border border-white/[.1] bg-[#101823] p-2 shadow-[0_24px_70px_rgba(0,0,0,.3)]"><div className="rounded-[16px] border border-white/[.055] bg-[#0b121b] p-4"><label className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-white/35"><Plus className="h-3 w-3 text-[#c7ff4a]" /> New project</label><div className="flex gap-2"><input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} placeholder="Name your next application" className="h-12 min-w-0 flex-1 rounded-xl border border-white/[.09] bg-white/[.035] px-4 text-sm outline-none placeholder:text-white/22 focus:border-[#c7ff4a]/40" /><button disabled={busy} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#c7ff4a] text-[#071019] transition hover:bg-[#d5ff72] disabled:opacity-40" aria-label="Create project">{busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#071019]/20 border-t-[#071019]" /> : <ArrowRight className="h-4 w-4" />}</button></div></div></form>
      </section>

      <section className="pt-12">
        <div className="mb-6 flex items-center justify-between"><div><h2 className="text-xl font-medium tracking-[-.03em]">Projects</h2><p className="mt-1 text-xs text-white/28">{projects.length ? `${projects.length} application${projects.length === 1 ? "" : "s"}` : "No applications yet"}</p></div><span className="flex items-center gap-2 text-[10px] text-white/28"><Clock3 className="h-3 w-3" /> Sorted by recent</span></div>
        {projects.length === 0 ? <div className="grid min-h-[330px] place-items-center rounded-[24px] border border-dashed border-white/[.11] bg-white/[.018] text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/[.1] bg-white/[.035] text-[#c7ff4a]"><Box className="h-4 w-4" /></span><h3 className="mt-5 text-lg font-medium">Your first build starts here.</h3><p className="mt-2 text-sm text-white/35">Create a project above, or begin from the homepage composer.</p></div></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{projects.map((project) => <article key={project.id} className="group overflow-hidden rounded-[20px] border border-white/[.09] bg-[#0d141e] p-2 transition duration-300 hover:-translate-y-1 hover:border-white/[.17] hover:shadow-[0_25px_70px_rgba(0,0,0,.35)]"><a href={`/projects/${project.id}`}><div className="relative aspect-[16/9] overflow-hidden rounded-[14px] bg-[#131d29]"><div className="absolute inset-x-0 top-0 z-10 flex h-8 items-center gap-1.5 border-b border-black/10 bg-[#ede9df] px-3"><i className="h-1.5 w-1.5 rounded-full bg-[#0b121b]/20" /><i className="h-1.5 w-1.5 rounded-full bg-[#0b121b]/10" /><span className="ml-auto text-[7px] uppercase tracking-[.15em] text-[#0b121b]/30">Preview</span></div>{project.preview_url ? <iframe title={`${project.name} preview`} src={project.preview_url} className="h-full w-full pt-8 pointer-events-none" sandbox="allow-scripts" /> : <div className="grid h-full place-items-center pt-8 text-white/20"><div className="text-center"><Box className="mx-auto h-5 w-5" /><span className="mt-2 block text-[10px]">Preview pending</span></div></div>}<span className="absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-[#c7ff4a] text-[#071019] opacity-0 shadow-lg transition group-hover:opacity-100"><ExternalLink className="h-3.5 w-3.5" /></span></div><div className="p-4 pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-[15px] font-medium">{project.name}</h3><p className="mt-2 flex items-center gap-2 text-[10px] text-white/28"><span className={`h-1.5 w-1.5 rounded-full ${project.status === "ready" ? "bg-[#c7ff4a]" : "bg-amber-300"}`} /><span className="capitalize">{project.status}</span><span>·</span>{formatDate(project.updated_at)}</p></div></div></div></a><div className="border-t border-white/[.06] px-4 py-3"><button onClick={() => remove(project.id)} className="inline-flex items-center gap-2 text-[10px] text-white/20 transition hover:text-red-300"><Trash2 className="h-3 w-3" /> Delete project</button></div></article>)}</div>}
      </section>
    </div>
  </main>;
}
