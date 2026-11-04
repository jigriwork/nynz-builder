import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { AcceptInvitation } from "./accept";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff invitation", robots: { index: false } };

export default async function InvitationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/invitations");
  const { data } = await supabase.rpc("my_staff_invitations");
  const invitations = (data || []) as Array<{ id: string; role: string; expires_at: string; invited_by_email: string | null }>;
  return <AuthShell eyebrow="NYNZ team" title="Staff invitation" back={{ href: "/dashboard", label: "Back to workspace" }}>
    {invitations.length ? invitations.map((i) => <AcceptInvitation key={i.id} id={i.id} role={i.role} from={i.invited_by_email} expires={i.expires_at} />)
      : <p className="text-sm leading-6 text-white/60">There are no pending invitations for {user.email}. Invitations are only shown to the verified email address they were sent to.</p>}
  </AuthShell>;
}
