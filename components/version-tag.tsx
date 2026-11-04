import { BUILD, VERSION_LABEL } from "@/lib/version";

export function VersionTag({ className = "" }: { className?: string }) {
  return <a href="/version" title={BUILD.builtAt ? `Built ${BUILD.builtAt}` : undefined} className={`font-mono text-[10px] text-white/40 hover:text-white/70 ${className}`}>NYNZ {VERSION_LABEL}</a>;
}
