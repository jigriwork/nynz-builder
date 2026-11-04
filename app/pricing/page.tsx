import type { Metadata } from "next";
import Link from "next/link";
import { createAdmin } from "@/lib/supabase/server";
import { grossWithTax, razorpayConfig } from "@/lib/billing/razorpay";
import { NynzBrand } from "@/components/nynz-brand";
import { InformationLinks } from "@/components/information-links";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Pricing",
  description: "NYNZ plans for building React web applications from a brief. Monthly credits cover measured AI and cloud usage. Prices exclude GST.",
  alternates: { canonical: "/pricing" },
};

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default async function PricingPage() {
  const paymentsAvailable=Boolean(razorpayConfig());
  let plans: Array<{ code: string; name: string; description: string | null; price_minor: number; tax_rate_bps: number; features: string[] }> = [];
  try {
    const { data } = await createAdmin().from("plans").select("code,name,description,price_minor,tax_rate_bps,features").is("retired_at", null).eq("public", true).order("price_minor");
    plans = (data || []) as typeof plans;
  } catch { plans = []; }
  return <main className="nynz-dark min-h-screen bg-[#070b12] text-[#f4f1e8]">
    <header className="mx-auto flex h-16 max-w-[1100px] items-center justify-between px-5"><Link href="/" aria-label="NYNZ home"><NynzBrand className="h-7" /></Link><Link href="/login" className="text-[13px] text-white/70 hover:text-white">Sign in</Link></header>
    <section className="mx-auto max-w-[1100px] px-5 pb-20 pt-10">
      <h1 className="text-4xl font-medium tracking-[-.05em] md:text-6xl">Simple monthly plans</h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-7 text-white/60">Every plan builds React, TypeScript and Vite web apps with private previews and full source export. Monthly credits pay for the AI and cloud resources each build uses, measured per model. Generation is never unlimited, and prices exclude GST.</p>
      {!paymentsAvailable&&<p className="mt-5 rounded-xl border border-white/[.1] bg-white/[.03] px-4 py-3 text-sm leading-6 text-white/65">Paid checkout is not available yet. Paid plans below are shown for reference; no purchase can be made. <Link href="/refund-policy" className="text-[#c7ff4a] hover:underline">Read the billing policy</Link>.</p>}
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {plans.length ? plans.map((plan) => <article key={plan.code} className={`rounded-2xl border p-6 ${plan.code === "pro" ? "border-[#c7ff4a]/40 bg-[#c7ff4a]/[.04]" : "border-white/[.1] bg-white/[.02]"}`}>
          <h2 className="text-lg font-medium">{plan.name}</h2>
          <p className="mt-3 text-3xl font-medium">{plan.price_minor ? rupees(plan.price_minor) : "₹0"}<span className="text-sm text-white/50">{plan.price_minor ? " / month + GST" : ""}</span></p>
          {plan.price_minor > 0 && <p className="mt-1 text-[11px] text-white/45">{rupees(grossWithTax(plan.price_minor, plan.tax_rate_bps))} charged including {plan.tax_rate_bps / 100}% GST</p>}
          <p className="mt-3 text-[13px] text-white/60">{plan.description}</p>
          <ul className="mt-4 space-y-1.5 text-[13px] text-white/80">{plan.features.map((feature) => <li key={feature}>· {feature}</li>)}</ul>
          {plan.price_minor&&!paymentsAvailable?<span className="mt-6 inline-flex h-10 items-center rounded-xl border border-white/[.1] px-4 text-[13px] text-white/45">Not available yet</span>:<Link href={plan.price_minor ? "/billing" : "/login"} className="mt-6 inline-flex h-10 items-center rounded-xl bg-[#c7ff4a] px-4 text-[13px] font-semibold text-[#071019]">{plan.price_minor ? `Choose ${plan.name}` : "Start free"}</Link>}
        </article>) : <p className="text-white/60">Plans are being updated. Please check back shortly.</p>}
      </div>
      <p className="mt-8 text-[12px] leading-5 text-white/45">NYNZ does not currently host published apps or provision backends for you; you can connect your own Supabase project and export your source at any time.</p>
    </section>
    <footer className="mx-auto max-w-[1100px] border-t border-white/[.08] px-5 py-8"><InformationLinks/></footer>
  </main>;
}
