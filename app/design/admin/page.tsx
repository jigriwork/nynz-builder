import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NynzBrand } from "@/components/nynz-brand";
import { Badge, Card, PageHeader, Stat, Table } from "@/components/admin/ui";

/** Development-only layout fixture for the admin console at phone and desktop widths. */
export default function AdminDesignFixture() {
  if (process.env.NODE_ENV === "production") notFound();
  const rows = Array.from({ length: 4 }, (_, i) => [`customer-${i}@example.com`, "4 Nov 2026, 2:15 pm", "Yes", "3 min ago", "just now", <Badge key="b" tone="good">online (approx.)</Badge>, "starter", 3, <Badge key="s">active</Badge>]);
  return <div className="nynz-dark min-h-screen overflow-x-hidden bg-[#070b12] text-[#f4f1e8]">
    <header className="sticky top-0 z-30 border-b border-white/[.07] bg-[#070b12]/90"><div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-3 px-4"><div className="flex items-center gap-3"><NynzBrand className="h-6" /><span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-[.14em] text-white/60">Admin</span></div><Link href="/dashboard" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[.12] px-3 py-1.5 text-[12px] text-white/80"><ArrowLeft className="h-3.5 w-3.5" /> <span className="hidden min-[380px]:inline">Back to workspace</span><span className="min-[380px]:hidden">Workspace</span></Link></div>
      <nav className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-4 pb-2">{["Overview", "Users", "Projects and builds", "Credits", "Plans and payments", "Providers and spend", "Team", "Audit history"].map((l) => <span key={l} className="whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] text-white/65">{l}</span>)}</nav></header>
    <main className="mx-auto w-full min-w-0 max-w-[1400px] px-4 py-6">
      <PageHeader title="Overview" description="Figures for 2026-10-05 to 2026-11-04 (India time). Last updated 4 Nov 2026, 3:07 pm." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Registered users" value={2} hint="2 new in range · 2 verified" /><Stat label="Collected" value="₹1,17,882.00" hint="incl. tax" /><Stat label="Queue" value={0} /><Stat label="Workers" value={1} tone="good" hint="All reporting" /></div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Money in range (INR)"><Table head={["Measure", "Amount"]} rows={[["Collected from customers (incl. tax)", "₹0.00"], ["Tax collected (not revenue)", "₹0.00"], ["Revenue excluding tax", "₹0.00"]]} /><p className="mt-3 text-[11px] leading-4 text-white/45">Profit is not calculated here: provider invoices, shared hosting costs and payment fees are only included when they are recorded as expenses.</p></Card>
        <Card title="Provider balances"><Table head={["Provider", "Balance", "Source", "As of"]} rows={[]} empty="No balances recorded yet. Refresh from Providers, or enter dashboard balances manually." /></Card>
        <Card title="Users"><Table head={["Email", "Registered", "Verified", "Last sign-in", "Last activity", "Seen", "Plan", "Projects", "Status"]} rows={rows} /></Card>
      </div>
    </main>
  </div>;
}
