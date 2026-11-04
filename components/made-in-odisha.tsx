export function MadeInOdisha({ className = "", plain = false }: { className?: string; plain?: boolean }) {
  const frame = plain ? "text-white/45" : "rounded-full border border-white/[.08] bg-white/[.025] px-3 py-1 text-white/60";
  return <p className={`inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[.16em] ${frame} ${className}`}>
    <span>Made in <span className="nynz-tricolour font-semibold">India</span> with love from Odisha</span>
    <span role="img" aria-label="red heart" className="nynz-heartbeat text-[12px] not-italic tracking-normal">❤️</span>
  </p>;
}
