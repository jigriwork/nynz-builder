"use client";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

export function ProjectFileSearch({ files, onSelect, onClose }: { files: Array<{ path: string; content: string }>; onSelect: (path: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files.map((file) => ({ path: file.path, line: null as number | null, excerpt: "" }));
    return files.flatMap((file) => {
      const lines = file.content.split("\n");
      const matches = lines.flatMap((text, index) => {
        const offset = text.toLowerCase().indexOf(needle);
        return offset < 0 ? [] : [{ path: file.path, line: index + 1, excerpt: text.slice(Math.max(0, offset - 40), offset + 120).trim() }];
      });
      return file.path.toLowerCase().includes(needle) ? [{ path: file.path, line: null, excerpt: "Filename match" }, ...matches] : matches;
    }).slice(0, 100);
  }, [files, query]);
  return <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label="Search project files" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }} className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/15 bg-[#101722] text-white shadow-2xl">
      <div className="flex items-center gap-3 border-b border-white/10 px-4"><Search className="h-4 w-4 text-white/50" /><input autoFocus aria-label="Search filenames and contents" placeholder="Search filenames and contents…" value={query} onChange={(event) => setQuery(event.target.value)} className="h-14 min-w-0 flex-1 bg-transparent text-sm outline-none" /><button aria-label="Close file search" onClick={onClose}><X className="h-4 w-4" /></button></div>
      <div aria-live="polite" className="max-h-[55vh] overflow-y-auto p-2">{results.map((result, index) => <button key={`${result.path}:${result.line}:${index}`} onClick={() => { onSelect(result.path); onClose(); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-white/10 focus:bg-white/10"><span className="font-mono text-xs text-[#c7ff4a]">{result.path}{result.line ? `:${result.line}` : ""}</span>{result.excerpt && <span className="mt-1 block truncate text-xs text-white/60">{result.excerpt}</span>}</button>)}{!results.length && <p className="p-4 text-sm text-white/55">No matching files or content.</p>}</div>
    </section>
  </div>;
}
