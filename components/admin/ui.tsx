import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0"><h1 className="break-words text-2xl font-medium tracking-[-.03em] text-white md:text-3xl">{title}</h1>{description && <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-white/55">{description}</p>}</div>
    {actions}
  </div>;
}

export function Card({ title, children, className = "", aside }: { title?: string; children: ReactNode; className?: string; aside?: ReactNode }) {
  return <section className={`min-w-0 max-w-full rounded-xl border border-white/[.08] bg-[#0f1621] p-4 md:p-5 ${className}`}>
    {(title || aside) && <div className="mb-3 flex items-center justify-between gap-3">{title && <h2 className="text-[13px] font-medium text-white/85">{title}</h2>}{aside}</div>}
    {children}
  </section>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "bad" | "good" }) {
  const color = tone === "bad" ? "text-red-300" : tone === "warn" ? "text-amber-200" : tone === "good" ? "text-[#c7ff4a]" : "text-white";
  return <div className="min-w-0 rounded-xl border border-white/[.08] bg-[#0f1621] p-4">
    <p className="text-[11px] text-white/50">{label}</p>
    <p className={`mt-2 break-words text-xl font-medium tabular-nums tracking-[-.02em] sm:text-2xl ${color}`}>{value}</p>
    {hint && <p className="mt-1 text-[11px] leading-4 text-white/45">{hint}</p>}
  </div>;
}

export function Table({ head, rows, empty = "Nothing to show." }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="py-6 text-center text-[12px] leading-5 text-white/45">{empty}</p>;
  return <div className="max-w-full overflow-x-auto overscroll-x-contain"><table className={`w-full border-collapse text-left text-[12px] ${head.length > 3 ? "min-w-[560px]" : ""}`}>
    <thead><tr className="border-b border-white/[.08] text-[11px] text-white/45">{head.map((h) => <th key={h} className={`px-2 py-2 font-normal ${head.length > 3 ? "whitespace-nowrap" : ""}`}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={i} className="border-b border-white/[.05] align-top text-white/80 last:border-0">{row.map((cell, j) => <td key={j} className={`px-2 py-2.5 ${head.length > 3 ? "whitespace-nowrap" : ""}`}>{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const styles = { neutral: "border-white/15 text-white/70", good: "border-[#c7ff4a]/30 text-[#c7ff4a]", warn: "border-amber-300/30 text-amber-200", bad: "border-red-400/30 text-red-300" }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${styles}`}>{children}</span>;
}

export const rupees = (paise: number | string | null | undefined) => paise === null || paise === undefined ? "—" : `₹${(Number(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const when = (value: string | null | undefined) => value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";
export const ago = (value: string | null | undefined) => {
  if (!value) return "never";
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 90) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
};
