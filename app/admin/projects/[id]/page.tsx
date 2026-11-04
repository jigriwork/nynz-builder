import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStaff } from "@/lib/admin/session";
import { Badge, Card, PageHeader, Table, rupees, when } from "@/components/admin/ui";
import { ActionForm } from "@/components/admin/action-form";

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, can, email } = await loadStaff("projects.read");
  const { data: d } = await supabase.rpc("admin_project_detail", { p_project: id });
  if (!d?.project) notFound();
  const p = d.project;
  const ACTIVE = ["queued", "planning", "generating", "installing", "running", "validating"];
  return <>
    <PageHeader title={p.name} description={`Owner ${p.owner_email} · ${p.file_count} files · source revision ${p.source_revision}, preview revision ${p.preview_revision ?? "none"}`} actions={<Link href="/admin/projects" className="text-[12px] text-white/60 hover:text-white">← All projects</Link>} />
    {p.last_error && <p className="mb-4 rounded-lg border border-red-400/20 bg-red-400/[.06] p-3 text-[12px] text-red-200">{p.last_error}</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Builds">
        <Table head={["Build", "Status", "Mode", "Error", "Created", "Actions"]} rows={(d.builds as Array<Record<string, any>>).map((b) => [
          <code key="i" className="text-[10px]">{b.id.slice(0, 8)}</code>, <Badge key="s" tone={b.status === "succeeded" ? "good" : b.status === "failed" ? "bad" : "neutral"}>{b.status}</Badge>, b.mode,
          <span key="e" className="text-white/55">{b.error_code}</span>, when(b.created_at),
          can("builds.operate") && ACTIVE.includes(b.status) ? <div key="a" className="space-y-2">
            <ActionForm action="build.action" email={email} compact submitLabel="Cancel" danger fields={[{ name: "buildId", label: "", type: "hidden", defaultValue: b.id }, { name: "action", label: "", type: "hidden", defaultValue: "cancel" }, { name: "reason", label: "Reason", required: true }]} />
            {b.locked_at && Date.now() - new Date(b.locked_at).getTime() > 600_000 && <ActionForm action="build.action" email={email} compact submitLabel="Recover stuck build" fields={[{ name: "buildId", label: "", type: "hidden", defaultValue: b.id }, { name: "action", label: "", type: "hidden", defaultValue: "recover" }, { name: "reason", label: "Reason", required: true }]} />}
          </div> : "—",
        ])} empty="No builds." />
        {can("builds.operate") && d.builds[0] && !ACTIVE.includes(d.builds[0].status) && <div className="mt-3"><ActionForm action="build.action" email={email} compact submitLabel="Restart preview from current files" fields={[{ name: "buildId", label: "", type: "hidden", defaultValue: d.builds[0].id }, { name: "action", label: "", type: "hidden", defaultValue: "restart_preview" }, { name: "reason", label: "Reason", required: true }]} /><p className="mt-1 text-[10px] text-white/40">Runs in an isolated E2B sandbox, never in the admin or platform process. Uses no model credits.</p></div>}
      </Card>
      <Card title="Versions"><Table head={["Label", "Kind", "Files", "Created"]} rows={(d.versions as Array<Record<string, any>>).map((v) => [`${v.label}${v.id === p.active_version_id ? " (live)" : ""}`, v.kind, v.file_count ?? "—", when(v.created_at)])} empty="No versions." /></Card>
      <Card title="Resources"><Table head={["Kind", "Purpose", "State", "Last opened", "Note"]} rows={(d.resources as Array<Record<string, any>>).map((r) => [r.kind.replaceAll("_", " "), r.purpose, r.state, when(r.last_accessed_at), r.terminate_reason || ""])} empty="No resources." /></Card>
      <Card title="Usage"><Table head={["Provider", "Kind", "Quantity", "Estimated cost"]} rows={(d.usage as Array<Record<string, any>>).map((u) => [u.provider, u.kind.replaceAll("_", " "), Number(u.quantity).toLocaleString(), rupees(u.estimated_cost_minor)])} empty="No usage." /></Card>
    </div>
    {can("projects.read_content") && <Card title="Private source" className="mt-4"><p className="mb-3 text-[12px] text-white/55">Opening this project's files is recorded in the audit history with your reason.</p><ActionForm action="project.open_content" email={email} submitLabel="Open source files" fields={[{ name: "projectId", label: "", type: "hidden", defaultValue: id }, { name: "reason", label: "Reason (for example a support ticket reference)", required: true }]} /></Card>}
  </>;
}
