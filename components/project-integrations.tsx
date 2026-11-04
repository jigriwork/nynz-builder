"use client";

import { useCallback, useEffect, useState } from "react";

type Json = Record<string, any>;
const card = "mt-5 rounded-2xl border border-white/[.07] p-4";
const button = "h-8 rounded-lg border border-white/[.12] px-3 text-[11px] text-white/85 transition hover:bg-white/[.06] disabled:opacity-40";
const input = "h-9 w-full rounded-lg border border-white/[.12] bg-white/[.03] px-3 text-[12px] text-white outline-none placeholder:text-white/35 focus:border-[#c7ff4a]/45";

async function call(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

/** Publishing, backend migration review and GitHub sync for one project. Unavailable features say so plainly. */
export function ProjectIntegrations({ projectId, onNotice }: { projectId: string; onNotice: (message: string) => void }) {
  const [publish, setPublish] = useState<Json | null>(null);
  const [backend, setBackend] = useState<Json | null>(null);
  const [github, setGithub] = useState<Json | null>(null);
  const [domain, setDomain] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [p, b, g] = await Promise.all([call(`/api/projects/${projectId}/publish`).catch(() => null), call(`/api/projects/${projectId}/backend`).catch(() => null), call(`/api/projects/${projectId}/github`).catch(() => null)]);
    setPublish(p); setBackend(b); setGithub(g);
    if (g?.link) { setRepo(g.link.repository); setBranch(g.link.branch); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  async function run(fn: () => Promise<Json>, success: (result: Json) => string) {
    setBusy(true);
    try { onNotice(success(await fn())); await load(); } catch (error) { onNotice(error instanceof Error ? error.message : "Request failed"); }
    setBusy(false);
  }
  const live = publish?.deployments?.find((d: Json) => d.id === publish?.site?.active_deployment_id);
  return <>
    <div className={card}>
      <p className="text-[11px] font-medium">Publish</p>
      {!publish?.available ? <p className="mt-2 text-[10px] leading-4 text-white/50">{publish?.reason || "Publishing is not available yet."} Your preview and source export keep working.</p> : <>
        <p className="mt-2 text-[10px] leading-4 text-white/50">Publishing builds a production version of your current files in an isolated sandbox and serves the static result on its own address. Previous versions are kept for rollback.</p>
        {publish.url && <a href={publish.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-[11px] text-[#c7ff4a]">{publish.url}</a>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => run(() => call(`/api/projects/${projectId}/publish`, "POST", { action: "publish" }), () => "Publishing started. This usually takes a few minutes.")} className={button}>{publish.site?.status === "live" ? "Publish update" : "Publish"}</button>
          {publish.site?.status === "live" && <button disabled={busy} onClick={() => run(() => call(`/api/projects/${projectId}/publish`, "POST", { action: "unpublish" }), () => "Site unpublished.")} className={button}>Unpublish</button>}
        </div>
        {publish.deployments?.length > 0 && <ul className="mt-3 space-y-1 text-[10px] text-white/60">{publish.deployments.map((d: Json) => <li key={d.id} className="flex items-center justify-between gap-2"><span>{new Date(d.created_at).toLocaleString("en-IN")} · {d.status}{d.id === live?.id ? " · live" : ""}{d.error ? ` · ${d.error}` : ""}</span>{["ready", "retired"].includes(d.status) && d.id !== live?.id && <button disabled={busy} onClick={() => run(() => call(`/api/projects/${projectId}/publish`, "POST", { action: "rollback", deploymentId: d.id }), () => "Rolled back.")} className="text-[#c7ff4a]">Roll back</button>}</li>)}</ul>}
        <div className="mt-4"><p className="text-[10px] text-white/60">Custom domain</p>
          {publish.domains?.map((d: Json) => <div key={d.id} className="mt-2 rounded-lg bg-white/[.03] p-2 text-[10px] text-white/65"><p className="text-white/85">{d.hostname} · {d.status.replaceAll("_", " ")}</p><p className="mt-1 break-all">TXT {d.dns.name} = {d.dns.value}</p>{d.cname && <p className="break-all">CNAME {d.cname.name} → {d.cname.value}</p>}{d.error && <p className="text-amber-200">{d.error}</p>}<div className="mt-1 flex gap-3"><button disabled={busy} onClick={() => run(() => call(`/api/projects/${projectId}/publish`, "POST", { action: "verify_domain", domainId: d.id }), (r) => r.note)} className="text-[#c7ff4a]">Verify</button><button disabled={busy} onClick={() => run(() => call(`/api/projects/${projectId}/publish`, "POST", { action: "remove_domain", domainId: d.id }), () => "Domain removed.")} className="text-red-300">Remove</button></div></div>)}
          <div className="mt-2 flex gap-2"><input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="app.example.com" className={input} /><button disabled={busy || !domain} onClick={() => run(() => call(`/api/projects/${projectId}/publish`, "POST", { action: "add_domain", hostname: domain }), () => "Domain added. Create the DNS records shown, then verify.")} className={button}>Add</button></div>
        </div>
      </>}
    </div>
    {backend?.connected && <div className={card}>
      <p className="text-[11px] font-medium">Database changes for review</p>
      <p className="mt-2 text-[10px] leading-4 text-white/50">NYNZ never holds your Supabase admin credentials, so it cannot apply SQL for you. Review each file, run it in your project's SQL editor (or with <code>supabase db push</code>), then check that the tables exist.{backend.validatedAt ? ` Connection verified ${new Date(backend.validatedAt).toLocaleString("en-IN")}.` : ""}</p>
      {backend.migrations?.length ? backend.migrations.map((m: Json) => <details key={m.path} className="mt-2 text-[10px] text-white/70"><summary className="cursor-pointer">{m.path} · {m.tables.join(", ") || "no new tables"}</summary><pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-black/30 p-2 text-[10px]">{m.sql}</pre><button onClick={() => navigator.clipboard.writeText(m.sql).then(() => onNotice("SQL copied."))} className="mt-1 text-[#c7ff4a]">Copy SQL</button></details>) : <p className="mt-2 text-[10px] text-white/45">No migration files yet. Ask NYNZ to add a table; it writes SQL to supabase/migrations/ with row-level security.</p>}
      {backend.migrations?.some((m: Json) => m.tables.length) && <button disabled={busy} onClick={() => run(() => call(`/api/projects/${projectId}/backend`, "POST", { action: "check_tables", tables: [...new Set(backend.migrations.flatMap((m: Json) => m.tables))] }), (r) => r.results.map((t: Json) => `${t.table}: ${t.status}`).join(", "))} className={`${button} mt-3`}>Check tables in Supabase</button>}
    </div>}
    <div className={card}>
      <p className="text-[11px] font-medium">GitHub</p>
      {!github?.available ? <p className="mt-2 text-[10px] leading-4 text-white/50">{github?.reason || "GitHub is not available yet."} You can still export a ZIP.</p>
        : !github.installations?.length ? <a href="/api/github/install" className={`${button} mt-3 inline-flex items-center`}>Connect GitHub</a>
        : <div className="mt-2 space-y-2"><input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repository" className={input} /><input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" className={input} />
          {github.link && <p className="text-[10px] text-white/45">Last {github.link.last_direction} {github.link.last_synced_at ? new Date(github.link.last_synced_at).toLocaleString("en-IN") : ""}</p>}
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || !repo} onClick={() => run(() => call(`/api/projects/${projectId}/github`, "POST", { action: "export", installationId: github.installations[0].installation_id, repository: repo, branch }), (r) => `Pushed ${r.files} files (commit ${String(r.commit).slice(0, 7)}).`)} className={button}>Push to GitHub</button>
            <button disabled={busy || !repo} onClick={() => { if (window.confirm("Replace this project's files with the branch contents? A checkpoint of the current files is saved first.")) void run(() => call(`/api/projects/${projectId}/github`, "POST", { action: "import", installationId: github.installations[0].installation_id, repository: repo, branch }), (r) => `Imported ${r.imported} files. Restart the preview to run them.`); }} className={button}>Import from GitHub</button>
          </div>
          <p className="text-[10px] leading-4 text-white/45">Environment files and anything that looks like a secret are never pushed. If the branch changed on GitHub since the last sync, NYNZ stops instead of overwriting it.</p></div>}
    </div>
  </>;
}
