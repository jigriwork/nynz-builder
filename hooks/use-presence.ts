"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/** Approximate presence: a heartbeat every 60s while a NYNZ tab is visible. Reported as "seen recently", not as a guarantee. */
export function usePresence() {
  useEffect(() => {
    const supabase = createClient();
    const beat = () => { if (document.visibilityState === "visible") void supabase.rpc("record_presence"); };
    beat();
    const timer = setInterval(beat, 60_000);
    document.addEventListener("visibilitychange", beat);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", beat); };
  }, []);
}
