import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NynzBrand } from "@/components/nynz-brand";
import { loadStaff } from "@/lib/admin/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Admin console", template: "%s · NYNZ admin" }, robots: { index: false, follow: false } };

const NAV: Array<[string, string, string]> = [
  ["/admin", "Overview", "overview.read"], ["/admin/users", "Users", "users.read"], ["/admin/projects", "Projects and builds", "projects.read"],
  ["/admin/credits", "Credits", "credits.read"], ["/admin/billing", "Plans and payments", "billing.read"], ["/admin/providers", "Providers and spend", "providers.read"],
  ["/admin/team", "Team", "team.read"], ["/admin/audit", "Audit history", "audit.read"],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { access, email } = await loadStaff();
  return <div className="nynz-dark min-h-screen overflow-x-hidden bg-[#070b12] text-[#f4f1e8]">
    <header className="sticky top-0 z-30 border-b border-white/[.07] bg-[#070b12]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex items-center gap-3"><Link href="/admin" aria-label="Admin console home"><NynzBrand className="h-6" /></Link><span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-[.14em] text-white/60">Admin</span></div>
        <div className="flex items-center gap-3 text-[12px]"><span className="hidden text-white/50 sm:inline">{email} · {access.role}</span><Link href="/dashboard" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[.12] px-3 py-1.5 text-white/80 transition hover:bg-white/[.06] hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> <span className="hidden min-[380px]:inline">Back to workspace</span><span className="min-[380px]:hidden">Workspace</span></Link></div>
      </div>
      <nav aria-label="Admin sections" className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-4 pb-2 md:px-6">
        {NAV.filter(([, , cap]) => access.capabilities.includes(cap)).map(([href, label]) => <Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] text-white/65 transition hover:bg-white/[.06] hover:text-white">{label}</Link>)}
      </nav>
    </header>
    {!access.mfa_enrolled && <div className="border-b border-amber-300/20 bg-[#231c0c] px-4 py-2 text-center text-[12px] text-amber-100">Protect this privileged account with two-factor authentication. <Link href="/account/security" className="underline">Set it up now</Link>.</div>}
    <main className="mx-auto w-full min-w-0 max-w-[1400px] px-4 py-6 md:px-6 md:py-8">{children}</main>
  </div>;
}
