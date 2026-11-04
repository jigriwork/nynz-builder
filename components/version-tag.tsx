import { VERSION_LABEL } from "@/lib/version";

export function VersionTag({ className = "" }: { className?: string }) {
  return <span className={`font-mono text-[10px] text-white/40 ${className}`}>NYNZ {VERSION_LABEL}</span>;
}
