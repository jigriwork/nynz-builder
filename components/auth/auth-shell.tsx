import Link from "next/link";
import type { ReactNode } from "react";
import { NynzBrand } from "@/components/nynz-brand";

export function AuthShell({ eyebrow, title, children, back = { href: "/login", label: "Back to sign in" } }: { eyebrow: string; title: string; children: ReactNode; back?: { href: string; label: string } }) {
  return <main className="nynz-dark relative min-h-screen bg-[#070b12] text-[#f4f1e8]">
    <header className="mx-auto flex h-[76px] max-w-[1180px] items-center justify-between px-5 md:px-8"><Link href="/"><NynzBrand className="h-7" /></Link><Link href={back.href} className="text-xs text-white/55 hover:text-white">{back.label}</Link></header>
    <section className="mx-auto w-full max-w-[480px] px-5 pb-16 pt-6">
      <div className="rounded-[20px] border border-white/[.1] bg-[#0b121b] p-6 sm:p-8">
        <p className="text-[10px] font-medium uppercase tracking-[.2em] text-[#c7ff4a]">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-medium tracking-[-.04em]">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
    </section>
  </main>;
}

export const fieldClass = "mb-4 h-12 w-full rounded-xl border border-white/[.12] bg-white/[.035] px-4 text-sm text-white caret-[#c7ff4a] outline-none placeholder:text-white/35 focus:border-[#c7ff4a]/45";
export const buttonClass = "flex h-12 w-full items-center justify-center rounded-xl bg-[#c7ff4a] text-[13px] font-semibold text-[#071019] transition hover:bg-[#d5ff72] disabled:opacity-45";
