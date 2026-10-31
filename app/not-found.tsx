import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NynzBrand } from "@/components/nynz-brand";

export default function NotFound() {
  return <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#070b12] px-5 text-center text-[#f4f1e8]">
    <div aria-hidden className="absolute inset-0 nynz-auth-grid" />
    <div aria-hidden className="nynz-float absolute left-1/2 top-1/3 h-[420px] w-[680px] -translate-x-1/2 rounded-full bg-[#294662]/30 blur-[150px]" />
    <div className="relative">
      <Link href="/" className="inline-block"><NynzBrand className="h-7" /></Link>
      <p className="nynz-text-shine mt-12 text-[8rem] font-medium leading-none tracking-[-.08em] md:text-[11rem]">404</p>
      <h1 className="mt-2 text-2xl font-medium tracking-[-.04em]">This page hasn’t been built yet.</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-white/55">The link may be broken, or you may not have access to it.</p>
      <div className="mt-9 flex flex-wrap justify-center gap-3">
        <Link href="/dashboard" className="inline-flex h-11 items-center rounded-full bg-[#c7ff4a] px-5 text-[13px] font-semibold text-[#071019] transition hover:bg-[#d5ff72]">Go to your projects</Link>
        <Link href="/" className="inline-flex h-11 items-center gap-2 rounded-full border border-white/[.14] px-5 text-[13px] text-white/75 transition hover:bg-white/[.06]"><ArrowLeft className="h-3.5 w-3.5" /> Home</Link>
      </div>
    </div>
  </main>;
}
