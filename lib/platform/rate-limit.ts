import { createAdmin } from "@/lib/supabase/server";
import { apiError, logServerError } from "@/lib/http/errors";

/**
 * Atomic fixed-window limit backed by public.consume_rate_limit. Returns an
 * error response when the caller is over the limit, otherwise null.
 * Fails closed if the limiter is unavailable: external providers may still be
 * reachable during a database failure and must not run without admission.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number) {
  try {
    const { data, error } = await createAdmin().rpc("consume_rate_limit", { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
    if (error) { logServerError("rate-limit", error); return apiError("SERVICE_UNAVAILABLE", "Please try again shortly."); }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") return apiError("SERVICE_UNAVAILABLE", "Please try again shortly.");
    if (row && row.allowed === false) {
      return apiError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", { headers: { "retry-after": String(row.retry_after_seconds || windowSeconds) } });
    }
    return null;
  } catch (error) {
    logServerError("rate-limit", error);
    return apiError("SERVICE_UNAVAILABLE", "Please try again shortly.");
  }
}
