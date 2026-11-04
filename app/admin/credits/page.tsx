import Link from "next/link";
import { loadStaff } from "@/lib/admin/session";
import { createAdmin } from "@/lib/supabase/server";
import { Card, PageHeader, Stat, Table, rupees, when } from "@/components/admin/ui";
import { ActionForm } from "@/components/admin/action-form";

export const metadata = { title: "Credits" };

export default async function CreditsPage() {
  const { supabase, can, email, user, access } = await loadStaff("credits.read");
  const admin = createAdmin();
  const [{ data: ledger }, { data: grants }, { data: limits }, { data: reservations }, { data: budget }] = await Promise.all([
    supabase.from("credit_ledger").select("id,user_id,entry_type,amount,reason,provider,model,cost_paise,cost_source,actor_id,created_at").order("id", { ascending: false }).limit(60),
    supabase.from("credit_grants").select("source,remaining,expires_at"),
    admin.from("staff_credit_limits").select("*"),
    supabase.from("credit_reservations").select("id,user_id,amount,consumed,created_at").eq("status", "active").order("created_at").limit(50),
    admin.from("owner_testing_budget").select("monthly_credit_cap").maybeSingle(),
  ]);
  const live = (grants || []).filter((g) => !g.expires_at || new Date(g.expires_at) > new Date());
  const sum = (source: string[]) => live.filter((g) => source.includes(g.source)).reduce((s, g) => s + Number(g.remaining), 0);
  return <>
    <PageHeader title="Credits" description={`Credits are NYNZ's allowance unit: 1 credit = ₹${(Number(process.env.PAISE_PER_CREDIT || 100) / 100).toFixed(2)} of measured provider cost. Customer balances are separate from provider balances and from company money.`} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="Included (plans)" value={sum(["plan_included"]).toLocaleString()} /><Stat label="Purchased" value={sum(["purchased"]).toLocaleString()} />
      <Stat label="Promotional and adjustments" value={sum(["promotional", "adjustment", "refund_restore"]).toLocaleString()} /><Stat label="Owner testing" value={sum(["owner_testing"]).toLocaleString()} hint={`Budget ${budget?.monthly_credit_cap ?? 0} per 30 days`} />
      <Stat label="Held by running work" value={(reservations || []).reduce((s, r) => s + Number(r.amount) - Number(r.consumed), 0).toLocaleString()} />
    </div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card title="Recent ledger entries"><Table head={["When", "User", "Type", "Credits", "Detail"]} rows={(ledger || []).map((l) => [when(l.created_at), <Link key="u" href={`/admin/users/${l.user_id}`} className="font-mono text-[10px] text-[#c7ff4a]">{l.user_id.slice(0, 8)}</Link>, l.entry_type, Number(l.amount).toLocaleString(), <span key="d" className="text-white/60">{l.reason || [l.provider, l.model, l.cost_paise !== null ? rupees(l.cost_paise) : null, l.cost_source].filter(Boolean).join(" · ")}</span>])} empty="No credit activity yet." /></Card>
      <div className="space-y-4">
        <Card title="Staff grant limits"><Table head={["Role", "Per grant", "Per day"]} rows={(limits || []).map((l) => [l.role, l.max_per_grant ?? "No limit", l.max_per_day ?? "No limit"])} /><p className="mt-2 text-[11px] text-white/45">Grants to customers are made from a user's page and require a reason. Duplicate submissions are rejected by idempotency key.</p></Card>
        {access.role === "owner" && can("credits.grant") && <Card title="Owner testing allowance"><p className="mb-3 text-[12px] text-white/55">Explicit, metered credits for your own test builds. They must expire within 31 days and stay within the monthly budget. Platform spend caps still apply.</p><ActionForm action="credits.grant" email={email} submitLabel="Grant owner testing credits" fields={[{ name: "userId", label: "", type: "hidden", defaultValue: user.id }, { name: "amount", label: "Credits", type: "number", required: true, defaultValue: 50 }, { name: "source", label: "", type: "hidden", defaultValue: "owner_testing" }, { name: "expiresAt", label: "Expires", type: "datetime", required: true }, { name: "reason", label: "Reason", required: true, defaultValue: "Owner verification builds" }, { name: "idempotencyKey", label: "", type: "idempotency" }]} /></Card>}
      </div>
    </div>
  </>;
}
