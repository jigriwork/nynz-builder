import { loadStaff } from "@/lib/admin/session";
import { Badge, Card, PageHeader, Stat, Table, ago, rupees, when } from "@/components/admin/ui";
import { ActionForm } from "@/components/admin/action-form";
import { createAdmin } from "@/lib/supabase/server";

export const metadata = { title: "Overview" };

function range(params: Record<string, string | undefined>) {
  const to = params.to ? new Date(`${params.to}T23:59:59+05:30`) : new Date();
  const from = params.from ? new Date(`${params.from}T00:00:00+05:30`) : new Date(to.getTime() - 30 * 86400_000);
  return { from, to };
}

export default async function AdminOverview({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, can, email } = await loadStaff("overview.read");
  const { from, to } = range(await searchParams);
  const [{ data: o, error }, { data: limits }, { data: balances }] = await Promise.all([
    supabase.rpc("admin_overview", { p_from: from.toISOString(), p_to: to.toISOString() }),
    can("providers.read") ? createAdmin().from("spend_limits").select("*").eq("active", true) : Promise.resolve({ data: [] }),
    can("providers.read") ? createAdmin().from("provider_balance_snapshots").select("*").order("as_of", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
  ]);
  if (error || !o) return <p className="text-red-300">The overview could not be loaded.</p>;
  const spendToday = (o.provider_spend as Array<{ actual_minor: number; estimated_minor: number }>).reduce((sum, p) => sum + Number(p.actual_minor) + Number(p.estimated_minor), 0);
  const staleWorkers = (o.workers as Array<{ stale: boolean }>).filter((w) => w.stale).length;
  const latestBalance = new Map<string, Record<string, unknown>>();
  for (const b of balances || []) if (!latestBalance.has(String(b.provider))) latestBalance.set(String(b.provider), b);
  const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return <>
    <PageHeader title="Overview" description={`Figures for ${ymd(from)} to ${ymd(to)} (India time). Last updated ${when(o.generated_at)}.`} actions={
      <form className="flex flex-wrap items-end gap-2 text-[11px]"><label className="text-white/55">From<input type="date" name="from" defaultValue={ymd(from)} className="ml-2 rounded-lg border border-white/[.12] bg-[#0a1018] px-2 py-1.5 text-white" /></label><label className="text-white/55">To<input type="date" name="to" defaultValue={ymd(to)} className="ml-2 rounded-lg border border-white/[.12] bg-[#0a1018] px-2 py-1.5 text-white" /></label><button className="rounded-lg border border-white/[.15] px-3 py-1.5 text-white/85 hover:bg-white/[.06]">Apply</button></form>
    } />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Registered users" value={o.users.registered} hint={`${o.users.registered_in_range} new in range · ${o.users.verified} verified`} />
      <Stat label="Active in range" value={o.users.active_in_range} hint={`${o.users.present_now_approx} seen in the last 2 minutes (approximate)`} />
      <Stat label="Paying customers" value={o.users.paying} hint={`${o.users.suspended} suspended accounts`} />
      <Stat label="Projects" value={o.projects.total} hint={`${o.projects.created_in_range} created in range`} />
      <Stat label="Builds succeeded" value={o.builds.succeeded} tone="good" hint={`of ${o.builds.total} in range`} />
      <Stat label="Builds failed" value={o.builds.failed} tone={o.builds.failed > o.builds.succeeded ? "bad" : undefined} hint={`${o.builds.cancelled} cancelled`} />
      <Stat label="Queue" value={o.queue.queued} hint={`${o.queue.running} running · ${o.queue.awaiting_approval} awaiting approval${o.queue.oldest_queued_at ? ` · oldest ${ago(o.queue.oldest_queued_at)}` : ""}`} tone={o.queue.queued > 5 ? "warn" : undefined} />
      <Stat label="Workers" value={(o.workers as unknown[]).length - staleWorkers} hint={staleWorkers ? `${staleWorkers} not reporting` : "All reporting"} tone={staleWorkers || !(o.workers as unknown[]).length ? "bad" : "good"} />
    </div>
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Money in range (INR)">
        <Table head={["Measure", "Amount"]} rows={[
          ["Collected from customers (incl. tax)", rupees(o.money.gross_collected_minor)], ["Tax collected (not revenue)", rupees(o.money.tax_collected_minor)],
          ["Revenue excluding tax", rupees(o.money.revenue_net_minor)], ["Refunds processed", rupees(o.money.refunds_minor)],
          ["Recorded company expenses", rupees(o.money.recorded_expenses_minor)], ["Failed payments", o.money.failed_payments],
        ]} />
        <p className="mt-3 text-[11px] leading-4 text-white/45">Profit is not calculated here: provider invoices, shared hosting costs and payment fees are only included when they are recorded as expenses.</p>
      </Card>
      <Card title="Provider spending in range">
        <Table head={["Provider", "Provider-reported", "Estimated", "Calls"]} rows={(o.provider_spend as Array<Record<string, number | string>>).map((p) => [p.provider, rupees(p.actual_minor), rupees(p.estimated_minor), p.calls])} empty="No metered provider spending in this range." />
        {(limits || []).map((l) => { const pct = l.period === "day" ? Math.round((spendToday / l.limit_paise) * 100) : null; return <p key={l.id} className="mt-2 text-[11px] text-white/55">Limit “{l.name}”: {rupees(l.limit_paise)} per {l.period}{pct !== null && pct >= l.warn_at_percent ? <> · <Badge tone="warn">{pct}% used in range</Badge></> : null}</p>; })}
      </Card>
      <Card title="Provider balances">
        <Table head={["Provider", "Balance", "Source", "As of"]} rows={[...latestBalance.values()].map((b) => [String(b.provider), b.balance_amount === null ? "—" : `${Number(b.balance_amount).toLocaleString()} ${b.balance_currency || ""}`, String(b.source), when(String(b.as_of))])} empty="No balances recorded yet. Refresh from Providers, or enter dashboard balances manually." />
      </Card>
      <Card title="Workers, previews and cleanup">
        <Table head={["Worker", "Version", "Status", "Last seen", "Needs"]} rows={(o.workers as Array<Record<string, any>>).map((w) => [w.worker_id, <span key="v" className="font-mono text-[10px]">{w.capabilities?.version ? `v${w.capabilities.version} · ${w.capabilities.commit}` : "unknown"}</span>, w.stale ? <Badge key="s" tone="bad">not reporting</Badge> : <Badge key="s" tone="good">{w.status}</Badge>, ago(w.last_seen_at), <span key="n" className="flex flex-wrap gap-1">{[["generation", "OpenRouter"], ["sandbox", "E2B"], ["preview_origin", "Preview origin"]].map(([k, l]) => <Badge key={k} tone={w.capabilities?.[k] ? "good" : "bad"}>{l}</Badge>)}</span>])} empty="No worker has reported in the last 7 days." />
        <p className="mt-3 text-[12px] text-white/65">Live previews: {o.previews.live} · awaiting cleanup: {o.previews.pending_cleanup} · cleanup failures: {o.previews.cleanup_failed}</p>
        <p className="mt-1 text-[11px] text-white/45">Last reconciliation: {o.last_maintenance ? `${when(o.last_maintenance.finished_at || o.last_maintenance.started_at)}${o.last_maintenance.error ? " (failed)" : ""}` : "never"} · Publishing: see Projects (not yet live)</p>
        {can("operations.cleanup") && <div className="mt-3"><ActionForm action="maintenance.run" email={email} compact submitLabel="Run cleanup now" fields={[{ name: "reason", label: "Reason", defaultValue: "Manual reconciliation from overview" }]} /></div>}
      </Card>
    </div>
    <Card title="Historical usage records in range" className="mt-4">
      <Table head={["Provider", "Kind", "Quantity", "Estimated cost"]} rows={(o.historical_usage as Array<Record<string, any>>).map((u) => [u.provider, u.kind.replaceAll("_", " "), Number(u.quantity).toLocaleString(), rupees(u.estimated_cost_minor)])} empty="No usage recorded in this range." />
    </Card>
  </>;
}
