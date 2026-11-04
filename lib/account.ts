import type { createClient } from "@/lib/supabase/server";
import type { AccountSummary } from "@/components/account-menu";

/** Everything the account menu shows, read through the signed-in user's own session. */
export async function accountSummary(supabase: Awaited<ReturnType<typeof createClient>>, email: string): Promise<AccountSummary> {
  const [{ data: balance }, { data: staff }, { data: invitations }] = await Promise.all([
    supabase.rpc("my_credit_balance"), supabase.rpc("my_staff_access"), supabase.rpc("my_staff_invitations"),
  ]);
  const capabilities: string[] = staff?.capabilities || [];
  return { email, availableCredits: balance ? Number(balance.available) : null, isStaff: Boolean(staff?.is_staff), canOpenAdmin: Boolean(staff?.is_staff) && capabilities.includes("admin.access"), pendingInvitations: Array.isArray(invitations) ? invitations.length : 0 };
}
