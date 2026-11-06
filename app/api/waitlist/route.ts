import { z } from "zod";
import { json } from "@/lib/supabase/auth";
import { createAdmin } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/platform/rate-limit";
import { apiError } from "@/lib/http/errors";

/**
 * Invite-only signups: records a request to join NYNZ. The response is the
 * same for new and repeated addresses, so it reveals nothing about others.
 */
export async function POST(request: Request) {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INPUT", "Enter a valid email address.");
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const limited = (await rateLimit(`waitlist-ip:${ip}`, 10, 3600)) || (await rateLimit(`waitlist-email:${parsed.data.email}`, 3, 3600));
  if (limited) return limited;
  const { error } = await createAdmin().rpc("join_waitlist", { p_email: parsed.data.email, p_source: "signup" });
  if (error) return apiError("SERVICE_UNAVAILABLE", "We couldn't save your request just now. Please try again in a moment.", { cause: error, scope: "waitlist" });
  return json({ ok: true });
}
