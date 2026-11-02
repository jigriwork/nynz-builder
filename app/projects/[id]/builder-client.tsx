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
import { BuildPipeline, buildPercent, ease } from "@/components/nynz-motion";
import { formatDateTime } from "@/lib/format-date";
import { ProjectNameDialog } from "@/components/project-name-dialog";

type Project = { id: string; name: string; description: string; status: string; preview_url: string | null; active_sandbox_id?: string | null; sandbox_expires_at: string | null; last_error: string | null };
type FileRow = { path: string; content: string; updated_at?: string };
type Version = { id: string; label: string; created_at: string };
type Message = { id: string; role: string; content: string; created_at: string };
type Build = { id: string; status: string; prompt?: string; mode?: "create" | "edit" | "restart"; progress: Array<{ at?: string; message?: string; percent?: number }>; plan: { summary?: string; steps?: string[]; approval?: string; revision?: number } | null; error_message: string | null; created_at: string; cancel_requested_at: string | null };
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

function buildActivity(status?: string, progress?: string, phase = 0) {
  if (status === "queued") return { title: "Waiting", detail: "Your request is queued and ready for the builder.", icon: LoaderCircle };
  if (status === "planning") return [
    { title: "Thinking", detail: "Understanding your request and the product you need.", icon: Sparkles },
    { title: "Planning", detail: "Mapping the screens, states, and primary workflow.", icon: Sparkles },
    { title: "Structuring", detail: "Choosing the components and application architecture.", icon: Sparkles },
  ][phase % 3];
  if (status === "generating") {
    if (/repair/i.test(progress || "")) return { title: "Repairing", detail: "Correcting the generated code while preserving the product design.", icon: Code2 };
    const batch = progress?.match(/(\d+)\s+of\s+(\d+)/)?.slice(1).join(" of ");
    const activities = [
      { title: "Designing", detail: "Shaping the interface, hierarchy, and responsive layout.", icon: Palette },
      { title: "Writing", detail: "Creating components and application logic.", icon: Code2 },
      { title: "Connecting", detail: "Wiring interactions, states, and navigation together.", icon: Sparkles },
    ];
    const activity = activities[phase % activities.length];
    return { ...activity, detail: `${activity.detail}${batch ? ` File batch ${batch}.` : ""}` };
  }
  if (status === "installing") return [
    { title: "Installing", detail: "Preparing the application dependencies.", icon: Terminal },
    { title: "Compiling", detail: "Creating an optimized production build.", icon: Code2 },
    { title: "Checking", detail: "Looking for dependency and build issues.", icon: CheckCircle2 },
  ][phase % 3];
  if (status === "running") return { title: "Starting preview", detail: progress || "Starting the secure live preview.", icon: Play };
  if (status === "validating") return [
    { title: "Testing", detail: "Checking the production build and application routes.", icon: CheckCircle2 },
    { title: "Inspecting", detail: "Making sure the preview responds correctly.", icon: Eye },
    { title: "Preparing preview", detail: "Finishing the secure live application preview.", icon: Play },
  ][phase % 3];
  return { title: "Working", detail: progress || "Working on your request.", icon: LoaderCircle };
}

function BuildActivity({ status, progress, percent, phase }: { status?: string; progress?: string; percent?: number; phase: number }) {
  const activity = buildActivity(status, progress, phase);
  const Icon = activity.icon;
  return <div className="w-full max-w-[310px] rounded-2xl rounded-tl-md border border-white/[.08] bg-white/[.03] px-3.5 py-3 shadow-[0_12px_36px_rgba(0,0,0,.18)]">
    <div className="flex items-center gap-2.5">
      <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#c7ff4a]/10 text-[#c7ff4a]"><Icon className={`h-3.5 w-3.5 ${status === "queued" ? "animate-spin" : ""}`} /><span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full border-2 border-[#111824] bg-[#c7ff4a]" /></span>
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-[12px] font-medium text-white/90">{activity.title}</span>{typeof percent === "number" && <span className="ml-auto font-mono text-[10px] tabular-nums text-[#c7ff4a]">{percent}%</span>}</div><AnimatePresence mode="wait"><motion.p key={activity.detail} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-white/45">{activity.detail}</motion.p></AnimatePresence></div>
    </div>
    <span className="mt-2.5 block h-0.5 overflow-hidden rounded-full bg-white/[.07]"><motion.span className="block h-full rounded-full bg-[#c7ff4a]" initial={false} animate={{ width: `${percent ?? buildPercent(status)}%` }} transition={{ duration: .7, ease }} /></span>
  </div>;
}

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
  const [usageCredits, setUsageCredits] = useState(initialCredits);
  const [usageCostPaise, setUsageCostPaise] = useState(initialCostPaise);
  const [showUsage, setShowUsage] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>("preview");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [mobilePane, setMobilePane] = useState<"chat" | "workspace">(initialProject.status === "ready" ? "workspace" : "chat");
  const [showReference, setShowReference] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingCode, setEditingCode] = useState(false);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [activityTick, setActivityTick] = useState(0);
  const [terminalLines, setTerminalLines] = useState<Array<{ command: string; output: string; exitCode: number | null }>>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetBusy, setAssetBusy] = useState(false);
  const [previewSrc, setPreviewSrc] = useState(initialProject.id === "design-fixture" ? initialProject.preview_url : null);
  const [mounted, setMounted] = useState(false);
  const resumedDraft = useRef(false);
  const conversation = useRef<HTMLDivElement>(null);
  const followConversation = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const codeEditor = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);

  const current = files.find((file) => file.path === selected);
  const pendingPlan = builds.find(build => build.status === "planning" && build.plan?.approval === "awaiting");
  const running = mounted ? builds.find((build) => active.has(build.status) && build.plan?.approval !== "awaiting") : undefined;
  const runningId = running?.id;
  const runningStatus = running?.status;
  const pendingPlanKey = pendingPlan ? `${pendingPlan.id}:${pendingPlan.plan?.revision}` : "";
  const latest = builds[0];
  const lastProgress = running?.progress?.[running.progress.length - 1]?.message;
  const progressPercent = running?.progress ? [...running.progress].reverse().find((event) => typeof event.percent === "number")?.percent : undefined;
  const failed = project.status === "failed" && !running;
  const currentActivity = buildActivity(running?.status, lastProgress, activityTick);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!runningId) return;
    const timer = setInterval(() => setActivityTick((value) => value + 1), 4_200);
    return () => clearInterval(timer);
  }, [runningId, runningStatus]);

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
    if (projectResponse.ok) {
      const body = await projectResponse.json();
      setProject(body.project);
      if (body.usage) { setUsageCredits(body.usage.credits); setUsageCostPaise(body.usage.modelCostPaise); }
    }
    if (filesResponse.ok) {
      const next = (await filesResponse.json()).files;
      setFiles(next); setSelected((value) => value || next[0]?.path || "");
    }
    if (buildsResponse.ok) setBuilds((await buildsResponse.json()).builds);
    if (versionsResponse.ok) setVersions((await versionsResponse.json()).versions);
    if (messagesResponse.ok) setMessages((await messagesResponse.json()).messages);
  }, [project.id]);

  useEffect(() => {
    if ((!running && !pendingPlan) || project.id === "design-fixture") return;
    const timer = setInterval(refresh, 2_500);
    return () => clearInterval(timer);
  }, [running, pendingPlan, refresh, project.id]);

  useEffect(() => {
    if (project.id === "design-fixture") { setPreviewSrc(project.preview_url); return; }
    if (!project.preview_url || !project.active_sandbox_id || project.status === "archived") { setPreviewSrc(null); return; }
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
    // Polling replaces job objects even when nothing changed. Only follow new
    // content while the reader is already near the bottom of this pane.
    if (!followConversation.current) return;
    const pane = conversation.current;
    pane?.scrollTo({ top: pane.scrollHeight, behavior: "auto" });
  }, [messages.length, runningStatus, lastProgress, pendingPlanKey]);

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
        setNotice("Preparing your plan. Review and approve it before building.");
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
    if (pendingPlan) {
      await reviewPlan({ action: "revise", changes: text }).catch(() => setPrompt(text));
      return;
    }
    setMessages((value) => [...value, { id: crypto.randomUUID(), role: "user", content: text, created_at: new Date().toISOString() }]);
    const response = await fetch(`/api/projects/${project.id}/builds`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: text, mode: files.length ? "edit" : "create", idempotencyKey: crypto.randomUUID() }) });
    const body = await response.json();
    if (response.ok) setBuilds((value) => [body.build, ...value]); else setNotice(body.error);
  }

  async function reviewPlan(input: { action: "approve"; summary: string; steps: string[] } | { action: "revise"; changes: string } | { action: "cancel" }) {
    if (!pendingPlan) return;
    const response = await fetch(`/api/projects/${project.id}/builds`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, buildId: pendingPlan.id, revision: pendingPlan.plan?.revision }) });
    const body = await response.json();
    if (!response.ok) { setNotice(body.error || "Could not review plan"); await refresh(); throw new Error(body.error || "Could not review plan"); }
    setBuilds(value => value.map(build => build.id === body.build.id ? body.build : build));
    setNotice(input.action === "approve" ? "Plan approved. Building your app." : input.action === "revise" ? "Updating the plan for your review." : "Plan cancelled.");
    await refresh();
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
  const conversationItems = useMemo(() => {
    const items: Array<{ kind: "message"; at: string; message: Message } | { kind: "plan"; at: string; build: Build }> = messages.map(message => ({ kind: "message", at: message.created_at, message }));
    for (const build of builds) {
      if (!build.plan?.summary || !["planning", "queued", "generating", "installing", "running", "validating", "succeeded"].includes(build.status)) continue;
      const planEvent = [...(build.progress || [])].reverse().find(event => event.message?.startsWith("Plan ready for your approval"));
      items.push({ kind: "plan", at: planEvent?.at || build.created_at, build });
    }
    return items.sort((left, right) => left.at.localeCompare(right.at));
  }, [messages, builds]);
  const lineCount = Math.max(1, (current?.content.match(/\n/g)?.length || 0) + 1);
  const syntaxLanguage = current?.path.endsWith(".tsx") || current?.path.endsWith(".ts") ? "tsx" : current?.path.endsWith(".jsx") || current?.path.endsWith(".js") ? "jsx" : current?.path.endsWith(".css") ? "css" : current?.path.endsWith(".json") ? "json" : current?.path.endsWith(".html") ? "markup" : "text";

  return <main data-builder-ready={mounted} className="nynz-dark nynz-builder fixed inset-0 flex h-[100dvh] w-full flex-col overflow-hidden overscroll-none bg-[#080c13] text-[#f4f1e8] selection:bg-[#c7ff4a] selection:text-[#071019]">
    <header className="relative flex h-14 shrink-0 items-center border-b border-white/[.07] bg-[#0a0f17] px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <a href="/dashboard" aria-label="Back to projects" className="grid h-8 w-8 place-items-center rounded-lg text-white/45 transition hover:bg-white/[.06] hover:text-white"><ArrowLeft className="h-4 w-4" /></a>
        <NynzIcon className="hidden h-7 w-7 min-[390px]:block" />
        <span className="hidden text-white/20 sm:block">/</span>
        <button type="button" onClick={() => setShowRename(true)} aria-label="Rename project" title={project.name} className="group flex min-w-0 max-w-[104px] items-center gap-2 rounded-md px-1.5 py-1 text-[13px] font-medium transition hover:bg-white/[.04] focus-visible:bg-white/[.06] sm:max-w-[260px]"><span className="truncate">{project.name}</span><Pencil className="hidden h-3 w-3 shrink-0 text-white/30 group-hover:text-[#c7ff4a] sm:block" /></button>
      </div>
      <AnimatePresence>{running && <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .35, ease }} className="absolute left-1/2 hidden -translate-x-1/2 lg:block"><div className="flex h-8 min-w-[220px] items-center gap-2.5 rounded-full border border-[#c7ff4a]/15 bg-[#c7ff4a]/[.055] px-3 text-[10px] shadow-[0_0_24px_rgba(199,255,74,.06)]"><LoaderCircle className="h-3 w-3 animate-spin text-[#c7ff4a]" /><span className="font-medium text-white/75">{currentActivity.title}</span><span className="relative h-1 w-16 overflow-hidden rounded-full bg-white/[.08]"><motion.span className="absolute inset-y-0 left-0 rounded-full bg-[#c7ff4a]" initial={false} animate={{ width: `${progressPercent ?? buildPercent(running.status)}%` }} /></span><span className="ml-auto font-mono tabular-nums text-[#c7ff4a]">{progressPercent ?? buildPercent(running.status)}%</span></div></motion.div>}</AnimatePresence>
      <div className="ml-auto flex items-center gap-1.5">
        <span className={`mr-1 hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] sm:flex ${running ? "lg:hidden" : ""} ${running ? "border-[#c7ff4a]/20 bg-[#c7ff4a]/[.08] text-[#c7ff4a]" : failed ? "border-red-400/20 bg-red-400/[.08] text-red-300" : project.status === "ready" ? "border-[#c7ff4a]/15 text-[#c7ff4a]/85" : "border-white/[.08] text-white/50"}`}>
          {running ? <LoaderCircle className="h-3 w-3 animate-spin" /> : failed ? <AlertCircle className="h-3 w-3" /> : project.status === "ready" ? <span className="relative flex h-1.5 w-1.5"><span className="absolute inset-0 animate-ping rounded-full bg-[#c7ff4a]/60" /><span className="h-1.5 w-1.5 rounded-full bg-[#c7ff4a]" /></span> : <CheckCircle2 className="h-3 w-3" />}
          <span className="capitalize">{running?.status || (project.status === "ready" ? "Live" : project.status)}</span>
        </span>
        <button type="button" onClick={() => setShowUsage((value) => !value)} aria-label="Show model usage" aria-expanded={showUsage} title={`Model usage ₹${(usageCostPaise / 100).toFixed(2)}`} className={`relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] tabular-nums transition ${showUsage ? "border-[#c7ff4a]/25 bg-[#c7ff4a]/10 text-[#c7ff4a]" : "border-white/[.07] text-white/55 hover:bg-white/[.06] hover:text-white"}`}><Coins className="h-3.5 w-3.5" /><span>{usageCredits.toLocaleString()}</span></button>
        <button onClick={saveVersion} title="Save checkpoint" aria-label="Save checkpoint" className="hidden h-8 items-center gap-2 rounded-lg px-2.5 text-[11px] text-white/55 transition hover:bg-white/[.06] hover:text-white sm:flex"><Save className="h-3.5 w-3.5" /><span className="hidden 2xl:inline">Checkpoint</span></button>
        <a href={`/api/projects/${project.id}/export`} className="group flex h-8 items-center gap-2 rounded-lg bg-[#c7ff4a] px-3.5 text-[11px] font-semibold text-[#071019] shadow-[0_0_24px_rgba(199,255,74,.18)] transition hover:bg-[#d5ff72] hover:shadow-[0_0_32px_rgba(199,255,74,.32)]"><Download className="h-3.5 w-3.5 transition-transform group-hover:translate-y-px" /><span className="hidden sm:inline">Export</span></a>
      </div>
      <AnimatePresence>{showUsage && <motion.div initial={{ opacity: 0, y: -6, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: .98 }} className="absolute right-3 top-12 z-50 w-64 rounded-xl border border-white/[.1] bg-[#111924]/95 p-3.5 shadow-[0_20px_60px_rgba(0,0,0,.5)] backdrop-blur-xl"><div className="flex items-center gap-2 text-[11px] font-medium text-white/80"><Coins className="h-3.5 w-3.5 text-[#c7ff4a]" /> Model usage</div><div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-lg bg-white/[.04] p-2.5"><p className="text-[9px] uppercase tracking-[.12em] text-white/35">Provider cost</p><p className="mt-1 text-[15px] font-medium tabular-nums text-white">₹{(usageCostPaise / 100).toFixed(2)}</p></div><div className="rounded-lg bg-white/[.04] p-2.5"><p className="text-[9px] uppercase tracking-[.12em] text-white/35">Credits used</p><p className="mt-1 text-[15px] font-medium tabular-nums text-white">{usageCredits.toLocaleString()}</p></div></div><p className="mt-2.5 text-[9px] leading-4 text-white/35">Usage updates while NYNZ builds. One credit represents 1,000 model tokens.</p></motion.div>}</AnimatePresence>
      {running && <span className="absolute inset-x-0 bottom-0 h-px overflow-hidden"><span className="nynz-scan absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-[#c7ff4a] to-transparent" /></span>}
    </header>

    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <nav aria-label="Mobile builder view" className="flex h-11 shrink-0 items-center gap-1 border-b border-white/[.07] bg-[#090e16] px-3 lg:hidden">
        {([ ["chat", "Chat", Sparkles], ["workspace", tab === "preview" ? "Preview" : "Workspace", Monitor] ] as const).map(([id, label, Icon]) => <button key={id} type="button" onClick={() => setMobilePane(id)} className={`relative flex h-8 flex-1 items-center justify-center gap-2 rounded-lg text-[11px] transition ${mobilePane === id ? "bg-white/[.08] text-white" : "text-white/45"}`}>{mobilePane === id && <motion.span layoutId="mobile-builder-pane" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[#c7ff4a]" />}<Icon className="relative h-3.5 w-3.5" /><span className="relative">{label}</span>{id === "chat" && running && <span className="relative h-1.5 w-1.5 animate-pulse rounded-full bg-[#c7ff4a]" />}</button>)}
        {running && <span className="ml-2 w-9 text-right font-mono text-[10px] tabular-nums text-[#c7ff4a]">{progressPercent ?? buildPercent(running.status)}%</span>}
      </nav>
      <div className="grid min-h-0 min-w-0 flex-1 overflow-hidden grid-cols-1 grid-rows-1 lg:grid-cols-[52px_400px_minmax(0,1fr)]">
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

      <aside className={`relative min-h-0 min-w-0 flex-col overflow-hidden bg-[#0b1019] lg:flex lg:border-r ${mobilePane === "chat" ? "flex" : "hidden"}`}>
        <div className="flex h-11 shrink-0 items-center border-b border-white/[.06] px-4">
          <Sparkles className="mr-2 h-3.5 w-3.5 text-[#c7ff4a]" />
          <span className="text-[12px] font-medium">Build with NYNZ</span>
          <span className="ml-auto text-[10px] text-white/40">{messages.length} message{messages.length === 1 ? "" : "s"}</span>
        </div>

        <div ref={conversation} role="region" aria-label="Conversation" onWheel={event => { if (event.deltaY < 0) followConversation.current = false; }} onScroll={event => { const pane = event.currentTarget; followConversation.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 4; }} className="nynz-scrollbar min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 py-5 [overflow-anchor:none]">
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
            <AnimatePresence initial={false}>{conversationItems.map(item => item.kind === "plan" ? <motion.div key={`plan-${item.build.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{item.build.id === pendingPlan?.id ? <PlanReview key={`${pendingPlan.id}-${pendingPlan.plan?.revision}`} plan={pendingPlan.plan!} onReview={reviewPlan} /> : <details aria-label={item.build.status === "succeeded" ? "Completed build plan" : "Approved build plan"} className="rounded-xl border border-white/[.07] bg-white/[.02] px-3 py-2.5 text-[11px]"><summary className="cursor-pointer text-white/45">{item.build.status === "succeeded" ? "Completed plan" : "Approved plan"}<span className="ml-2 text-[9px] text-white/25">{item.build.plan?.steps?.length || 0} steps</span></summary><p className="mt-3 leading-5 text-white/60">{item.build.plan?.summary}</p><ol className="mt-2 list-inside list-decimal space-y-1.5 text-white/45">{item.build.plan?.steps?.map((step, index) => <li key={index}>{step}</li>)}</ol></details>}</motion.div> : ((message: Message) => <motion.div key={message.id} data-chat-message={message.id} initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .4, ease }} className={message.role === "user" ? "ml-8" : "mr-3"}>
              <div className={`mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.14em] text-white/40 ${message.role === "user" ? "justify-end" : ""}`}>{message.role === "user" ? "You" : <><NynzIcon className="h-4 w-4" /> NYNZ</>}</div>
              <div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[13px] leading-[1.6] ${message.role === "user" ? "rounded-tr-md bg-[#1b2433] text-white/90" : "rounded-tl-md border border-white/[.07] bg-white/[.025] text-white/70"}`}>{message.content}</div>
            </motion.div>)(item.message))}</AnimatePresence>

            <AnimatePresence>{running && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mr-5 sm:mr-12"><div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.14em] text-white/40"><NynzIcon className="h-4 w-4" /> Live activity</div><BuildActivity status={running.status} progress={lastProgress} percent={progressPercent} phase={activityTick} /></motion.div>}</AnimatePresence>

            {!running && project.status === "ready" && messages[messages.length - 1]?.role === "assistant" && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap gap-1.5">{[
              ["Refine the design", "Refine the visual design so it feels more distinctive, polished, and professionally art-directed. Preserve all working functionality."],
              ["Improve mobile", "Review the complete mobile experience and improve spacing, navigation, touch targets, and responsive layouts."],
              ["Add a feature", "I want to add another feature. Ask me what workflow I need before changing the application."],
            ].map(([label, text]) => <button key={label} type="button" onClick={() => applyPrompt(text)} className="rounded-full border border-white/[.08] bg-white/[.025] px-2.5 py-1.5 text-[9px] text-white/50 transition hover:border-[#c7ff4a]/25 hover:bg-[#c7ff4a]/[.05] hover:text-white">{label}</button>)}</motion.div>}

            <AnimatePresence>{running && <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: .4, ease }} className="nynz-edge relative hidden overflow-hidden rounded-2xl bg-[#0d1520] p-4 sm:block">
              <div className="flex items-center gap-2"><span className="text-[11px] font-medium text-[#c7ff4a]">Building your app</span><button onClick={cancel} className="ml-auto rounded-md px-2 py-1 text-[10px] text-white/45 transition hover:bg-red-400/10 hover:text-red-300">Stop</button></div>
              <div className="mt-3"><BuildPipeline status={running.status} compact progressPercent={progressPercent} /></div>
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

      <section className={`min-h-0 min-w-0 flex-col overflow-hidden bg-[#0a0f17] lg:flex ${mobilePane === "workspace" ? "flex" : "hidden"}`}>
        <div className="flex h-11 shrink-0 items-center border-b border-white/[.06] bg-[#0b111a] px-2.5">
          <nav className="flex items-center gap-0.5">{tabs.map(({ id, label, icon: Icon }) => <button key={id} aria-label={label} onClick={() => setTab(id)} className={`relative flex h-8 items-center gap-2 rounded-lg px-3 text-[11px] transition ${tab === id ? "text-white" : "text-white/45 hover:text-white/80"}`}>{tab === id && <motion.span layoutId="workspace-tab" transition={{ type: "spring", stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-lg border border-white/[.08] bg-white/[.07]" />}<Icon className="relative h-3.5 w-3.5" /><span className="relative hidden sm:inline">{label}</span>{id === "code" && files.length > 0 && <span className="relative rounded bg-white/[.08] px-1 text-[9px] text-white/55">{files.length}</span>}</button>)}</nav>
          {tab === "preview" && <div className="mx-auto hidden h-7 w-[min(34vw,380px)] items-center rounded-lg border border-white/[.07] bg-[#080c13] px-3 text-[10px] text-white/45 xl:flex">{previewSrc ? <span className="mr-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c7ff4a] shadow-[0_0_8px_#c7ff4a]" /> : <Globe2 className="mr-2 h-3 w-3 shrink-0" />}<span className="truncate">{previewSrc ? "Secure live preview" : "Preview starts after the first successful build"}</span></div>}
          <div className="ml-auto flex items-center gap-1">
            {tab === "preview" && <>
              <div className="flex rounded-lg border border-white/[.07] p-0.5">{([["desktop", Monitor], ["mobile", Smartphone]] as const).map(([id, Icon]) => <button key={id} aria-label={`${id} preview`} aria-pressed={device === id} onClick={() => setDevice(id)} className={`grid h-6 w-7 place-items-center rounded-md transition ${device === id ? "bg-white/[.1] text-white" : "text-white/40 hover:text-white/75"}`}><Icon className="h-3 w-3" /></button>)}</div>
            </>}
            {tab === "preview" && (previewSrc ? <a href={previewSrc} target="_blank" rel="noreferrer" title="Open preview in a new tab" className="grid h-7 w-7 place-items-center rounded-lg text-white/45 transition hover:bg-white/[.06] hover:text-white" aria-label="Open preview in new tab"><ExternalLink className="h-3.5 w-3.5" /></a> : <button type="button" disabled title="Open in new tab becomes available when the preview is live" aria-label="Open preview in new tab unavailable until build completes" className="grid h-7 w-7 place-items-center rounded-lg text-white/20"><ExternalLink className="h-3.5 w-3.5" /></button>)}
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

              {tab === "code" && <div className="flex h-full min-h-0 flex-col sm:grid sm:grid-cols-[240px_minmax(0,1fr)]">
                <div className="nynz-scrollbar flex h-10 shrink-0 gap-1 overflow-x-auto border-b border-white/[.06] bg-[#0a0f17] px-2 py-1.5 sm:hidden">{files.map((file) => <button key={file.path} onClick={() => setSelected(file.path)} className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 font-mono text-[9px] ${selected === file.path ? "bg-white/[.09] text-white" : "text-white/45"}`}>{fileIcon(file.path)}<span className="max-w-[130px] truncate">{file.path.split("/").pop()}</span></button>)}{files.length === 0 && <span className="px-2 text-[10px] leading-7 text-white/40">Files appear here while NYNZ writes.</span>}</div>
                <aside className="nynz-scrollbar hidden min-h-0 overflow-y-auto border-r border-white/[.06] bg-[#0a0f17] py-2 sm:block"><div className="flex h-8 items-center px-3 text-[10px] font-medium uppercase tracking-[.13em] text-white/40">Explorer <span className="ml-auto rounded bg-white/[.06] px-1.5 font-mono text-white/50">{files.length}</span></div>{files.map((file) => <button key={file.path} onClick={() => setSelected(file.path)} className={`relative flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] transition ${selected === file.path ? "bg-white/[.06] text-white/90" : "text-white/50 hover:bg-white/[.03] hover:text-white/80"}`}>{selected === file.path && <motion.span layoutId="file-active" className="absolute inset-y-0 left-0 w-0.5 bg-[#c7ff4a]" />}{fileIcon(file.path)}<span className="truncate">{file.path}</span></button>)}{files.length === 0 && <p className="px-3 py-4 text-[11px] leading-5 text-white/40">Files appear here as NYNZ writes them.</p>}</aside>
                <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[#080c13]">{current ? <div className="flex h-full min-h-0 flex-col overflow-hidden"><div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[.06] px-3 font-mono text-[10px] text-white/55">{fileIcon(current.path)}<span className="min-w-0 truncate">{current.path}</span><button onClick={() => setEditingCode((value) => !value)} className="ml-auto flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-white/[.08] px-2 font-sans text-[9px] text-white/55 transition hover:bg-white/[.06] hover:text-white">{editingCode ? <><Eye className="h-3 w-3" /> Preview</> : <><Pencil className="h-3 w-3" /> Edit</>}</button></div>{editingCode ? <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden"><div ref={gutter} aria-hidden onWheel={(event) => { const editor = codeEditor.current; if (!editor) return; editor.scrollTop += event.deltaY; editor.scrollLeft += event.deltaX; }} className="w-12 shrink-0 select-none overflow-hidden border-r border-white/[.04] py-4 pr-3 text-right font-mono text-[11px] leading-5 text-white/20">{Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}</div><textarea ref={codeEditor} value={current.content} onScroll={(event) => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }} onChange={(event) => setFiles((value) => value.map((file) => file.path === current.path ? { ...file, content: event.target.value } : file))} onBlur={(event) => saveFile(event.target.value)} spellCheck={false} wrap="off" className="nynz-scrollbar h-full min-h-0 min-w-0 w-full flex-1 touch-pan-x touch-pan-y resize-none overflow-auto overscroll-contain whitespace-pre bg-transparent p-4 pl-4 font-mono text-[12px] leading-5 text-[#d8decf] outline-none [scrollbar-gutter:stable]" /></div> : <div className="nynz-scrollbar min-h-0 flex-1 overflow-auto"><SyntaxHighlighter language={syntaxLanguage} style={vscDarkPlus} showLineNumbers wrapLongLines={false} customStyle={{ margin: 0, minHeight: "100%", background: "#080c13", padding: "16px 18px", fontSize: "12px", lineHeight: "1.7" }} lineNumberStyle={{ minWidth: "2.8em", paddingRight: "1.2em", color: "rgba(255,255,255,.18)" }}>{current.content}</SyntaxHighlighter></div>}</div> : <EmptyPanel icon={Code2} title="No files yet" text="Once the first build runs, every generated file is editable here." />}</div>
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
    </div>
    <AnimatePresence>{showSettings && <ProjectSettings projectId={project.id} onClose={() => setShowSettings(false)} onNotice={setNotice} />}</AnimatePresence>
    {showRename && <ProjectNameDialog project={project} onClose={() => setShowRename(false)} onSaved={updated => { setProject(value => ({ ...value, name: updated.name })); setNotice("Project renamed."); }} />}
  </main>;
}

function PlanReview({ plan, onReview }: { plan: NonNullable<Build["plan"]>; onReview: (input: { action: "approve"; summary: string; steps: string[] } | { action: "revise"; changes: string } | { action: "cancel" }) => Promise<void> }) {
  const [summary, setSummary] = useState(plan.summary || "");
  const [steps, setSteps] = useState((plan.steps || []).join("\n"));
  const [changes, setChanges] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(action: "approve" | "revise" | "cancel") {
    setBusy(true); setError("");
    try {
      await onReview(action === "approve" ? { action, summary, steps: steps.split("\n").map(value => value.trim()).filter(Boolean) } : action === "revise" ? { action, changes } : { action });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Review build plan" className="rounded-2xl border border-[#c7ff4a]/20 bg-[#101a23] p-4">
    <div className="flex items-center gap-2"><NynzIcon className="h-5 w-5" /><h2 className="text-[13px] font-medium">Review your build plan</h2><span className="ml-auto rounded-full bg-[#c7ff4a]/10 px-2 py-1 text-[9px] text-[#c7ff4a]">Your approval needed</span></div>
    <p className="mt-2 text-[11px] leading-5 text-white/45">Check the scope below. Edit the plan directly or ask for changes. Code generation starts after you approve.</p>
    {editing ? <div className="mt-3 space-y-3"><label className="block text-[10px] text-white/55">Summary<textarea aria-label="Plan summary" value={summary} onChange={event => setSummary(event.target.value)} rows={3} className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-[#080f18] p-2 text-[12px] text-white outline-none focus:border-[#c7ff4a]/40" /></label><label className="block text-[10px] text-white/55">Steps, one per line<textarea aria-label="Plan steps" value={steps} onChange={event => setSteps(event.target.value)} rows={6} className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-[#080f18] p-2 text-[12px] text-white outline-none focus:border-[#c7ff4a]/40" /></label></div> : <><p className="mt-3 text-[12px] leading-5 text-white/80">{summary}</p><ol className="mt-3 space-y-2">{steps.split("\n").filter(Boolean).map((step, index) => <li key={index} className="flex gap-2 text-[11px] leading-5 text-white/60"><span className="font-mono text-[#c7ff4a]/70">{index + 1}.</span><span>{step}</span></li>)}</ol></>}
    <button type="button" disabled={busy} onClick={() => setEditing(value => !value)} className="mt-3 flex items-center gap-1.5 text-[11px] text-white/55 hover:text-white"><Pencil className="h-3 w-3" />{editing ? "Done editing" : "Edit plan"}</button>
    <label className="mt-4 block text-[10px] text-white/45">Anything to add or remove?<textarea aria-label="Requested plan changes" value={changes} onChange={event => setChanges(event.target.value)} rows={2} placeholder="For example: remove history and add a light theme" className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-[#080f18] p-2.5 text-[12px] text-white outline-none placeholder:text-white/25 focus:border-[#c7ff4a]/40" /></label>
    {error && <p role="alert" className="mt-2 text-[11px] text-red-300">{error}</p>}
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => submit("approve")} disabled={busy || !summary.trim() || !steps.trim() || Boolean(changes.trim())} className="flex h-9 items-center gap-1.5 rounded-lg bg-[#c7ff4a] px-3 text-[11px] font-semibold text-[#071019] disabled:opacity-40">{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Approve and build</button><button type="button" onClick={() => submit("revise")} disabled={busy || !changes.trim()} className="h-9 rounded-lg border border-white/10 px-3 text-[11px] text-white/70 disabled:opacity-30">Revise plan</button><button type="button" onClick={() => submit("cancel")} disabled={busy} className="ml-auto h-9 px-2 text-[10px] text-white/40">Cancel</button></div>
    {changes.trim() && <p className="mt-2 text-[10px] text-white/40">Revise the plan to include these changes, then approve the updated version.</p>}
  </section>;
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
