/** Proud "Made in India" badge: tricolour edge and glow, a light sweep and a beating heart. */
export function MadeInOdisha({ className = "" }: { className?: string }) {
  return <p className={`nynz-proud relative inline-flex max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full px-3 py-2 text-[10px] font-semibold uppercase tracking-[.11em] text-[#f4f1e8] sm:gap-2 sm:px-4 sm:text-[12px] sm:tracking-[.16em] ${className}`}>
    <span className="relative">Made in <span className="nynz-tricolour text-[1.08em] font-extrabold">India</span> with love from Odisha</span>
    <span role="img" aria-label="red heart" className="nynz-heartbeat relative text-[14px] not-italic tracking-normal">❤️</span>
  </p>;
}
