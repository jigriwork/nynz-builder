import { loadStaff } from "@/lib/admin/session";
import { createAdmin } from "@/lib/supabase/server";
import { Card, PageHeader, Table, when } from "@/components/admin/ui";
import { ActionForm } from "@/components/admin/action-form";

export const metadata = { title: "Waitlist" };

/** People who asked for an invitation while signups are invite-only. */
export default async function WaitlistPage() {
  const { can, email } = await loadStaff("users.read");
  const { data } = await createAdmin().from("signup_waitlist").select("email,source,requests,created_at,last_requested_at").order("created_at", { ascending: false }).limit(500);
  const rows = data || [];
  return <>
    <PageHeader title="Waitlist" description="People who asked to join while NYNZ is invite-only. Inviting someone sends the account-activation email; they choose their own password." />
    <Card aside={<span className="text-[11px] text-white/45">{rows.length} waiting</span>}>
      <Table head={["Email", "Asked", "Times asked", ...(can("users.invite") ? ["Invite"] : [])]} rows={rows.map((r) => [
        r.email, when(r.created_at), r.requests,
        ...(can("users.invite") ? [<ActionForm key="i" action="user.invite" email={email} compact submitLabel="Send invitation" fields={[{ name: "email", label: "Email", type: "email", required: true, defaultValue: r.email }, { name: "reason", label: "Reason", required: true, defaultValue: "Waitlist invitation" }]} />] : []),
      ])} empty="Nobody has asked to join yet." />
    </Card>
  </>;
}
