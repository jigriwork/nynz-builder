"use client";

import { FormEvent, KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  AlertCircle, ArrowLeft, ArrowUp, BarChart3, CheckCircle2, Code2, Coins, Database, Download, ExternalLink, Eye, FileCode2,
  FileImage, FileJson, FileText, Folder, Globe2, History, Home, LayoutGrid, LoaderCircle, Monitor, Paperclip, Pencil,
  Palette, Play, Plus, RefreshCw, RotateCcw, Save, Search, Settings, ShoppingBag, Smartphone, Sparkles, Square, SquareTerminal, Terminal, Users, X,
} from "lucide-react";
import { NynzIcon } from "@/components/nynz-brand";
import { BuildPipeline, ease } from "@/components/nynz-motion";
import { formatDateTime } from "@/lib/format-date";

type Project = { id: string; name: string; description: string; status: string; preview_url: string | null; active_sandbox_id?: string | null; sandbox_expires_at: string | null; last_error: string | null };
type FileRow = { path: string; content: string; updated_at?: string };
type Version = { id: string; label: string; created_at: string };
type Message = { id: string; role: string; content: string; created_at: string };
type Build = { id: string; status: string; prompt?: string; mode?: "create" | "edit" | "restart"; progress: Array<{ at?: string; message?: string; percent?: number }>; plan: { summary?: string; steps?: string[] } | null; error_message: string | null; created_at: string; cancel_requested_at: string | null };
type Asset = { name: string; storageName: string; appPath: string; previewUrl: string | null };
type WorkspaceTab = "preview" | "code" | "terminal" | "logs" | "versions";

const active = new Set(["queued", "planning", "generating", "installing", "running", "validating"]);
const tabs: Array<{ id: WorkspaceTab; label: string; icon: typeof Monitor }> = [
  { id: "preview", label: "Preview", icon: Monitor },
  { id: "code", label: "Code", icon: Code2 },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "logs", label: "Logs", icon: Terminal },
  { id: "versions", label: "History", icon: History },
];
const starters = [
  { icon: BarChart3, title: "Analytics dashboard", prompt: "Build a clean analytics dashboard with KPI cards, a revenue chart, a filterable table of recent orders and a dark mode toggle." },
  { icon: ShoppingBag, title: "Storefront", prompt: "Create a product storefront with a hero, category filters, product cards, a slide-out cart and a simple checkout summary." },
  { icon: Users, title: "Member portal", prompt: "Make a member portal for a sports club with a schedule, member directory with search, and an events RSVP page." },
  { icon: Palette, title: "Portfolio", prompt: "Design a bold personal portfolio with an animated hero, project case-study grid, about section and contact form." },
];
const railButton = "group relative grid h-8 w-8 place-items-center rounded-lg transition";
const railIdle = `${railButton} text-white/40 hover:bg-white/[.06] hover:text-white/80`;

function fileIcon(path: string) {
  if (path.endsWith(".json")) return <FileJson className="h-3.5 w-3.5 shrink-0 text-amber-300/70" />;
  if (path.endsWith(".css")) return <Palette className="h-3.5 w-3.5 shrink-0 text-sky-300/70" />;
  if (path.endsWith(".md") || path.endsWith(".txt")) return <FileText className="h-3.5 w-3.5 shrink-0 text-white/40" />;
  return <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[#c7ff4a]/70" />;
}

export default function BuilderClient({ initialProject, initialFiles, initialVersions, initialMessages, initialBuilds, initialCredits = 0, initialCostPaise = 0 }: { initialProject: Project; initialFiles: FileRow[]; initialVersions: Version[]; initialMessages: Message[]; initialBuilds: Build[]; initialCredits?: number; initialCostPaise?: number }) {
  const [project, setProject] = useState(initialProject);
  const [files, setFiles] = useState(initialFiles);
  const [versions, setVersions] = useState(initialVersions);
  const [messages, setMessages] = useState(initialMessages);
  const [builds, setBuilds] = useState(initialBuilds);
  const [selected, setSelected] = useState(initialFiles[0]?.path || "");
  const [prompt, setPrompt] = useState("");
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [showReference, setShowReference] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingCode, setEditingCode] = useState(false);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminalLines, setTerminalLines] = useState<Array<{ command: string; output: string; exitCode: number | null }>>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetBusy, setAssetBusy] = useState(false);
  const [previewSrc, setPreviewSrc] = useState(initialProject.id === "design-fixture" ? initialProject.preview_url : null);
  const [mounted, setMounted] = useState(false);
  const resumedDraft = useRef(false);
  const conversation = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const codeEditor = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);

  const current = files.find((file) => file.path === selected);
  const running = mounted ? builds.find((build) => active.has(build.status)) : undefined;
  const latest = builds[0];
  const lastProgress = running?.progress?.[running.progress.length - 1]?.message;
  const progressPercent = running?.progress ? [...running.progress].reverse().find((event) => typeof event.percent === "number")?.percent : undefined;
  const failed = project.status === "failed" && !running;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let active = true;
    fetch(`/api/projects/${project.id}/assets`).then((response) => response.json()).then((body) => { if (active && Array.isArray(body.assets)) setAssets(body.assets); }).catch(() => undefined);
    return () => { active = false; };
  }, [project.id]);

  const refresh = useCallback(async () => {
    const [projectResponse, filesResponse, buildsResponse, versionsResponse, messagesResponse] = await Promise.all([
      fetch(`/api/projects/${project.id}`), fetch(`/api/projects/${project.id}/files`),
      fetch(`/api/projects/${project.id}/builds`), fetch(`/api/projects/${project.id}/versions`),
      fetch(`/api/projects/${project.id}/messages`),
    ]);
    if (projectResponse.ok) setProject((await projectResponse.json()).project);
    if (filesResponse.ok) {
      const next = (await filesResponse.json()).files;
      setFiles(next); setSelected((value) => value || next[0]?.path || "");
    }
    if (buildsResponse.ok) setBuilds((await buildsResponse.json()).builds);
    if (versionsResponse.ok) setVersions((await versionsResponse.json()).versions);
    if (messagesResponse.ok) setMessages((await messagesResponse.json()).messages);
  }, [project.id]);

  useEffect(() => {
    if (!running || project.id === "design-fixture") return;
    const timer = setInterval(refresh, 2_500);
    return () => clearInterval(timer);
  }, [running, refresh, project.id]);

  useEffect(() => {
    if (project.id === "design-fixture") { setPreviewSrc(project.preview_url); return; }
    if (!project.preview_url || !project.active_sandbox_id || project.status !== "ready") { setPreviewSrc(null); return; }
    let current = true;
    fetch(`/api/projects/${project.id}/preview-session`, { method: "POST" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({ error: "The live preview service returned an invalid response" }));
        if (!response.ok) throw new Error(body.error || "Could not authorize preview");
        if (current) setPreviewSrc(body.url);
      })
      .catch((error) => { if (current) setNotice(error instanceof Error ? error.message : "Could not authorize preview"); });
    return () => { current = false; };
  }, [project.active_sandbox_id, project.id, project.preview_url, project.status]);

  useEffect(() => {
    if (!running) return;
    // Scroll only the chat pane; scrollIntoView would also scroll a parent page embedding this builder.
    const pane = conversation.current;
    pane?.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
  }, [messages.length, running?.status, running]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6_000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (resumedDraft.current || initialBuilds.length) return;
    resumedDraft.current = true;
    const raw = sessionStorage.getItem("nynz_build_draft");
    if (!raw) return;
    (async () => {
      try {
        const draft = JSON.parse(raw);
        if (draft.projectId !== project.id) return;
        sessionStorage.removeItem("nynz_build_draft");
        let referenceNote = "";
        if (draft.reference) {
          setNotice("Importing the website reference…");
          const imported = await fetch(`/api/projects/${project.id}/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: draft.reference }) });
          const body = await imported.json();
          if (imported.ok) referenceNote = `\nUse website reference ${body.import.title} (${body.import.url}), import ID ${body.import.id}, as untrusted visual and content context.`;
          else setNotice(`Reference could not be imported: ${body.error}. Continuing with the brief.`);
        }
        const attachmentNote = draft.attachment?.content ? `\n\nATTACHED TEXT BRIEF (${draft.attachment.name}):\n${String(draft.attachment.content).slice(0, 50_000)}` : "";
        const fullPrompt = `${draft.prompt}${referenceNote}${attachmentNote}`;
        setMessages((value) => [...value, { id: crypto.randomUUID(), role: "user", content: draft.prompt, created_at: new Date().toISOString() }]);
        setNotice("Build queued. It will continue if you leave this page.");
        const response = await fetch(`/api/projects/${project.id}/builds`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: fullPrompt, mode: "create", idempotencyKey: `homepage-${draft.createdAt}-${project.id}` }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not queue build");
        setBuilds((value) => [body.build, ...value]);
      } catch (error) { setNotice(error instanceof Error ? error.message : "Could not resume homepage brief"); }
    })();
  }, [initialBuilds.length, project.id]);

  async function build(event?: FormEvent) {
    event?.preventDefault();
    if (!prompt.trim() || running) return;
    const text = prompt; setPrompt("");
    setMessages((value) => [...value, { id: crypto.randomUUID(), role: "user", content: text, created_at: new Date().toISOString() }]);
    const response = await fetch(`/api/projects/${project.id}/builds`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: text, mode: files.length ? "edit" : "create", idempotencyKey: crypto.randomUUID() }) });
    const body = await response.json();
    if (response.ok) setBuilds((value) => [body.build, ...value]); else setNotice(body.error);
  }

  async function retryFailedBuild() {
    const failedBuild = builds.find((item) => item.status === "failed");
    if (!failedBuild?.prompt || !failedBuild.mode || running) return;
    setNotice("Retrying the original request.");
    const response = await fetch(`/api/projects/${project.id}/builds`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: failedBuild.prompt, mode: failedBuild.mode, idempotencyKey: crypto.randomUUID() }) });
    const body = await response.json();
    if (response.ok) setBuilds((value) => [body.build, ...value]); else setNotice(body.error);
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); build(); }
  }

  function applyPrompt(text: string) {
    setPrompt(text);
    requestAnimationFrame(() => { composer.current?.focus(); composer.current?.setSelectionRange(text.length, text.length); });
  }

  async function saveFile(content: string) {
    if (!current) return;
    const response = await fetch(`/api/projects/${project.id}/files`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: [{ path: current.path, content }] }) });
    if (response.ok) setFiles((value) => value.map((file) => file.path === current.path ? { ...file, content } : file));
    else setNotice((await response.json()).error);
  }

  async function importUrl() {
    setNotice("Importing reference…");
    const response = await fetch(`/api/projects/${project.id}/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    const body = await response.json();
    if (response.ok) {
      setPrompt((value) => `${value}\nUse this imported reference (${body.import.title}, ${body.import.url}) for content and visual direction. Reference import ID: ${body.import.id}`.trim());
      setUrl(""); setShowReference(false); setNotice("Reference added to your next request.");
    } else setNotice(body.error);
  }

  async function uploadAsset(file: File) {
    if (!file || assetBusy) return;
    setAssetBusy(true);
    const form = new FormData();
    form.set("file", file);
    const response = await fetch(`/api/projects/${project.id}/assets`, { method: "POST", body: form });
    const body = await response.json();
    if (response.ok) { setAssets((value) => [body.asset, ...value]); setNotice(`${body.asset.name} uploaded. Mention it in your next request so NYNZ can place it.`); }
    else setNotice(body.error || "Could not upload this file");
    if (assetInput.current) assetInput.current.value = "";
    setAssetBusy(false);
  }

  async function removeAsset(asset: Asset) {
    const response = await fetch(`/api/projects/${project.id}/assets`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ storageName: asset.storageName }) });
    if (response.ok) setAssets((value) => value.filter((item) => item.storageName !== asset.storageName));
    else setNotice((await response.json()).error || "Could not remove this file");
  }

  async function saveVersion() {
    const label = window.prompt("Version label", "Manual checkpoint");
    if (!label) return;
    const response = await fetch(`/api/projects/${project.id}/versions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label }) });
    if (response.ok) { setNotice("Checkpoint saved"); refresh(); } else setNotice((await response.json()).error);
  }

  async function restore(id: string) {
    if (!confirm("Restore this version? Current files will be replaced.")) return;
    const response = await fetch(`/api/projects/${project.id}/versions/${id}/restore`, { method: "POST" });
    if (response.ok) { setNotice("Version restored. Restart the preview to run it."); refresh(); } else setNotice((await response.json()).error);
  }

  async function cancel() {
    if (!running) return;
    await fetch(`/api/builds/${running.id}/cancel`, { method: "POST" });
    setNotice("Cancellation requested"); refresh();
  }

  async function restart() {
    const response = await fetch(`/api/projects/${project.id}/sandbox`, { method: "POST" });
    if (response.ok) { setNotice("Preview restart queued"); refresh(); } else setNotice((await response.json()).error);
  }

  async function runTerminal(event?: FormEvent) {
    event?.preventDefault();
    const command = terminalCommand.trim();
    if (!command || terminalBusy) return;
    setTerminalCommand("");
    setTerminalBusy(true);
    const response = await fetch(`/api/projects/${project.id}/terminal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command }) });
    const body = await response.json();
    setTerminalLines((value) => [...value, { command, output: response.ok ? [body.stdout, body.stderr].filter(Boolean).join("\n") : body.error || "Command failed", exitCode: response.ok ? body.exitCode : null }]);
    setTerminalBusy(false);
  }

  const logLines = useMemo(() => latest?.progress || [], [latest]);
  const lineCount = Math.max(1, (current?.content.match(/\n/g)?.length || 0) + 1);
  const syntaxLanguage = current?.path.endsWith(".tsx") || current?.path.endsWith(".ts") ? "tsx" : current?.path.endsWith(".jsx") || current?.path.endsWith(".js") ? "jsx" : current?.path.endsWith(".css") ? "css" : current?.path.endsWith(".json") ? "json" : current?.path.endsWith(".html") ? "markup" : "text";

  return <main className="fixed inset-0 flex h-[100dvh] w-full flex-col overflow-hidden overscroll-none bg-[#080c13] text-[#f4f1e8] selection:bg-[#c7ff4a] selection:text-[#071019]">
    <header className="relative flex h-14 shrink-0 items-center border-b border-white/[.07] bg-[#0a0f17] px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <a href="/dashboard" aria-label="Back to projects" className="grid h-8 w-8 place-items-center rounded-lg text-white/45 transition hover:bg-white/[.06] hover:text-white"><ArrowLeft className="h-4 w-4" /></a>
        <NynzIcon className="h-7 w-7" />
        <span className="hidden text-white/20 sm:block">/</span>
        <input defaultValue={project.name} aria-label="Project name" onBlur={async (event) => { await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: event.target.value }) }); }} className="min-w-0 max-w-[170px] truncate rounded-md bg-transparent px-1.5 py-1 text-[13px] font-medium outline-none transition hover:bg-white/[.04] focus:bg-white/[.06] sm:max-w-[260px]" />
      </div>
      <AnimatePresence>{running && <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .35, ease }} className="absolute left-1/2 hidden -translate-x-1/2 lg:block"><BuildPipeline status={running?.status || latest?.status} failed={failed} compact progressPercent={progressPercent} /></motion.div>}</AnimatePresence>
      <div className="ml-auto flex items-center gap-1.5">
        <span title={`${initialCredits.toLocaleString()} token credits used. Provider charges are shown in INR.`} className="hidden h-8 items-center gap-1.5 rounded-lg border border-white/[.07] bg-white/[.025] px-2.5 text-[10px] text-white/50 md:flex"><Coins className="h-3 w-3 text-[#c7ff4a]" />₹{(initialCostPaise / 100).toFixed(2)}</span>
        <span className={`mr-1 hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] sm:flex ${running ? "lg:hidden" : ""} ${running ? "border-[#c7ff4a]/20 bg-[#c7ff4a]/[.08] text-[#c7ff4a]" : failed ? "border-red-400/20 bg-red-400/[.08] text-red-300" : project.status === "ready" ? "border-[#c7ff4a]/15 text-[#c7ff4a]/85" : "border-white/[.08] text-white/50"}`}>
          {running ? <LoaderCircle className="h-3 w-3 animate-spin" /> : failed ? <AlertCircle className="h-3 w-3" /> : project.status === "ready" ? <span className="relative flex h-1.5 w-1.5"><span className="absolute inset-0 animate-ping rounded-full bg-[#c7ff4a]/60" /><span className="h-1.5 w-1.5 rounded-full bg-[#c7ff4a]" /></span> : <CheckCircle2 className="h-3 w-3" />}
          <span className="capitalize">{running?.status || (project.status === "ready" ? "Live" : project.status)}</span>
        </span>
        <button onClick={saveVersion} className="hidden h-8 items-center gap-2 rounded-lg px-3 text-[11px] text-white/55 transition hover:bg-white/[.06] hover:text-white sm:flex"><Save className="h-3.5 w-3.5" /> Checkpoint</button>
        <a href={`/api/projects/${project.id}/export`} className="group flex h-8 items-center gap-2 rounded-lg bg-[#c7ff4a] px-3.5 text-[11px] font-semibold text-[#071019] shadow-[0_0_24px_rgba(199,255,74,.18)] transition hover:bg-[#d5ff72] hover:shadow-[0_0_32px_rgba(199,255,74,.32)]"><Download className="h-3.5 w-3.5 transition-transform group-hover:translate-y-px" /><span className="hidden sm:inline">Export</span></a>
      </div>
      {running && <span className="absolute inset-x-0 bottom-0 h-px overflow-hidden"><span className="nynz-scan absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-[#c7ff4a] to-transparent" /></span>}
    </header>

    <div className="grid min-h-0 min-w-0 flex-1 overflow-hidden grid-rows-[minmax(260px,46%)_minmax(0,1fr)] lg:grid-cols-[52px_400px_minmax(0,1fr)] lg:grid-rows-1">
      <nav aria-label="Project tools" className="hidden min-h-0 flex-col items-center gap-1 border-r border-white/[.07] bg-[#090d14] py-2.5 lg:flex">
        <a href="/dashboard" aria-label="Projects" className={railIdle}><LayoutGrid className="h-4 w-4" /><RailHint>Projects</RailHint></a>
        <a href="/dashboard" aria-label="New project" className={railIdle}><Plus className="h-4 w-4" /><RailHint>New project</RailHint></a>
        <span className="my-1.5 h-px w-6 bg-white/[.07]" />
        <Link href="/" aria-label="Home" className={railIdle}><Home className="h-4 w-4" /><RailHint>Home</RailHint></Link>
        <button aria-label="Search project" onClick={() => setTab("code")} className={railIdle}><Search className="h-4 w-4" /><RailHint>Search files</RailHint></button>
        {([["code", Folder, "Project files"], ["terminal", SquareTerminal, "Sandbox terminal"], ["versions", History, "Build history"], ["logs", Terminal, "Build logs"]] as const).map(([id, Icon, label]) => <button key={id} aria-label={label} onClick={() => setTab(id)} className={`${railButton} ${tab === id ? "bg-white/[.07] text-[#c7ff4a]" : "text-white/40 hover:bg-white/[.06] hover:text-white/80"}`}>{tab === id && <motion.span layoutId="rail-active" className="absolute -left-2.5 h-4 w-0.5 rounded-full bg-[#c7ff4a]" />}<Icon className="h-4 w-4" /><RailHint>{label}</RailHint></button>)}
        <button aria-label="Project settings" onClick={() => setShowSettings(true)} className={`mt-auto ${railIdle}`}><Settings className="h-4 w-4" /><RailHint>Project settings</RailHint></button>
        <NynzIcon className="mt-1 h-7 w-7 rounded-full" />
      </nav>

      <aside className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-white/[.07] bg-[#0b1019] lg:border-b-0 lg:border-r">
        <div className="flex h-11 shrink-0 items-center border-b border-white/[.06] px-4">
          <Sparkles className="mr-2 h-3.5 w-3.5 text-[#c7ff4a]" />
          <span className="text-[12px] font-medium">Build with NYNZ</span>
          <span className="ml-auto text-[10px] text-white/40">{messages.length} message{messages.length === 1 ? "" : "s"}</span>
        </div>

        <div ref={conversation} className="nynz-scrollbar min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 py-5">
          {messages.length === 0 && <div className="flex min-h-full flex-col">
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6, ease }} className="pt-4 text-center">
              <div className="relative mx-auto h-14 w-14">
                <span className="nynz-breathe absolute -inset-4 rounded-full bg-[#c7ff4a]/15 blur-xl" />
                <span className="absolute -inset-1 animate-[spin_8s_linear_infinite] rounded-2xl bg-[conic-gradient(from_0deg,transparent,rgba(199,255,74,.6),transparent_40%)] opacity-70" />
                <NynzIcon className="relative h-14 w-14 rounded-2xl" />
              </div>
              <h2 className="mt-6 text-xl font-medium tracking-[-.04em]">What should we build?</h2>
              <p className="mx-auto mt-2 max-w-[290px] text-[12px] leading-5 text-white/50">Describe the product in plain language. You’ll watch the plan, code and live preview come together.</p>
            </motion.div>
            <div className="mt-7 grid gap-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-[.16em] text-white/35">Start from an idea</p>
              {starters.map(({ icon: Icon, title, prompt: text }, index) => <motion.button key={title} type="button" onClick={() => applyPrompt(text)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5, delay: .15 + index * .07, ease }} className="group flex items-start gap-3 rounded-xl border border-white/[.07] bg-white/[.02] p-3 text-left transition hover:-translate-y-px hover:border-[#c7ff4a]/25 hover:bg-[#c7ff4a]/[.04]">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[.05] text-white/60 transition group-hover:bg-[#c7ff4a]/15 group-hover:text-[#c7ff4a]"><Icon className="h-4 w-4" /></span>
                <span className="min-w-0"><span className="block text-[12px] font-medium text-white/85">{title}</span><span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-white/45">{text}</span></span>
              </motion.button>)}
            </div>
          </div>}

          <div className="space-y-5">
            <AnimatePresence initial={false}>{messages.map((message) => <motion.div key={message.id} initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .4, ease }} className={message.role === "user" ? "ml-8" : "mr-3"}>
              <div className={`mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.14em] text-white/40 ${message.role === "user" ? "justify-end" : ""}`}>{message.role === "user" ? "You" : <><NynzIcon className="h-4 w-4" /> NYNZ</>}</div>
              <div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[13px] leading-[1.6] ${message.role === "user" ? "rounded-tr-md bg-[#1b2433] text-white/90" : "rounded-tl-md border border-white/[.07] bg-white/[.025] text-white/70"}`}>{message.content}</div>
            </motion.div>)}</AnimatePresence>

            <AnimatePresence>{running && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mr-12"><div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.14em] text-white/40"><NynzIcon className="h-4 w-4" /> NYNZ</div><div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-white/[.07] bg-white/[.025] px-4 py-3 text-[11px] text-white/50"><span className="flex gap-1">{[0, 1, 2].map((item) => <i key={item} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#c7ff4a]" style={{ animationDelay: `${item * 120}ms` }} />)}</span>{lastProgress || "Working on your request"}</div></motion.div>}</AnimatePresence>

            {!running && project.status === "ready" && messages[messages.length - 1]?.role === "assistant" && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap gap-1.5">{[
              ["Refine the design", "Refine the visual design so it feels more distinctive, polished, and professionally art-directed. Preserve all working functionality."],
              ["Improve mobile", "Review the complete mobile experience and improve spacing, navigation, touch targets, and responsive layouts."],
              ["Add a feature", "I want to add another feature. Ask me what workflow I need before changing the application."],
            ].map(([label, text]) => <button key={label} type="button" onClick={() => applyPrompt(text)} className="rounded-full border border-white/[.08] bg-white/[.025] px-2.5 py-1.5 text-[9px] text-white/50 transition hover:border-[#c7ff4a]/25 hover:bg-[#c7ff4a]/[.05] hover:text-white">{label}</button>)}</motion.div>}

            {latest?.plan && <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5, ease }} className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
              <div className="flex items-center justify-between"><p className="flex items-center gap-2 text-[11px] font-medium"><span className="grid h-5 w-5 place-items-center rounded-md bg-[#c7ff4a]/10 text-[#c7ff4a]"><Sparkles className="h-3 w-3" /></span>Build plan</p><span className="text-[10px] text-white/40">{latest.plan.steps?.length || 0} steps</span></div>
              {latest.plan.summary && <p className="mt-3 text-[12px] leading-5 text-white/60">{latest.plan.summary}</p>}
              <ol className="mt-3 space-y-1.5">{latest.plan.steps?.map((step, index) => <motion.li key={`${step}-${index}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .4, delay: .1 + index * .08, ease }} className="flex gap-3 rounded-lg px-2 py-1.5 text-[11px] leading-4 text-white/60 transition hover:bg-white/[.03]"><span className="mt-px font-mono text-[#c7ff4a]/80">{String(index + 1).padStart(2, "0")}</span><span>{step}</span></motion.li>)}</ol>
            </motion.section>}

            <AnimatePresence>{running && <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: .4, ease }} className="nynz-edge relative overflow-hidden rounded-2xl bg-[#0d1520] p-4">
              <div className="flex items-center gap-2"><span className="text-[11px] font-medium text-[#c7ff4a]">Building your app</span><button onClick={cancel} className="ml-auto rounded-md px-2 py-1 text-[10px] text-white/45 transition hover:bg-red-400/10 hover:text-red-300">Stop</button></div>
              <div className="mt-3"><BuildPipeline status={running.status} vertical progressPercent={progressPercent} /></div>
              <AnimatePresence mode="wait"><motion.p key={lastProgress || "wait"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="mt-3 border-t border-white/[.06] pt-3 font-mono text-[10px] leading-4 text-white/50">→ {lastProgress || "Preparing the next step…"}</motion.p></AnimatePresence>
            </motion.section>}</AnimatePresence>

            {project.last_error && !running && <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border border-red-400/20 bg-red-400/[.04] p-4"><div className="flex items-center gap-2 text-[11px] font-medium text-red-300"><AlertCircle className="h-3.5 w-3.5" /> Build needs attention</div><p className="mt-2 line-clamp-3 break-all font-mono text-[10px] leading-4 text-white/50">{project.last_error}</p><div className="mt-3 flex gap-2"><button onClick={() => setTab("logs")} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] text-white/55 transition hover:bg-white/[.06] hover:text-white"><Terminal className="h-3 w-3" /> View logs</button><button onClick={retryFailedBuild} className="inline-flex items-center gap-1.5 rounded-lg bg-white/[.06] px-2.5 py-1.5 text-[10px] text-white/75 transition hover:bg-white/[.1]"><RotateCcw className="h-3 w-3" /> Retry original request</button></div></motion.section>}
          </div>
        </div>

        <AnimatePresence>{notice && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: .25 }} role="status" className="absolute inset-x-3 bottom-[148px] z-10 flex items-center gap-2 rounded-xl border border-white/[.1] bg-[#141c28]/95 px-3 py-2.5 text-[11px] text-white/75 shadow-[0_12px_40px_rgba(0,0,0,.4)] backdrop-blur-xl"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#c7ff4a]" /><span className="min-w-0 flex-1">{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss" className="text-white/40 hover:text-white"><X className="h-3.5 w-3.5" /></button></motion.div>}</AnimatePresence>

        <form onSubmit={build} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) uploadAsset(file); }} className="shrink-0 border-t border-white/[.06] p-3">
          <AnimatePresence>{showReference && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden"><div className="mb-2 flex gap-1.5"><div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[.09] bg-[#0a0f17] px-3"><Globe2 className="h-3.5 w-3.5 shrink-0 text-[#c7ff4a]/70" /><input value={url} onChange={(event) => setUrl(event.target.value)} autoFocus placeholder="Paste a public website URL" className="h-9 min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-white/35" /></div><button type="button" onClick={importUrl} disabled={!url} className="rounded-xl bg-white/[.08] px-3 text-[11px] text-white/75 transition hover:bg-white/[.12] disabled:opacity-30">Add</button></div></motion.div>}</AnimatePresence>
          {assets.length > 0 && <div className="nynz-scrollbar mb-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">{assets.map((asset) => <span key={asset.storageName} className="group flex max-w-full items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.035] py-1 pl-1.5 pr-1 text-[9px] text-white/55">{asset.previewUrl && /\.(png|jpe?g|webp|gif|svg)$/i.test(asset.name) ? <Image unoptimized src={asset.previewUrl} alt="" width={20} height={20} className="h-5 w-5 rounded object-cover" /> : <FileImage className="h-3 w-3 text-[#c7ff4a]/70" />}<span className="max-w-[180px] truncate">{asset.name}</span><button type="button" onClick={() => removeAsset(asset)} aria-label={`Remove ${asset.name}`} className="grid h-5 w-5 place-items-center rounded text-white/30 hover:bg-white/[.07] hover:text-white"><X className="h-3 w-3" /></button></span>)}</div>}
          <div className="nynz-composer relative rounded-2xl bg-[#121a26] p-2 shadow-[0_10px_40px_rgba(0,0,0,.25)]" style={{ animation: "none" }}>
            <textarea ref={composer} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onComposerKey} placeholder={files.length ? "Ask for a change…" : "Describe your app…"} rows={3} className="w-full resize-none bg-transparent px-2 py-1.5 text-[13px] leading-5 outline-none placeholder:text-white/35" />
            <div className="mt-1 flex items-center gap-1">
              <button type="button" onClick={() => setShowReference((value) => !value)} aria-label="Add website reference" title="Add website reference" className={`grid h-8 w-8 place-items-center rounded-lg transition ${showReference ? "bg-[#c7ff4a]/[.12] text-[#c7ff4a]" : "text-white/45 hover:bg-white/[.06] hover:text-white/80"}`}><Globe2 className="h-4 w-4" /></button>
              <input ref={assetInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,font/woff,font/woff2,font/ttf,application/pdf,text/plain,text/csv,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadAsset(file); }} />
              <button type="button" onClick={() => assetInput.current?.click()} disabled={assetBusy} aria-label="Upload project file" title="Upload logo, image or project file" className="grid h-8 w-8 place-items-center rounded-lg text-white/45 transition hover:bg-white/[.06] hover:text-white/80 disabled:opacity-35">{assetBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}</button>
              <span className="flex-1 truncate px-1 text-[10px] text-white/30"><kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift + Enter</kbd> for a new line</span>
              {running ? <button type="button" onClick={cancel} aria-label="Stop build" className="grid h-8 w-8 place-items-center rounded-lg bg-white text-[#111216] transition hover:bg-white/85"><Square className="h-3 w-3 fill-current" /></button> : <motion.button whileTap={{ scale: .9 }} disabled={!prompt.trim()} aria-label="Send request" className="grid h-8 w-8 place-items-center rounded-lg bg-[#c7ff4a] text-[#071019] shadow-[0_0_18px_rgba(199,255,74,.25)] transition hover:bg-[#d5ff72] disabled:bg-white/[.07] disabled:text-white/25 disabled:shadow-none"><ArrowUp className="h-4 w-4" /></motion.button>}
            </div>
          </div>
        </form>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#0a0f17]">
        <div className="flex h-11 shrink-0 items-center border-b border-white/[.06] bg-[#0b111a] px-2.5">
          <nav className="flex items-center gap-0.5">{tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`relative flex h-8 items-center gap-2 rounded-lg px-3 text-[11px] transition ${tab === id ? "text-white" : "text-white/45 hover:text-white/80"}`}>{tab === id && <motion.span layoutId="workspace-tab" transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-lg border border-white/[.08] bg-white/[.07]" />}<Icon className="relative h-3.5 w-3.5" /><span className="relative hidden sm:inline">{label}</span>{id === "code" && files.length > 0 && <span className="relative rounded bg-white/[.08] px-1 text-[9px] text-white/55">{files.length}</span>}</button>)}</nav>
          {tab === "preview" && <div className="mx-auto hidden h-7 w-[min(34vw,380px)] items-center rounded-lg border border-white/[.07] bg-[#080c13] px-3 text-[10px] text-white/45 xl:flex">{previewSrc ? <span className="mr-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c7ff4a] shadow-[0_0_8px_#c7ff4a]" /> : <Globe2 className="mr-2 h-3 w-3 shrink-0" />}<span className="truncate">{previewSrc ? "Secure live preview" : "Preview starts after the first successful build"}</span></div>}
          <div className="ml-auto flex items-center gap-1">
            {tab === "preview" && <>
              <div className="flex rounded-lg border border-white/[.07] p-0.5">{([["desktop", Monitor], ["mobile", Smartphone]] as const).map(([id, Icon]) => <button key={id} aria-label={`${id} preview`} aria-pressed={device === id} onClick={() => setDevice(id)} className={`grid h-6 w-7 place-items-center rounded-md transition ${device === id ? "bg-white/[.1] text-white" : "text-white/40 hover:text-white/75"}`}><Icon className="h-3 w-3" /></button>)}</div>
            </>}
            {tab === "preview" && previewSrc && <a href={previewSrc} target="_blank" rel="noreferrer" className="grid h-7 w-7 place-items-center rounded-lg text-white/40 transition hover:bg-white/[.06] hover:text-white/80" aria-label="Open preview in new tab"><ExternalLink className="h-3.5 w-3.5" /></a>}
            <button onClick={restart} className="group flex h-7 items-center gap-2 rounded-lg px-2 text-[10px] text-white/45 transition hover:bg-white/[.06] hover:text-white/80"><RefreshCw className="h-3.5 w-3.5 transition-transform duration-500 group-hover:rotate-180" /><span className="hidden sm:inline">Restart</span></button>
          </div>
        </div>

        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .22, ease }} className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
              {tab === "preview" && <div className="nynz-dots h-full bg-[#0c121c] p-2.5 sm:p-4">
                <motion.div layout transition={{ type: "spring", stiffness: 260, damping: 30 }} className={`mx-auto h-full ${device === "mobile" ? "max-w-[400px]" : "max-w-none"}`}>
                  {previewSrc ? <div className={`flex h-full flex-col overflow-hidden border border-white/[.08] bg-white shadow-[0_24px_70px_rgba(0,0,0,.45)] ${device === "mobile" ? "rounded-[28px] border-[6px] border-[#1a2230]" : "rounded-xl"}`}>
                    <iframe key={previewSrc} src={previewSrc} title="Application preview" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-same-origin" referrerPolicy="no-referrer" className="h-full w-full bg-white" />
                  </div> : <PreviewPlaceholder running={Boolean(running)} status={running?.status} progress={lastProgress} error={project.last_error} />}
                </motion.div>
              </div>}

              {tab === "code" && <div className="grid h-full min-h-0 grid-cols-[180px_minmax(0,1fr)] sm:grid-cols-[240px_minmax(0,1fr)]">
                <aside className="nynz-scrollbar min-h-0 overflow-y-auto border-r border-white/[.06] bg-[#0a0f17] py-2"><div className="flex h-8 items-center px-3 text-[10px] font-medium uppercase tracking-[.13em] text-white/40">Explorer <span className="ml-auto rounded bg-white/[.06] px-1.5 font-mono text-white/50">{files.length}</span></div>{files.map((file) => <button key={file.path} onClick={() => setSelected(file.path)} className={`relative flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] transition ${selected === file.path ? "bg-white/[.06] text-white/90" : "text-white/50 hover:bg-white/[.03] hover:text-white/80"}`}>{selected === file.path && <motion.span layoutId="file-active" className="absolute inset-y-0 left-0 w-0.5 bg-[#c7ff4a]" />}{fileIcon(file.path)}<span className="truncate">{file.path}</span></button>)}{files.length === 0 && <p className="px-3 py-4 text-[11px] leading-5 text-white/40">Files appear here as NYNZ writes them.</p>}</aside>
                <div className="min-h-0 min-w-0 overflow-hidden bg-[#080c13]">{current ? <div className="flex h-full min-h-0 flex-col overflow-hidden"><div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[.06] px-3 font-mono text-[10px] text-white/55">{fileIcon(current.path)}{current.path}<button onClick={() => setEditingCode((value) => !value)} className="ml-auto flex h-6 items-center gap-1.5 rounded-md border border-white/[.08] px-2 font-sans text-[9px] text-white/55 transition hover:bg-white/[.06] hover:text-white">{editingCode ? <><Eye className="h-3 w-3" /> Preview</> : <><Pencil className="h-3 w-3" /> Edit</>}</button></div>{editingCode ? <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden"><div ref={gutter} aria-hidden onWheel={(event) => { const editor = codeEditor.current; if (!editor) return; editor.scrollTop += event.deltaY; editor.scrollLeft += event.deltaX; }} className="w-12 shrink-0 select-none overflow-hidden border-r border-white/[.04] py-4 pr-3 text-right font-mono text-[11px] leading-5 text-white/20">{Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}</div><textarea ref={codeEditor} value={current.content} onScroll={(event) => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }} onChange={(event) => setFiles((value) => value.map((file) => file.path === current.path ? { ...file, content: event.target.value } : file))} onBlur={(event) => saveFile(event.target.value)} spellCheck={false} wrap="off" className="nynz-scrollbar h-full min-h-0 min-w-0 w-full flex-1 touch-pan-x touch-pan-y resize-none overflow-auto overscroll-contain whitespace-pre bg-transparent p-4 pl-4 font-mono text-[12px] leading-5 text-[#d8decf] outline-none [scrollbar-gutter:stable]" /></div> : <div className="nynz-scrollbar min-h-0 flex-1 overflow-auto"><SyntaxHighlighter language={syntaxLanguage} style={vscDarkPlus} showLineNumbers wrapLongLines={false} customStyle={{ margin: 0, minHeight: "100%", background: "#080c13", padding: "16px 18px", fontSize: "12px", lineHeight: "1.7" }} lineNumberStyle={{ minWidth: "2.8em", paddingRight: "1.2em", color: "rgba(255,255,255,.18)" }}>{current.content}</SyntaxHighlighter></div>}</div> : <EmptyPanel icon={Code2} title="No files yet" text="Once the first build runs, every generated file is editable here." />}</div>
              </div>}

              {tab === "terminal" && <div className="flex h-full min-h-0 flex-col bg-[#06090e] font-mono text-[11px]"><div className="flex h-9 shrink-0 items-center border-b border-white/[.06] px-4 text-white/40"><span className="mr-2 h-1.5 w-1.5 rounded-full bg-[#c7ff4a]" />Sandbox terminal <span className="ml-auto">/home/user/app</span></div><div className="nynz-scrollbar min-h-0 flex-1 overflow-y-auto p-4 leading-5"><p className="text-white/35">Commands run only inside this project&apos;s isolated preview sandbox.</p>{terminalLines.map((line, index) => <div key={`${line.command}-${index}`} className="mt-4"><p><span className="text-[#c7ff4a]">nynz@app</span><span className="text-white/35">:</span><span className="text-sky-300">~/app</span><span className="text-white/55">$</span> <span className="text-white/85">{line.command}</span></p>{line.output && <pre className={`mt-1 whitespace-pre-wrap break-words ${line.exitCode === 0 ? "text-white/65" : "text-red-300"}`}>{line.output}</pre>}</div>)}{terminalBusy && <p className="mt-4 animate-pulse text-white/40">Running command...</p>}</div><form onSubmit={runTerminal} className="flex shrink-0 items-center gap-2 border-t border-white/[.06] p-3"><span className="text-[#c7ff4a]">$</span><input value={terminalCommand} onChange={(event) => setTerminalCommand(event.target.value)} placeholder="npm run build" aria-label="Terminal command" className="h-9 min-w-0 flex-1 rounded-lg border border-white/[.07] bg-white/[.025] px-3 text-white outline-none focus:border-[#c7ff4a]/30" /><button disabled={!terminalCommand.trim() || terminalBusy} className="grid h-9 w-9 place-items-center rounded-lg bg-[#c7ff4a] text-[#071019] disabled:opacity-30" aria-label="Run command"><Play className="h-3.5 w-3.5 fill-current" /></button></form></div>}

              {tab === "logs" && <div className="nynz-scrollbar h-full overflow-auto bg-[#070a10] p-4 font-mono text-[11px] leading-6">
                {logLines.length === 0 && !latest?.error_message ? <EmptyPanel icon={Terminal} title="Quiet for now" text="Build events stream here live while NYNZ plans, writes, installs and validates your app." /> : <>
                  {logLines.map((event, index) => <motion.div key={index} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .25, delay: Math.min(index * .03, .4) }} className="flex gap-3 rounded px-2 hover:bg-white/[.03]"><span className="shrink-0 text-white/30">{event.at ? event.at.slice(11, 19) : "--:--:--"}</span><span className="text-[#c7ff4a]/70">›</span><span className="text-white/75">{event.message}</span></motion.div>)}
                  {latest?.error_message && <div className="mt-2 flex gap-3 rounded border border-red-400/20 bg-red-400/[.05] px-2 py-1 text-red-300"><span className="shrink-0">ERROR</span><span className="whitespace-pre-wrap">{latest.error_message}</span></div>}
                  {running && <div className="flex gap-3 px-2 text-white/40"><span className="inline-block h-3.5 w-2 translate-y-1 animate-pulse bg-[#c7ff4a]/70" /></div>}
                </>}
              </div>}

              {tab === "versions" && <div className="nynz-scrollbar h-full overflow-y-auto bg-[#0a0f17] p-6"><div className="mx-auto max-w-2xl"><div className="mb-6 flex items-end justify-between"><div><h2 className="text-lg font-medium tracking-[-.03em]">Checkpoints</h2><p className="mt-1 text-[12px] text-white/50">Return to any known-good version of your source.</p></div><button onClick={saveVersion} className="flex items-center gap-2 rounded-lg border border-white/[.1] px-3 py-2 text-[11px] text-white/75 transition hover:border-[#c7ff4a]/30 hover:text-[#c7ff4a]"><Save className="h-3.5 w-3.5" /> Save now</button></div>
                {versions.length > 0 ? <ol className="relative space-y-3 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-white/[.08]">{versions.map((version, index) => <motion.li key={version.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .05, ease }} className="relative flex items-center gap-4"><span className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border ${index === 0 ? "border-[#c7ff4a]/40 bg-[#c7ff4a]/10 text-[#c7ff4a]" : "border-white/[.1] bg-[#0a0f17] text-white/45"}`}><History className="h-3.5 w-3.5" /></span><div className="flex flex-1 items-center rounded-xl border border-white/[.07] bg-white/[.02] p-3.5 transition hover:border-white/[.14]"><div><p className="text-[12px] font-medium">{version.label}{index === 0 && <span className="ml-2 rounded bg-[#c7ff4a]/10 px-1.5 py-0.5 text-[9px] text-[#c7ff4a]">Latest</span>}</p><p className="mt-1 text-[10px] text-white/45">{formatDateTime(version.created_at)}</p></div><button onClick={() => restore(version.id)} className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/[.09] px-2.5 py-1.5 text-[10px] text-white/60 transition hover:bg-white/[.06] hover:text-white"><RotateCcw className="h-3 w-3" /> Restore</button></div></motion.li>)}</ol> : <div className="rounded-2xl border border-dashed border-white/[.1] py-4"><EmptyPanel icon={History} title="No checkpoints yet" text="Save a checkpoint after a successful build to create a restore point." /></div>}
              </div></div>}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>
    </div>
    <AnimatePresence>{showSettings && <ProjectSettings projectId={project.id} onClose={() => setShowSettings(false)} onNotice={setNotice} />}</AnimatePresence>
  </main>;
}

function RailHint({ children }: { children: ReactNode }) {
  return <span className="pointer-events-none absolute left-10 z-50 w-max translate-x-1 rounded-md border border-white/[.1] bg-[#151d29] px-2 py-1 text-[9px] font-medium text-white/80 opacity-0 shadow-xl transition duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100">{children}</span>;
}

function ProjectSettings({ projectId, onClose, onNotice }: { projectId: string; onClose: () => void; onNotice: (message: string) => void }) {
  const [projectUrl, setProjectUrl] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [connectedUrl, setConnectedUrl] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    fetch(`/api/projects/${projectId}/backend`).then((response) => response.json()).then((body) => { if (body.connected) setConnectedUrl(body.projectUrl); }).finally(() => setBusy(false));
  }, [projectId]);
  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch(`/api/projects/${projectId}/backend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectUrl, publishableKey }) });
    const body = await response.json();
    if (response.ok) { setConnectedUrl(body.projectUrl); setPublishableKey(""); onNotice("Supabase connected. Ask NYNZ to add the database or authentication workflow you need."); }
    else onNotice(body.error || "Could not connect Supabase");
    setBusy(false);
  }
  async function disconnect() {
    setBusy(true);
    const response = await fetch(`/api/projects/${projectId}/backend`, { method: "DELETE" });
    if (response.ok) { setConnectedUrl(""); setProjectUrl(""); onNotice("Supabase disconnected from this generated app."); }
    setBusy(false);
  }
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex justify-end bg-black/55 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Project settings"><button className="absolute inset-0" onClick={onClose} aria-label="Close settings" /><motion.aside initial={{ x: 36, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 36, opacity: 0 }} transition={{ duration: .25, ease }} className="relative h-full w-full max-w-md overflow-y-auto border-l border-white/[.08] bg-[#0b111a] p-6 shadow-[-30px_0_80px_rgba(0,0,0,.4)]"><div className="flex items-center"><div><p className="text-[10px] uppercase tracking-[.16em] text-white/35">Project settings</p><h2 className="mt-1 text-xl font-medium">Backend connection</h2></div><button onClick={onClose} aria-label="Close" className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-white/45 hover:bg-white/[.06] hover:text-white"><X className="h-4 w-4" /></button></div><div className="mt-8 rounded-2xl border border-white/[.08] bg-white/[.025] p-4"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#3ecf8e]/10 text-[#65e6ad]"><Database className="h-4 w-4" /></span><div><p className="text-[13px] font-medium">Supabase</p><p className="text-[11px] text-white/40">Database, authentication and storage</p></div><span className={`ml-auto rounded-full px-2 py-1 text-[9px] ${connectedUrl ? "bg-[#3ecf8e]/10 text-[#65e6ad]" : "bg-white/[.06] text-white/45"}`}>{busy ? "Checking" : connectedUrl ? "Connected" : "Not connected"}</span></div>{connectedUrl ? <div className="mt-4"><p className="truncate rounded-lg border border-white/[.07] bg-black/15 px-3 py-2 font-mono text-[10px] text-white/55">{connectedUrl}</p><p className="mt-3 text-[11px] leading-5 text-white/45">Only the publishable key is injected into this project&apos;s isolated sandbox. NYNZ never accepts a service-role key.</p><button onClick={disconnect} disabled={busy} className="mt-4 rounded-lg border border-red-400/20 px-3 py-2 text-[10px] text-red-300 transition hover:bg-red-400/[.06] disabled:opacity-40">Disconnect</button></div> : <form onSubmit={connect} className="mt-5 space-y-4"><label className="block text-[10px] text-white/45">Project URL<input type="url" required value={projectUrl} onChange={(event) => setProjectUrl(event.target.value)} placeholder="https://your-project.supabase.co" className="mt-1.5 h-10 w-full rounded-lg border border-white/[.09] bg-[#080c13] px-3 font-mono text-[11px] text-white outline-none focus:border-[#c7ff4a]/30" /></label><label className="block text-[10px] text-white/45">Publishable key<input type="password" required value={publishableKey} onChange={(event) => setPublishableKey(event.target.value)} placeholder="sb_publishable_..." className="mt-1.5 h-10 w-full rounded-lg border border-white/[.09] bg-[#080c13] px-3 font-mono text-[11px] text-white outline-none focus:border-[#c7ff4a]/30" /></label><button disabled={busy} className="h-10 w-full rounded-lg bg-[#c7ff4a] text-[11px] font-semibold text-[#071019] disabled:opacity-40">Connect Supabase</button><p className="text-[10px] leading-4 text-white/35">Create a separate Supabase project for the generated app. Keep the NYNZ platform database isolated from customer application data.</p></form>}</div><div className="mt-5 rounded-2xl border border-white/[.07] p-4"><p className="text-[11px] font-medium">How it works</p><ol className="mt-3 space-y-2 text-[10px] leading-4 text-white/45"><li>1. Connect a Supabase project with its URL and publishable key.</li><li>2. Ask NYNZ to add tables, sign in, uploads or another backend workflow.</li><li>3. Apply SQL migrations in that generated app&apos;s Supabase project with row-level security enabled.</li></ol></div></motion.aside></motion.div>;
}

function EmptyPanel({ icon: Icon, title, text }: { icon: typeof Monitor; title: string; text: string }) {
  return <div className="grid h-full min-h-[220px] place-items-center px-6 text-center font-sans"><div><span className="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-white/[.09] bg-white/[.03] text-white/50"><Icon className="h-4 w-4" /></span><h3 className="mt-4 text-[13px] font-medium text-white/85">{title}</h3><p className="mx-auto mt-1.5 max-w-xs text-[11px] leading-5 text-white/45">{text}</p></div></div>;
}

/** Animated wireframe shown before the first preview exists or while a build runs. */
function PreviewPlaceholder({ running, status, progress, error }: { running: boolean; status?: string; progress?: string; error: string | null }) {
  return <div className="relative grid h-full place-items-center overflow-hidden rounded-xl border border-white/[.07] bg-[#0b111a]">
    <div aria-hidden className="nynz-float absolute left-[15%] top-[10%] h-72 w-72 rounded-full bg-[#c7ff4a]/[.07] blur-[90px]" />
    <div aria-hidden className="nynz-float-slow absolute bottom-[5%] right-[10%] h-80 w-80 rounded-full bg-[#3d6f9a]/[.14] blur-[100px]" />
    <div className="relative w-full max-w-[560px] px-6">
      <motion.div initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .7, ease }} className="overflow-hidden rounded-2xl border border-white/[.09] bg-[#0e1520]/90 shadow-[0_30px_80px_rgba(0,0,0,.45)] backdrop-blur-xl">
        <div className="flex h-8 items-center gap-1.5 border-b border-white/[.06] px-3"><i className="h-2 w-2 rounded-full bg-white/15" /><i className="h-2 w-2 rounded-full bg-white/10" /><i className="h-2 w-2 rounded-full bg-white/[.07]" /><span className="mx-auto h-3.5 w-40 rounded bg-white/[.05]" /></div>
        <div className="relative p-5">
          {running && <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden"><span className="nynz-scan absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-[#c7ff4a]/[.07] to-transparent" /></span>}
          <div className="flex items-center justify-between"><span className={`h-3 w-24 rounded-full ${running ? "nynz-shimmer" : "bg-white/[.07]"}`} /><span className={`h-6 w-16 rounded-md ${running ? "bg-[#c7ff4a]/25" : "bg-white/[.06]"}`} /></div>
          <span className={`mt-5 block h-6 w-3/5 rounded-md ${running ? "nynz-shimmer" : "bg-white/[.07]"}`} />
          <div className="mt-5 grid grid-cols-3 gap-2.5">{[0, 1, 2].map((i) => <motion.span key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .3 + i * .1, ease }} className={`h-16 rounded-lg ${i === 1 && running ? "bg-[#c7ff4a]/15" : running ? "nynz-shimmer" : "bg-white/[.05]"}`} />)}</div>
          <div className="mt-3 space-y-2 rounded-lg bg-white/[.03] p-3">{[85, 65, 75].map((w, i) => <span key={i} className={`block h-2 rounded-full ${running ? "nynz-shimmer" : "bg-white/[.06]"}`} style={{ width: `${w}%` }} />)}</div>
        </div>
      </motion.div>
      <div className="mt-8 text-center">
        <h2 className="text-[15px] font-medium">{running ? "Assembling your app" : error ? "The last build didn’t finish" : "Your app will appear here"}</h2>
        <AnimatePresence mode="wait"><motion.p key={progress || String(running)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mx-auto mt-2 max-w-sm text-[12px] leading-5 text-white/50">{running ? progress || `Currently ${status}…` : error ? "Check the chat for details, or ask NYNZ to fix it." : "Describe it in the chat. NYNZ plans it, writes the code and runs it live, right here."}</motion.p></AnimatePresence>
      </div>
    </div>
  </div>;
}
