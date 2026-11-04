import { NextResponse } from "next/server";
import { createClient } from "./server";
import { apiError } from "@/lib/http/errors";

/**
 * Every API route starts here. The Supabase session is verified with the auth
 * server (getUser), and suspended accounts are refused even if their browser
 * still holds a valid token. Database RLS enforces the same rule underneath.
 */
export async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: apiError("AUTH_REQUIRED", "Authentication required") } as const;
  const { data: state } = await supabase.rpc("my_account_state");
  if (state?.status === "suspended") return { error: apiError("ACCOUNT_SUSPENDED", "This account is suspended. Contact support for help.") } as const;
  return { supabase, user } as const;
}

export async function requireProject(projectId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return { error: apiError("NOT_FOUND", "Project not found") } as const;
  const auth = await requireUser();
  if ("error" in auth) return { error: auth.error } as const;
  const { data: project } = await auth.supabase.from("projects").select("*").eq("id", projectId).single();
  if (!project) return { error: apiError("NOT_FOUND", "Project not found") } as const;
  return { supabase: auth.supabase, user: auth.user, project } as const;
}

export type StaffAccess = { is_staff: boolean; role: string | null; status: string | null; capabilities: string[]; session_valid: boolean; mfa_satisfied: boolean; mfa_enrolled: boolean; require_mfa: boolean; recent_auth: boolean };

export async function getStaffAccess(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.rpc("my_staff_access");
  return (data || { is_staff: false, capabilities: [] }) as StaffAccess;
}

/**
 * Server-side staff gate. This re-reads staff membership on every request, so
 * suspension, removal and session revocation apply immediately. The database
 * functions behind each mutation check the same capability again.
 */
export async function requireStaff(capability: string) {
  const auth = await requireUser();
  if ("error" in auth) return { error: auth.error } as const;
  const access = await getStaffAccess(auth.supabase);
  if (!access.is_staff || !access.session_valid || !access.capabilities.includes(capability)) return { error: apiError("FORBIDDEN", "You do not have permission to do that.") } as const;
  if (!access.mfa_satisfied) return { error: apiError("MFA_REQUIRED", "Complete two-factor verification to continue.") } as const;
  return { ...auth, access } as const;
}

export function json(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json(data, { ...init, headers: { "cache-control": "private, no-store", ...(init.headers || {}) } });
}
