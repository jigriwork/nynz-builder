import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { razorpayConfig, grossWithTax } from "@/lib/billing/razorpay";
import { NynzBrand } from "@/components/nynz-brand";
import { Card, Stat, Table, rupees, when } from "@/components/admin/ui";
import { BillingActions } from "./billing-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plan and billing", robots: { index: false } };

const ENTRY_LABEL: Record<string, string> = { grant: "Credits added", consume: "Used", expire: "Expired", adjust_debit: "Adjustment", reserve: "Held for a build", release: "Hold released", overrun_absorbed: "Covered by NYNZ" };

export default async function BillingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/billing");
  const [{ data: ent }, { data: balance }, { data: plans }, { data: subs }, { data: payments }, { data: ledger }, { data: packs }] = await Promise.all([
    supabase.rpc("my_entitlements"), supabase.rpc("my_credit_balance"),
    supabase.from("plans").select("code,name,description,price_minor,tax_rate_bps,monthly_credits,max_concurrent_builds,max_projects,features,provider_plan_id").is("retired_at", null).eq("public", true).order("price_minor"),
    supabase.from("subscriptions").select("status,current_period_end,cancel_at_period_end,grace_until,checkout_verified_at,plan_id,scheduled_plan_id").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1),
    supabase.from("payments").select("kind,amount_minor,tax_minor,net_minor,status,refunded_minor,provider_payment_id,provider_invoice_id,captured_at,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("credit_ledger").select("entry_type,amount,reason,provider,model,cost_source,created_at,metadata").eq("user_id", user.id).not("entry_type", "in", "(reserve,release)").order("id", { ascending: false }).limit(50),
    supabase.from("topup_packs").select("code,name,credits,price_minor,tax_rate_bps").eq("active", true),
  ]);
  const config = razorpayConfig();
  const sub = subs?.[0];
  const pendingActivation = sub?.checkout_verified_at && ["created", "authenticated"].includes(sub.status);
  return <div className="nynz-dark min-h-screen bg-[#070b12] text-[#f4f1e8]">
    <header className="border-b border-white/[.07]"><div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between px-4"><Link href="/dashboard"><NynzBrand className="h-6" /></Link><Link href="/dashboard" className="inline-flex items-center gap-1.5 text-[12px] text-white/70 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Back to workspace</Link></div></header>
    <main className="mx-auto max-w-[1100px] px-4 py-8">
      <h1 className="text-3xl font-medium tracking-[-.04em]">Plan and billing</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-5 text-white/55">Credits pay for the AI and cloud resources your builds use. Each credit covers ₹{(Number(process.env.PAISE_PER_CREDIT || 100) / 100).toFixed(2)} of measured provider cost; larger models and longer outputs use more credits. Generation is never unlimited.</p>
      {!config && <p className="mt-4 rounded-xl border border-amber-300/25 bg-[#231c0c] p-3 text-[12px] text-amber-100">Paid plans are not available yet. You can keep building with your trial and promotional credits.</p>}
      {config?.mode === "test" && <p className="mt-4 rounded-xl border border-sky-300/25 bg-[#0c1a23] p-3 text-[12px] text-sky-100">Test mode: payments use Razorpay test cards and no real money moves.</p>}
      {pendingActivation && <p className="mt-4 rounded-xl border border-[#c7ff4a]/25 p-3 text-[12px] text-[#c7ff4a]">Payment received. Your plan activates as soon as Razorpay confirms it. Refresh in a minute.</p>}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Current plan" value={ent?.plan_name || "Free"} hint={sub && ent?.plan_code !== "free" ? `${sub.cancel_at_period_end ? "Ends" : "Renews"} ${when(sub.current_period_end)}${ent?.grace_until ? ` · payment retrying until ${when(ent.grace_until)}` : ""}` : "No paid subscription"} />
        <Stat label="Available credits" value={Number(balance?.available || 0).toLocaleString()} tone="good" hint={balance?.next_expiry ? `Some expire ${when(balance.next_expiry)}` : undefined} />
        <Stat label="Builds at once" value={ent?.max_concurrent_builds ?? 1} hint={`Up to ${ent?.max_projects ?? 3} projects`} />
        <Stat label="Used so far" value={Number(balance?.used || 0).toLocaleString()} hint={`${Number(balance?.reserved || 0).toLocaleString()} held by running builds`} />
      </div>
      <Card title="Allowance" className="mt-4"><Table head={["Monthly plan", "Purchased", "Promotional", "Testing", "Held", "Available"]} rows={[[balance?.included, balance?.purchased, balance?.promotional, balance?.owner_testing, balance?.reserved, balance?.available].map((v) => Number(v || 0).toLocaleString())]} /></Card>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {(plans || []).filter((p) => p.price_minor > 0).map((p) => <Card key={p.code} title={p.name}>
          <p className="text-2xl font-medium">{rupees(p.price_minor)}<span className="text-[12px] text-white/50"> / month + GST ({rupees(grossWithTax(Number(p.price_minor), p.tax_rate_bps))} charged)</span></p>
          <p className="mt-2 text-[12px] text-white/60">{p.description}</p>
          <ul className="mt-3 space-y-1 text-[12px] text-white/75">{(p.features as string[]).map((f) => <li key={f}>· {f}</li>)}</ul>
          <div className="mt-4"><BillingActions kind="plan" plan={p.code} current={ent?.plan_code} hasSubscription={Boolean(sub && ["authenticated", "active", "pending"].includes(sub.status))} available={Boolean(config && p.provider_plan_id)} cancelScheduled={Boolean(sub?.cancel_at_period_end)} /></div>
        </Card>)}
      </div>
      {packs && packs.length > 0 && <Card title="Add credits" className="mt-4"><div className="flex flex-wrap gap-3">{packs.map((pack) => <BillingActions key={pack.code} kind="topup" pack={pack.code} label={`${pack.name} · ${rupees(grossWithTax(Number(pack.price_minor), pack.tax_rate_bps))} incl. GST`} available={Boolean(config)} />)}</div><p className="mt-2 text-[11px] text-white/45">Purchased credits stay valid for 12 months.</p></Card>}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Credit history"><Table head={["When", "Activity", "Credits", "Detail"]} rows={(ledger || []).map((l) => [when(l.created_at), ENTRY_LABEL[l.entry_type] || l.entry_type, l.entry_type === "overrun_absorbed" ? `${(l.metadata as { uncharged_credits?: number })?.uncharged_credits ?? 0} not charged` : Number(l.amount).toLocaleString(), l.reason || [l.provider, l.model].filter(Boolean).join(" · ")])} empty="No credit activity yet." /></Card>
        <Card title="Payments and invoices"><Table head={["Date", "For", "Charged", "GST", "Status", "Reference"]} rows={(payments || []).map((p) => [when(p.captured_at || p.created_at), p.kind === "topup" ? "Credits" : "Subscription", rupees(p.amount_minor), rupees(p.tax_minor), p.refunded_minor > 0 ? `${p.status} (${rupees(p.refunded_minor)} refunded)` : p.status, <code key="r" className="text-[10px]">{p.provider_invoice_id || p.provider_payment_id}</code>])} empty="No payments yet." />
          <p className="mt-2 text-[11px] text-white/45">Razorpay emails a receipt for every payment. GST tax invoices will be issued once NYNZ's GST registration details are configured.</p></Card>
      </div>
    </main>
  </div>;
}
