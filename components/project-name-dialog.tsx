"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";

export function ProjectNameDialog({ project, onClose, onSaved }: { project: { id: string; name: string }; onClose: () => void; onSaved: (project: { id: string; name: string; updated_at: string }) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not rename project");
      onSaved(body.project);
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not rename project"); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} aria-labelledby="rename-project-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }} className="nynz-dark fixed inset-0 z-[100] m-auto w-[calc(100%_-_32px)] max-w-sm rounded-2xl border border-white/10 bg-[#101823] p-0 text-[#f4f1e8] shadow-[0_30px_100px_rgba(0,0,0,.6)] backdrop:bg-black/65 backdrop:backdrop-blur-sm">
    <form onSubmit={save} className="p-5">
      <div className="flex items-center justify-between"><h2 id="rename-project-title" className="text-base font-medium">Rename project</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Close rename dialog" className="grid h-8 w-8 place-items-center rounded-lg text-white/45 hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button></div>
      <p className="mt-2 text-xs leading-5 text-white/45">Choose the name shown in your workspace. Your app content and preview address stay the same.</p>
      <label htmlFor="rename-project-input" className="mt-5 block text-[11px] text-white/65">Project name</label>
      <input id="rename-project-input" autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} onFocus={event => event.currentTarget.select()} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-[#080f18] px-3 text-sm text-white caret-[#c7ff4a] outline-none [color-scheme:dark] focus:border-[#c7ff4a]/40" />
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="h-9 rounded-lg px-3 text-xs text-white/55">Cancel</button><button disabled={busy || !name.trim()} className="flex h-9 items-center gap-2 rounded-lg bg-[#c7ff4a] px-4 text-xs font-semibold text-[#071019] disabled:opacity-40">{busy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}Save name</button></div>
    </form>
  </dialog>;
}
