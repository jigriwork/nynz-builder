import { loadStaff } from "@/lib/admin/session";
import { createAdmin } from "@/lib/supabase/server";
import { Badge, Card, PageHeader, Table, when } from "@/components/admin/ui";
import { ActionForm } from "@/components/admin/action-form";

export const metadata = { title: "Team" };
const ROLES: Array<[string, string]> = [["operations", "Operations"], ["support", "Support"], ["billing", "Billing"], ["readonly", "Read-only"]];

export default async function TeamPage() {
  const { supabase, can, email, user, access } = await loadStaff("team.read");
  const admin = createAdmin();
  const [{ data: members }, { data: invitations }, { data: matrix }, { data: capabilities }, { data: activity }] = await Promise.all([
    supabase.from("staff_members").select("*").order("created_at"),
    supabase.from("staff_invitations").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("staff_role_capabilities").select("role,capability"),
    supabase.from("staff_capabilities").select("*").order("code"),
    admin.from("admin_audit_log").select("occurred_at,actor_email,action,target_type,outcome").eq("actor_kind", "staff").order("id", { ascending: false }).limit(25),
  ]);
  const isOwner = access.role === "owner";
  const roleOptions: Array<[string, string]> = isOwner ? [["owner", "Owner"], ...ROLES] : ROLES;
  const invitationState = (i: Record<string, any>) => i.status === "pending" && new Date(i.expires_at) <= new Date() ? "expired" : i.status;
  const roles = ["owner", "operations", "support", "billing", "readonly"];
  return <>
    <PageHeader title="Team" description="Each person uses their own NYNZ account. Staff access is separate from customer plans; removing staff access never deletes the person's customer account or projects." />
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card title="Staff members">
        <Table head={["Person", "Role", "Status", "Since", ""]} rows={(members || []).map((m) => [
          <span key="p">{m.email}{m.user_id === user.id ? " (you)" : ""}{m.display_name ? <span className="block text-[10px] text-white/45">{m.display_name}</span> : null}</span>,
          <Badge key="r" tone={m.role === "owner" ? "good" : "neutral"}>{m.role}</Badge>, m.status === "active" ? "active" : <Badge key="s" tone="warn">{m.status}</Badge>, when(m.created_at),
          can("team.manage") && m.user_id !== user.id && m.status !== "removed" && (m.role !== "owner" || isOwner) ? <details key="e"><summary className="cursor-pointer text-[11px] text-white/60">Manage</summary><div className="mt-2 w-72 space-y-4">
            <ActionForm action="team.update" email={email} submitLabel="Save access" fields={[{ name: "userId", label: "", type: "hidden", defaultValue: m.user_id }, { name: "role", label: "Role", type: "select", options: roleOptions, defaultValue: m.role }, { name: "extra", label: "Extra capabilities (comma separated)", type: "csv", defaultValue: (m.extra_capabilities || []).join(", ") }, { name: "revoked", label: "Removed capabilities (comma separated)", type: "csv", defaultValue: (m.revoked_capabilities || []).join(", ") }, { name: "requireMfa", label: "Require two-factor authentication", type: "checkbox", defaultValue: m.require_mfa }, { name: "expectedVersion", label: "", type: "hidden", defaultValue: m.version }, { name: "reason", label: "Reason", required: true }]} />
            <ActionForm action="team.status" email={email} danger={m.status === "active"} submitLabel={m.status === "active" ? "Suspend staff access" : "Reactivate staff access"} fields={[{ name: "userId", label: "", type: "hidden", defaultValue: m.user_id }, { name: "status", label: "", type: "hidden", defaultValue: m.status === "active" ? "suspended" : "active" }, { name: "reason", label: "Reason", required: true }]} />
            <ActionForm action="team.status" email={email} danger confirmText="Remove this person's staff access? Their customer account stays." submitLabel="Remove staff access" fields={[{ name: "userId", label: "", type: "hidden", defaultValue: m.user_id }, { name: "status", label: "", type: "hidden", defaultValue: "removed" }, { name: "reason", label: "Reason", required: true }]} />
          </div></details> : "",
        ])} />
        {isOwner && <details className="mt-4"><summary className="cursor-pointer text-[12px] text-white/70">Step down as owner (ownership transfer, step 2)</summary><div className="mt-2 max-w-sm"><p className="mb-2 text-[11px] text-white/50">First appoint another owner from “Manage”. NYNZ refuses to leave no active owner.</p><ActionForm action="team.step_down" email={email} danger confirmText="Give up owner access?" submitLabel="Step down" fields={[{ name: "newRole", label: "Your new role", type: "select", options: ROLES }, { name: "reason", label: "Reason", required: true }]} /></div></details>}
      </Card>
      {can("team.manage") && <Card title="Add a team member">
        <ActionForm action="team.invite" email={email} submitLabel="Send invitation" fields={[{ name: "email", label: "Email", type: "email", required: true }, { name: "name", label: "Name (optional)" }, { name: "role", label: "Role", type: "select", options: roleOptions, defaultValue: "support" }, { name: "capabilities", label: "Extra capabilities (optional, comma separated)", type: "csv", help: "See the permission matrix below. Only owners can grant owner-level capabilities." }, { name: "reason", label: "Reason", required: true, defaultValue: "New team member" }]} />
        <p className="mt-3 text-[11px] leading-4 text-white/45">If the email already has a NYNZ account, the invitation appears in their account menu (no duplicate account). Otherwise they receive an activation email and choose their own password. Access starts only after they accept while signed in to that verified address. Invitations expire after 7 days.</p>
      </Card>}
    </div>
    <Card title="Invitations" className="mt-4"><Table head={["Email", "Role", "State", "Sent", "Delivery", "Expires", ""]} rows={(invitations || []).map((i) => [i.email, i.role, <Badge key="s" tone={invitationState(i) === "accepted" ? "good" : invitationState(i) === "pending" ? "neutral" : "warn"}>{invitationState(i)}</Badge>, `${when(i.last_sent_at || i.created_at)} (${i.send_count}×)`, i.last_delivery?.replaceAll("_", " ") || "—", when(i.expires_at),
      can("team.manage") && i.status === "pending" ? <div key="a" className="flex gap-2"><ActionForm action="team.resend" email={email} compact submitLabel="Resend" fields={[{ name: "invitationId", label: "", type: "hidden", defaultValue: i.id }, { name: "reason", label: "", type: "hidden", defaultValue: "Resent from team page" }]} /><ActionForm action="team.revoke" email={email} compact danger submitLabel="Revoke" fields={[{ name: "invitationId", label: "", type: "hidden", defaultValue: i.id }, { name: "reason", label: "", type: "hidden", defaultValue: "Revoked from team page" }]} /></div> : ""])} empty="No invitations yet." /></Card>
    <Card title="Permission matrix" className="mt-4"><Table head={["Capability", ...roles]} rows={(capabilities || []).map((c) => [<span key="c">{c.description}<code className="ml-1 text-[10px] text-white/40">{c.code}</code>{c.owner_level ? <Badge tone="warn">owner-level</Badge> : null}</span>, ...roles.map((r) => (r === "owner" || (matrix || []).some((m) => m.role === r && m.capability === c.code)) ? "✓" : "")])} /></Card>
    <Card title="Recent staff activity" className="mt-4"><Table head={["When", "Who", "Action", "Target", "Outcome"]} rows={(activity || []).map((a) => [when(a.occurred_at), a.actor_email || "—", a.action, a.target_type || "", a.outcome])} empty="No staff activity yet." /></Card>
  </>;
}
