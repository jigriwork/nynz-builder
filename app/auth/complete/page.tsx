"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/http/safe-next";

/**
 * Finishes email links whose session arrives after "#" (password reset and
 * invitations requested by NYNZ's server). Reads the tokens in the browser,
 * starts the session, removes them from the address bar and continues:
 * resets go to "Choose a new password", invitations to their destination.
 */
export default function CompleteEmailLink() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    history.replaceState(null, "", window.location.pathname);
    const errorCode = hash.get("error_code") || hash.get("error");
    if (errorCode) { window.location.replace(`/login?notice=${/expired/i.test(errorCode) ? "link_expired" : "link_invalid"}&next=${encodeURIComponent(next)}`); return; }
    const access_token = hash.get("access_token"), refresh_token = hash.get("refresh_token");
    if (!access_token || !refresh_token) { window.location.replace(`/login?notice=link_invalid&next=${encodeURIComponent(next)}`); return; }
    createClient().auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) { setFailed(true); window.location.replace(`/login?notice=link_invalid&next=${encodeURIComponent(next)}`); return; }
      window.location.replace(hash.get("type") === "recovery" && next === "/dashboard" ? "/reset-password" : next);
    });
  }, []);
  return <main className="nynz-dark grid min-h-screen place-items-center bg-[#070b12] px-6 text-center text-sm text-white/60">{failed ? "That email link is not valid." : "Signing you in…"}</main>;
}
