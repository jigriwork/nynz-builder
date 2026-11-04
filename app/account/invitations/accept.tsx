"use client";

import { useState } from "react";
import { buttonClass } from "@/components/auth/auth-shell";

export function AcceptInvitation({ id, role, from, expires }: { id: string; role: string; from: string | null; expires: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  async function accept() {
    setState("busy");
    const response = await fetch(`/api/account/invitations/${id}/accept`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    setState(response.ok ? "done" : body.error || "Could not accept this invitation.");
  }
  return <div className="mb-4 rounded-xl border border-white/[.1] p-4">
    <p className="text-sm text-white">Join NYNZ staff as <strong>{role}</strong></p>
    <p className="mt-1 text-xs text-white/55">{from ? `Invited by ${from}. ` : ""}Expires {new Date(expires).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}. Your customer workspace stays exactly as it is.</p>
    {state === "done" ? <a href="/admin" className="mt-4 inline-block text-sm text-[#c7ff4a]">Open the admin console →</a>
      : <button onClick={accept} disabled={state === "busy"} className={`${buttonClass} mt-4`}>{state === "busy" ? "Accepting…" : "Accept invitation"}</button>}
    {state !== "idle" && state !== "busy" && state !== "done" && <p role="alert" className="mt-3 text-xs text-red-300">{state}</p>}
  </div>;
}
