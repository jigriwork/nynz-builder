import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStaffAccess } from "@/lib/supabase/auth";

/**
 * Server gate for admin pages. Staff membership is re-read on every request.
 * Non-staff receive a 404 so the console's existence is not advertised.
 */
export async function loadStaff(capability = "admin.access") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  const access = await getStaffAccess(supabase);
  if (!access.is_staff || !access.session_valid || !access.capabilities.includes("admin.access")) notFound();
  if (!access.capabilities.includes(capability)) notFound();
  if (!access.mfa_satisfied) redirect("/account/security?notice=mfa_required");
  return { supabase, user, access, email: user.email || "", can: (cap: string) => access.capabilities.includes(cap) };
}
