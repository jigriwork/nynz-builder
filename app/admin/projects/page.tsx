import Link from "next/link";
import { loadStaff } from "@/lib/admin/session";
import { createAdmin } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Table, when } from "@/components/admin/ui";

export const metadata = { title: "Projects and builds" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase } = await loadStaff("projects.read");
  const q = (await searchParams).q || "";
  const [{ data: projects }, { data: failures }, { data: active }] = await Promise.all([
    supabase.rpc("admin_search_projects", { p_query: q, p_limit: 50 }),
    createAdmin().from("build_jobs").select("id,project_id,mode,error_code,error_message,created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(25),
    createAdmin().from("build_jobs").select("id,project_id,status,mode,locked_by,locked_at,created_at,cancel_requested_at").in("status", ["queued", "planning", "generating", "installing", "running", "validating"]).order("created_at").limit(50),
  ]);
  const tone = (s: string) => (s === "succeeded" || s === "ready" ? "good" : s === "failed" ? "bad" : "neutral") as "good" | "bad" | "neutral";
  return <>
    <PageHeader title="Projects and builds" description="Look up projects by name, project ID, owner email or owner ID. Opening private source requires a reason and is recorded." />
    <form className="mb-4 flex gap-2"><input name="q" defaultValue={q} placeholder="Project, owner email or ID" className="flex-1 rounded-lg border border-white/[.12] bg-[#0a1018] px-3 py-2 text-[12px] text-white outline-none placeholder:text-white/35 focus:border-[#c7ff4a]/50" /><button className="rounded-lg bg-[#c7ff4a] px-4 text-[12px] font-medium text-[#071019]">Search</button></form>
    <Card title="Projects"><Table head={["Project", "Owner", "Status", "Last build", "Revision (source / preview)", "Updated"]} rows={((projects || []) as Array<Record<string, any>>).map((p) => [<Link key="p" href={`/admin/projects/${p.id}`} className="text-[#c7ff4a] hover:underline">{p.name}</Link>, p.owner_email, <Badge key="s" tone={tone(p.status)}>{p.status}</Badge>, p.last_build_status || "—", `${p.source_revision} / ${p.preview_revision ?? "—"}`, when(p.updated_at)])} empty="No projects match." /></Card>
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Active and queued builds"><Table head={["Build", "Status", "Mode", "Worker", "Heartbeat", "Created"]} rows={(active || []).map((b) => [<Link key="b" href={`/admin/projects/${b.project_id}`} className="font-mono text-[10px] text-[#c7ff4a]">{b.id.slice(0, 8)}</Link>, b.cancel_requested_at ? <Badge key="c" tone="warn">cancelling</Badge> : b.status, b.mode, b.locked_by ? b.locked_by.split(":")[0] : "—", when(b.locked_at), when(b.created_at)])} empty="Nothing is queued or running." /></Card>
      <Card title="Recent failures"><Table head={["Build", "Mode", "Code", "Message", "When"]} rows={(failures || []).map((b) => [<Link key="b" href={`/admin/projects/${b.project_id}`} className="font-mono text-[10px] text-[#c7ff4a]">{b.id.slice(0, 8)}</Link>, b.mode, <code key="c" className="text-[10px]">{b.error_code || "BUILD_FAILED"}</code>, <span key="m" className="text-white/60">{b.error_message}</span>, when(b.created_at)])} empty="No recent failures." /></Card>
    </div>
  </>;
}
