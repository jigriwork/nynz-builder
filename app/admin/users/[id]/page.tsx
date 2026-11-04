import Link from "next/link";
import { notFound } from "next/navigation";
import { loadStaff } from "@/lib/admin/session";
import { Badge, Card, PageHeader, Stat, Table, ago, rupees, when } from "@/components/admin/ui";
import { ActionForm } from "@/components/admin/action-form";

export default async function UserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, can, email, user: me } = await loadStaff("users.read");
  const { data: d } = await supabase.rpc("admin_user_detail", { p_user: id });
  if (!d?.user) notFound();
  const self = id === me.id;
  const suspended = d.account?.status === "suspended";
  return <>
    <PageHeader title={d.user.email} description={`User ${id}`} actions={<Link href="/admin/users" className="text-[12px] text-white/60 hover:text-white">← All users</Link>} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Account" value={suspended ? "Suspended" : "Active"} tone={suspended ? "bad" : "good"} hint={suspended ? d.account.reason : undefined} />
      <Stat label="Plan" value={d.entitlements?.plan_name || "Free"} hint={d.entitlements?.subscription_status || "No subscription"} />
      <Stat label="Available credits" value={d.credits ? Number(d.credits.available).toLocaleString() : "—"} hint={d.credits ? `${d.credits.reserved} reserved · ${d.credits.used} used` : "Requires credits access"} />
      <Stat label="Sessions" value={d.sessions} hint={`${d.mfa_factors} MFA factor(s)`} />
    </div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card title="Account timeline">
        <Table head={["Event", "When"]} rows={[["Registered", when(d.user.created_at)], ["Email verified", when(d.user.email_confirmed_at)], ["Last sign-in", when(d.user.last_sign_in_at)], ["Last activity", `${when(d.activity?.last_activity_at)}${d.activity?.last_activity_kind ? ` (${d.activity.last_activity_kind.replaceAll("_", " ")})` : ""}`], ["Last seen (approximate)", ago(d.activity?.last_presence_at)], ["Staff role", d.staff ? `${d.staff.role} (${d.staff.status})` : "None"]]} />
      </Card>
      <Card title="Actions">
        {self ? <p className="text-[12px] text-white/55">These controls are not available for your own account.</p> : <div className="space-y-5">
          {can("users.suspend") && <ActionForm action="user.status" email={email} danger={!suspended} confirmText={suspended ? undefined : "Suspend this account? Their pages, APIs, previews and queued work will stop."} submitLabel={suspended ? "Reactivate account" : "Suspend account"} fields={[{ name: "userId", label: "", type: "hidden", defaultValue: id }, { name: "status", label: "", type: "hidden", defaultValue: suspended ? "active" : "suspended" }, { name: "reason", label: "Reason (recorded in audit history)", required: true }]} />}
          {can("users.reset_password") && <ActionForm action="user.password_reset" email={email} submitLabel="Send password-reset link" fields={[{ name: "userId", label: "", type: "hidden", defaultValue: id }, { name: "reason", label: "Reason", required: true, defaultValue: "Customer asked for account recovery" }]} />}
          {can("users.revoke_sessions") && <ActionForm action="user.revoke_sessions" email={email} danger confirmText="Sign this person out everywhere?" submitLabel="Sign out of all sessions" fields={[{ name: "userId", label: "", type: "hidden", defaultValue: id }, { name: "reason", label: "Reason", required: true }]} />}
          <p className="text-[11px] leading-4 text-white/45">Passwords are never shown or set by staff. Session revocation ends refresh tokens immediately; an already-issued access token can remain valid for up to an hour for customer pages, while admin access is checked against live sessions on every request.</p>
        </div>}
      </Card>
      {d.credits && <Card title="Credits">
        <Table head={["Included", "Purchased", "Promotional", "Owner testing", "Reserved", "Used", "Available"]} rows={[[d.credits.included, d.credits.purchased, d.credits.promotional, d.credits.owner_testing, d.credits.reserved, d.credits.used, d.credits.available].map((v) => Number(v).toLocaleString())]} />
        {can("credits.grant") && !self && <div className="mt-4"><ActionForm action="credits.grant" email={email} submitLabel="Grant credits" fields={[{ name: "userId", label: "", type: "hidden", defaultValue: id }, { name: "amount", label: "Credits", type: "number", required: true }, { name: "source", label: "Type", type: "select", options: [["promotional", "Promotional"], ["adjustment", "Adjustment"], ["refund_restore", "Restore after failure"]] }, { name: "expiresAt", label: "Expires", type: "datetime", help: "Leave empty for no expiry" }, { name: "reason", label: "Reason", required: true }, { name: "idempotencyKey", label: "", type: "idempotency" }]} /></div>}
        {can("credits.adjust_large") && !self && <div className="mt-4"><ActionForm action="credits.debit" email={email} danger submitLabel="Deduct credits" fields={[{ name: "userId", label: "", type: "hidden", defaultValue: id }, { name: "amount", label: "Credits", type: "number", required: true }, { name: "reason", label: "Reason", required: true }, { name: "idempotencyKey", label: "", type: "idempotency" }]} /></div>}
      </Card>}
      {d.credit_history && <Card title="Credit history (latest 50)"><Table head={["When", "Type", "Credits", "Detail"]} rows={(d.credit_history as Array<Record<string, any>>).map((l) => [when(l.created_at), l.entry_type, Number(l.amount).toLocaleString(), l.reason || [l.provider, l.model, l.cost_paise !== null ? `${rupees(l.cost_paise)} ${l.cost_source || ""}` : ""].filter(Boolean).join(" · ")])} empty="No credit activity." /></Card>}
      {d.subscriptions && <Card title="Subscriptions"><Table head={["Plan", "Status", "Period end", "Cancels at end", "Provider ID"]} rows={(d.subscriptions as Array<Record<string, any>>).map((s) => [s.plan, s.status, when(s.current_period_end), s.cancel_at_period_end ? "Yes" : "No", <code key="p" className="text-[10px]">{s.provider_subscription_id}</code>])} empty="No subscriptions." /></Card>}
      {d.payments && <Card title="Payments"><Table head={["When", "Kind", "Charged", "Tax", "Revenue", "Status"]} rows={(d.payments as Array<Record<string, any>>).map((p) => [when(p.captured_at || p.created_at), p.kind, rupees(p.amount_minor), rupees(p.tax_minor), rupees(p.net_minor), <Badge key="s" tone={p.status === "captured" ? "good" : p.status === "failed" ? "bad" : "warn"}>{p.status}</Badge>])} empty="No payments." /></Card>}
      {d.projects && <Card title="Projects"><Table head={["Name", "Status", "Updated"]} rows={(d.projects as Array<Record<string, any>>).map((p) => [<Link key="n" href={`/admin/projects/${p.id}`} className="text-[#c7ff4a] hover:underline">{p.name}</Link>, p.status, when(p.updated_at)])} empty="No projects." /></Card>}
      <Card title="Usage, last 30 days"><Table head={["Provider", "Kind", "Quantity", "Estimated cost"]} rows={(d.usage_30d as Array<Record<string, any>>).map((u) => [u.provider, u.kind.replaceAll("_", " "), Number(u.quantity).toLocaleString(), rupees(u.estimated_cost_minor)])} empty="No usage." /></Card>
    </div>
  </>;
}
