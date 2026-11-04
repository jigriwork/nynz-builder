export function MadeInOdisha({ className = "" }: { className?: string }) {
  return <p className={`inline-flex items-center gap-1.5 rounded-full border border-white/[.08] bg-white/[.025] px-3 py-1 text-[10px] font-medium uppercase tracking-[.16em] text-white/60 ${className}`}>
    Made in India with love from Odisha <span role="img" aria-label="red heart" className="text-[12px] not-italic tracking-normal">❤️</span>
  </p>;
}
