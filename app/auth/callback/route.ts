import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/http/safe-next";

/**
 * Completes email links (verification, invitation, password recovery).
 * Expired, reused or invalid links lead to a clear message instead of a
 * silent redirect, and the destination is restricted to NYNZ paths.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const fail = (notice: string) => NextResponse.redirect(new URL(`/login?notice=${notice}&next=${encodeURIComponent(next)}`, url.origin));
  const errorCode = url.searchParams.get("error_code") || url.searchParams.get("error");
  if (errorCode) return fail(/expired/i.test(errorCode) ? "link_expired" : "link_invalid");
  const supabase = await createClient();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail(/expired/i.test(error.message) ? "link_expired" : "link_invalid");
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return fail(/expired/i.test(error.message) ? "link_expired" : "link_invalid");
  } else {
    // Links from emails NYNZ requests on the server (password reset,
    // invitations) carry the session after "#", which only the browser can
    // read. The browser keeps that part across this redirect.
    return NextResponse.redirect(new URL(`/auth/complete?next=${encodeURIComponent(next)}`, url.origin));
  }
  return NextResponse.redirect(new URL(type === "recovery" && next === "/dashboard" ? "/reset-password" : next, url.origin));
}
