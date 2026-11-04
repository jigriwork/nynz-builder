import { createAdmin } from "@/lib/supabase/server";
import { apiError, logServerError } from "@/lib/http/errors";

/**
 * Atomic fixed-window limit backed by public.consume_rate_limit. Returns an
 * error response when the caller is over the limit, otherwise null.
 * If the limiter itself is unreachable the request proceeds (the database is
 * then unavailable for the action anyway) and the failure is logged.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number) {
  try {
    const { data, error } = await createAdmin().rpc("consume_rate_limit", { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
    if (error) { logServerError("rate-limit", error); return null; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.allowed === false) {
      return apiError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", { headers: { "retry-after": String(row.retry_after_seconds || windowSeconds) } });
    }
    return null;
  } catch (error) {
    logServerError("rate-limit", error);
    return null;
  }
}
