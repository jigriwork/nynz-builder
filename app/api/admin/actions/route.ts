import { z } from "zod";
import { requireStaff, json } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { ACTIONS, type ActionName } from "@/lib/admin/actions";
import { apiError, dbError } from "@/lib/http/errors";
import { rateLimit } from "@/lib/platform/rate-limit";

/**
 * Single entry point for admin mutations. Each action declares the capability
 * it needs (checked here against a fresh read of staff membership) and calls a
 * database function that checks the capability again, enforces recent
 * authentication/MFA and writes the audit record in the same transaction.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = z.string().safeParse(body?.action);
  if (!name.success || !(name.data in ACTIONS)) return apiError("INVALID_INPUT", "Unknown action");
  const action = ACTIONS[name.data as ActionName];
  const auth = await requireStaff(action.capability);
  if ("error" in auth) return auth.error;
  const limited = await rateLimit(`admin:${auth.user.id}`, 120, 60);
  if (limited) return limited;
  const parsed = action.schema.safeParse(body?.input ?? {});
  if (!parsed.success) return apiError("INVALID_INPUT", `Check the form: ${parsed.error.issues[0]?.path.join(".") || "input"} ${parsed.error.issues[0]?.message || ""}`.trim());
  try {
    const result = await (action.run as (ctx: unknown, input: unknown) => Promise<unknown>)({ supabase: auth.supabase, admin: createAdmin(), userId: auth.user.id }, parsed.data);
    return json({ ok: true, result: result ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || "");
    if (message === "SERVICE_UNAVAILABLE_PAYMENTS") return apiError("SERVICE_UNAVAILABLE", "Payments are not configured. Add Razorpay test keys to enable this.");
    return dbError(error as { message?: string }, `admin:${name.data}`, "That action could not be completed.");
  }
}
