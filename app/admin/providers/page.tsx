import { loadStaff } from "@/lib/admin/session";
import { createAdmin } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Table, rupees, when } from "@/components/admin/ui";
import { ActionForm } from "@/components/admin/action-form";

export const metadata = { title: "Providers and spend" };

export default async function ProvidersPage() {
  const { can, email } = await loadStaff("providers.read");
  const admin = createAdmin();
  const monthStart = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 8) + "01T00:00:00+05:30");
  const [{ data: spend }, { data: limits }, { data: balances }] = await Promise.all([
    admin.from("provider_spend").select("provider,kind,estimated_paise,actual_paise,cost_source,status,created_at").gte("created_at", monthStart.toISOString()).limit(5000),
    admin.from("spend_limits").select("*").order("created_at"),
    admin.from("provider_balance_snapshots").select("*").order("as_of", { ascending: false }).limit(40),
  ]);
  const byProvider = new Map<string, { reported: number; estimated: number; pending: number; calls: number }>();
  for (const row of spend || []) {
    const entry = byProvider.get(row.provider) || { reported: 0, estimated: 0, pending: 0, calls: 0 };
    entry.calls += 1;
    if (row.status === "voided") continue;
    if (row.status === "authorized") entry.pending += Number(row.estimated_paise);
    else if (row.cost_source === "provider_reported") entry.reported += Number(row.actual_paise);
    else entry.estimated += Number(row.actual_paise ?? row.estimated_paise);
    byProvider.set(row.provider, entry);
  }
  const configured = (key: string) => Boolean(process.env[key]);
  return <>
    <PageHeader title="Providers and spend" description={`Month to date from ${when(monthStart.toISOString())}. “Provider-reported” is cost returned by the provider with each call; “estimated” uses NYNZ's dated price table; “awaiting result” is held against limits until the call reports.`} />
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Configuration">
        <Table head={["Service", "Role", "Status"]} rows={[
          ["OpenRouter", "Planning and generation (used by the worker)", "See worker health on the Overview"],
          ["Firecrawl", "Website reference import", configured("FIRECRAWL_API_KEY") ? <Badge key="f" tone="good">configured</Badge> : <Badge key="f">not configured</Badge>],
          ["E2B", "Terminal on the web app; builds use the worker", configured("E2B_API_KEY") ? <Badge key="e" tone="good">set on web app</Badge> : <Badge key="e" tone="bad">missing on web app</Badge>],
          ["Razorpay", "Subscriptions and top-ups", configured("RAZORPAY_KEY_ID") ? <Badge key="r" tone="good">configured</Badge> : <Badge key="r">not configured</Badge>],
          ["Preview signing", "Preview sessions (web app and preview host)", configured("PREVIEW_SIGNING_SECRET") ? <Badge key="p" tone="good">set on web app</Badge> : <Badge key="p" tone="bad">missing on web app</Badge>],
        ]} />
      </Card>
      <Card title="Spending this month">
        <Table head={["Provider", "Provider-reported", "Estimated", "Awaiting result", "Calls"]} rows={[...byProvider].map(([provider, s]) => [provider, rupees(s.reported), rupees(s.estimated), rupees(s.pending), s.calls])} empty="No metered spending this month." />
      </Card>
      <Card title="Balances and quotas" aside={<ActionForm action="providers.refresh" email={email} compact submitLabel="Refresh from provider APIs" fields={[]} />}>
        <Table head={["Provider", "Balance", "Usage", "Source", "As of", "Note"]} rows={(balances || []).map((b) => [b.provider, b.balance_amount === null ? "—" : `${Number(b.balance_amount).toLocaleString()} ${b.balance_currency || ""}`, b.usage_amount === null ? "—" : Number(b.usage_amount).toLocaleString(), b.source, when(b.as_of), <span key="n" className="text-white/50">{b.note}</span>])} empty="No balances recorded." />
        <p className="mt-2 text-[11px] text-white/45">E2B, Sarvam, Supabase, Vercel and Render balances are not read from an API. Enter them from each dashboard with the date you read them.</p>
        {can("expenses.manage") && <details className="mt-3"><summary className="cursor-pointer text-[12px] text-white/70">Enter a balance manually</summary><div className="mt-3"><ActionForm action="provider_balance.record" email={email} submitLabel="Save balance" fields={[{ name: "provider", label: "Provider", type: "select", options: ["e2b", "openrouter", "firecrawl", "sarvam", "supabase", "vercel", "render", "other"].map((p) => [p, p]) }, { name: "balance", label: "Balance", type: "number", required: true }, { name: "currency", label: "Currency", defaultValue: "USD" }, { name: "asOf", label: "Read at", type: "datetime", required: true }, { name: "note", label: "Note", defaultValue: "Entered from provider dashboard" }]} /></div></details>}
      </Card>
      <Card title="Spending limits">
        <Table head={["Name", "Provider", "Period", "Limit", "Warn at", "Active"]} rows={(limits || []).map((l) => [l.name, l.provider || "All", l.period === "window" ? `${when(l.window_start)} – ${when(l.window_end)}` : l.period, rupees(l.limit_paise), `${l.warn_at_percent}%`, l.active ? <Badge key="a" tone="good">on</Badge> : <Badge key="a">off</Badge>])} />
        <p className="mt-2 text-[11px] text-white/45">Every provider call is checked against all active limits before it is sent. A call that would exceed a limit is refused and the build stops with the previous app intact.</p>
        {can("providers.manage") && <details className="mt-3"><summary className="cursor-pointer text-[12px] text-white/70">Add a limit</summary><div className="mt-3"><ActionForm action="spend_limit.save" email={email} submitLabel="Save limit" fields={[{ name: "name", label: "Name", required: true }, { name: "provider", label: "Provider", type: "select", options: [["", "All providers"], ["openrouter", "OpenRouter"], ["e2b", "E2B"], ["firecrawl", "Firecrawl"]] }, { name: "period", label: "Period", type: "select", options: [["day", "Per day"], ["month", "Per month"], ["window", "Fixed window"]] }, { name: "limitRupees", label: "Limit in ₹", type: "number", required: true }, { name: "warnAtPercent", label: "Warn at %", type: "number", defaultValue: 80 }, { name: "windowStart", label: "Window start", type: "datetime" }, { name: "windowEnd", label: "Window end", type: "datetime" }, { name: "active", label: "Active", type: "checkbox", defaultValue: true }, { name: "reason", label: "Reason", required: true }]} /></div></details>}
      </Card>
    </div>
  </>;
}
