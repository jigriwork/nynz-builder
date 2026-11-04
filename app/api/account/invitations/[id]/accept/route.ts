import { json, requireUser } from "@/lib/supabase/auth";
import { apiError, dbError } from "@/lib/http/errors";

/** Accepts a staff invitation addressed to the signed-in, verified email. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError("NOT_FOUND", "This invitation is no longer valid.");
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.supabase.rpc("accept_staff_invitation", { p_invitation: id });
  if (error) return dbError(error, "accept-invitation");
  return json({ accepted: true, role: data.role });
}
