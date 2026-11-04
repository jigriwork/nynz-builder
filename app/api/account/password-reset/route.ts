import { createClient as createPlainClient } from "@supabase/supabase-js";
import { z } from "zod";
import { json } from "@/lib/supabase/auth";
import { rateLimit } from "@/lib/platform/rate-limit";
import { appOrigin, canSendEmail } from "@/lib/platform/email";
import { logServerError } from "@/lib/http/errors";

/**
 * Starts password recovery. The response is identical whether or not the
 * address has an account, so it cannot be used to discover customers.
 */
export async function POST(request: Request) {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).safeParse(await request.json().catch(() => null));
  const generic = json({ ok: true, message: "If an account exists for that address, a reset link is on its way. It expires after one hour and works once." });
  if (!parsed.success) return generic;
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const limited = (await rateLimit(`reset-ip:${ip}`, 10, 3600)) || (await rateLimit(`reset-email:${parsed.data.email}`, 3, 3600));
  if (limited) return limited;
  if (!canSendEmail(parsed.data.email)) return generic;
  const anon = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error } = await anon.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${appOrigin()}/auth/callback?next=/reset-password` });
  if (error) logServerError("password-reset", error);
  return generic;
}
