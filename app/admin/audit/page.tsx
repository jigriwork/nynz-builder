import { loadStaff } from "@/lib/admin/session";
import { Badge, Card, PageHeader, Table, when } from "@/components/admin/ui";

export const metadata = { title: "Audit history" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase } = await loadStaff("audit.read");
  const params = await searchParams;
  let query = supabase.from("admin_audit_log").select("id,occurred_at,actor_email,actor_kind,action,target_type,target_id,reason,before,after,outcome").order("id", { ascending: false }).limit(100);
  if (params.action) query = query.ilike("action", `${params.action.replace(/[%_]/g, "")}%`);
  if (params.target) query = query.eq("target_id", params.target);
  if (params.before) query = query.lt("id", Number(params.before));
  const { data: rows } = await query;
  const last = rows?.[rows.length - 1]?.id;
  return <>
    <PageHeader title="Audit history" description="Append-only and hash-chained. Nobody, including owners and the platform service, can edit or delete entries. Secret-looking values are redacted before storage." />
    <form className="mb-4 flex flex-wrap gap-2"><input name="action" defaultValue={params.action} placeholder="Action prefix, e.g. staff. or credits." className="rounded-lg border border-white/[.12] bg-[#0a1018] px-3 py-2 text-[12px] text-white" /><input name="target" defaultValue={params.target} placeholder="Target ID" className="rounded-lg border border-white/[.12] bg-[#0a1018] px-3 py-2 text-[12px] text-white" /><button className="rounded-lg bg-[#c7ff4a] px-4 text-[12px] font-medium text-[#071019]">Filter</button></form>
    <Card><Table head={["When", "Actor", "Action", "Target", "Reason", "Change", "Outcome"]} rows={(rows || []).map((r) => [when(r.occurred_at), r.actor_email || r.actor_kind, <code key="a" className="text-[10px]">{r.action}</code>, <span key="t" className="text-[10px] text-white/55">{r.target_type} {r.target_id?.slice(0, 12)}</span>, r.reason || "", <details key="d"><summary className="cursor-pointer text-[10px] text-white/50">view</summary><pre className="max-w-xs overflow-auto text-[10px] text-white/60">{JSON.stringify({ before: r.before, after: r.after }, null, 1)}</pre></details>, <Badge key="o" tone={r.outcome === "failed" ? "bad" : r.outcome === "succeeded" ? "good" : "neutral"}>{r.outcome}</Badge>])} empty="No audit entries match." />
      {last && rows!.length === 100 && <a href={`/admin/audit?${new URLSearchParams({ ...(params.action ? { action: params.action } : {}), ...(params.target ? { target: params.target } : {}), before: String(last) })}`} className="mt-3 inline-block text-[12px] text-white/70">Older →</a>}
    </Card>
  </>;
}
