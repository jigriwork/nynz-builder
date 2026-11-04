import Link from "next/link";
import { loadStaff } from "@/lib/admin/session";
import { createAdmin } from "@/lib/supabase/server";
import { razorpayConfig, grossWithTax } from "@/lib/billing/razorpay";
import { Badge, Card, PageHeader, Table, rupees, when } from "@/components/admin/ui";
import { ActionForm } from "@/components/admin/action-form";

export const metadata = { title: "Plans and payments" };

export default async function BillingAdmin() {
  const { can, email } = await loadStaff("billing.read");
  const admin = createAdmin();
  const config = razorpayConfig();
  const [{ data: plans }, { data: subs }, { data: payments }, { data: refunds }, { data: events }, { data: expenses }, { data: packs }] = await Promise.all([
    admin.from("plans").select("*").order("code").order("version", { ascending: false }),
    admin.from("subscriptions").select("id,user_id,status,current_period_end,cancel_at_period_end,grace_until,provider_subscription_id,plan_id,created_at").order("created_at", { ascending: false }).limit(50),
    admin.from("payments").select("*").order("created_at", { ascending: false }).limit(50),
    admin.from("refunds").select("*").order("created_at", { ascending: false }).limit(30),
    admin.from("payment_events").select("event_id,event_type,event_created_at,received_at,outcome").order("id", { ascending: false }).limit(30),
    admin.from("company_expenses").select("*").order("incurred_on", { ascending: false }).limit(30),
    admin.from("topup_packs").select("*").order("code"),
  ]);
  const planName = new Map((plans || []).map((p) => [p.id, `${p.name} v${p.version}`]));
  return <>
    <PageHeader title="Plans and payments" description="Prices exclude GST; tax is stored separately and never counted as revenue. Subscriptions change state only from verified Razorpay webhooks or server reconciliation." />
    <div className={`mb-4 rounded-xl border p-3 text-[12px] ${config ? "border-[#c7ff4a]/25 text-[#c7ff4a]" : "border-amber-300/25 text-amber-100"}`}>
      {config ? `Razorpay connected in ${config.mode.toUpperCase()} mode.` : "Payments are not configured: set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET (test keys). Live keys are refused until BILLING_LIVE_ENABLED=true after merchant, GSTIN and invoice details are confirmed."}
    </div>
    <Card title="Plans">
      <Table head={["Plan", "Price (excl. GST)", "GST", "Charged", "Credits / month", "Builds at once", "Projects", "Razorpay plan", "Status"]} rows={(plans || []).map((p) => [`${p.name} v${p.version}`, rupees(p.price_minor), `${p.tax_rate_bps / 100}%`, rupees(grossWithTax(Number(p.price_minor), p.tax_rate_bps)), Number(p.monthly_credits).toLocaleString(), p.max_concurrent_builds, p.max_projects,
        p.provider_plan_id ? <code key="r" className="text-[10px]">{p.provider_plan_id}</code> : p.price_minor > 0 && !p.retired_at && can("plans.manage") && config ? <ActionForm key="l" action="plan.link_razorpay" email={email} compact submitLabel="Create in Razorpay" fields={[{ name: "planId", label: "", type: "hidden", defaultValue: p.id }, { name: "reason", label: "Reason", defaultValue: "Link plan to Razorpay" }]} /> : "—",
        p.retired_at ? <Badge key="s">retired {when(p.retired_at)}</Badge> : <Badge key="s" tone="good">current</Badge>])} />
      {can("plans.manage") && <details className="mt-4"><summary className="cursor-pointer text-[12px] text-white/70">Create a new plan version</summary><div className="mt-3 max-w-xl"><ActionForm action="plan.save" email={email} submitLabel="Save new version" fields={[
        { name: "code", label: "Code", type: "select", options: [["starter", "starter"], ["pro", "pro"], ["free", "free"]] }, { name: "name", label: "Name", required: true }, { name: "description", label: "Description" },
        { name: "priceRupees", label: "Monthly price in ₹ (excluding GST)", type: "number", required: true }, { name: "taxRateBps", label: "GST rate in basis points (1800 = 18%)", type: "number", defaultValue: 1800 },
        { name: "monthlyCredits", label: "Credits per month", type: "number", required: true }, { name: "maxConcurrent", label: "Builds at once", type: "number", defaultValue: 1 }, { name: "maxProjects", label: "Projects", type: "number", defaultValue: 10 },
        { name: "features", label: "Features (comma separated)", type: "csv" }, { name: "public", label: "Show on pricing", type: "checkbox", defaultValue: true }, { name: "reason", label: "Reason", required: true },
      ]} /><p className="mt-2 text-[11px] text-white/45">Existing subscribers keep the version they bought. A changed price needs a new Razorpay plan.</p></div></details>}
    </Card>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card title="Subscriptions"><Table head={["Customer", "Plan", "Status", "Period end", "Note"]} rows={(subs || []).map((s) => [<Link key="u" href={`/admin/users/${s.user_id}`} className="font-mono text-[10px] text-[#c7ff4a]">{s.user_id.slice(0, 8)}</Link>, planName.get(s.plan_id), s.status, when(s.current_period_end), s.cancel_at_period_end ? "cancels at period end" : s.grace_until ? `grace until ${when(s.grace_until)}` : ""])} empty="No subscriptions yet." /></Card>
      <Card title="Payments"><Table head={["When", "Kind", "Charged", "Tax", "Revenue", "Status", ""]} rows={(payments || []).map((p) => [when(p.captured_at || p.created_at), p.kind, rupees(p.amount_minor), rupees(p.tax_minor), rupees(p.net_minor), p.status,
        can("billing.refund") && ["captured", "partially_refunded"].includes(p.status) ? <details key="r"><summary className="cursor-pointer text-[11px] text-white/60">Refund</summary><ActionForm action="refund.request" email={email} danger submitLabel="Issue refund" confirmText="Issue this refund through Razorpay?" fields={[{ name: "paymentId", label: "", type: "hidden", defaultValue: p.id }, { name: "amountRupees", label: "Amount in ₹", type: "number", required: true }, { name: "reverseCredits", label: "Remove unused credits bought with this payment", type: "checkbox" }, { name: "reason", label: "Reason", required: true }]} /></details> : ""])} empty="No payments recorded." /></Card>
      <Card title="Refunds"><Table head={["When", "Amount", "Status", "Credits reversed", "Reason"]} rows={(refunds || []).map((r) => [when(r.created_at), rupees(r.amount_minor), r.status, r.credits_reversed, r.reason])} empty="No refunds." /></Card>
      <Card title="Webhook events" aside={can("billing.read") && config ? <ActionForm action="billing.reconcile" email={email} compact submitLabel="Reconcile with Razorpay" fields={[]} /> : undefined}><Table head={["Received", "Event", "Outcome"]} rows={(events || []).map((e) => [when(e.received_at), e.event_type, e.outcome || "—"])} empty="No webhook events received." /></Card>
      <Card title="Credit top-up packs"><Table head={["Pack", "Credits", "Price (excl. GST)", "Active"]} rows={(packs || []).map((p) => [p.name, p.credits, rupees(p.price_minor), p.active ? <Badge key="a" tone="good">on sale</Badge> : <Badge key="a">off</Badge>])} />
        {can("plans.manage") && <details className="mt-3"><summary className="cursor-pointer text-[12px] text-white/70">Edit a pack</summary><div className="mt-3"><ActionForm action="topup.save" email={email} submitLabel="Save pack" fields={[{ name: "code", label: "Code", defaultValue: "credits_100" }, { name: "name", label: "Name", defaultValue: "100 credits" }, { name: "credits", label: "Credits", type: "number", defaultValue: 100 }, { name: "priceRupees", label: "Price in ₹ (excluding GST)", type: "number", required: true }, { name: "active", label: "On sale", type: "checkbox" }, { name: "reason", label: "Reason", required: true }]} /></div></details>}
      </Card>
      <Card title="Company expenses"><Table head={["Date", "Category", "Vendor", "Amount", "Tax"]} rows={(expenses || []).map((e) => [e.incurred_on, e.category, e.vendor, rupees(e.amount_minor), rupees(e.tax_minor)])} empty="No expenses recorded." />
        {can("expenses.manage") && <details className="mt-3"><summary className="cursor-pointer text-[12px] text-white/70">Record an expense</summary><div className="mt-3"><ActionForm action="expense.record" email={email} submitLabel="Record expense" fields={[{ name: "category", label: "Category", type: "select", options: ["provider", "hosting", "database", "domain", "email", "monitoring", "payments", "support", "tax", "other"].map((c) => [c, c]) }, { name: "vendor", label: "Vendor", required: true }, { name: "description", label: "Description" }, { name: "amountRupees", label: "Amount in ₹", type: "number", required: true }, { name: "taxRupees", label: "Tax in ₹", type: "number", defaultValue: 0 }, { name: "incurredOn", label: "Date", type: "date", required: true }, { name: "reason", label: "Reason", required: true, defaultValue: "Monthly bookkeeping" }]} /></div></details>}
      </Card>
    </div>
  </>;
}
