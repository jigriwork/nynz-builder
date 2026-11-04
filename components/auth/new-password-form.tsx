"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { buttonClass, fieldClass } from "./auth-shell";

/** Sets a new password for the signed-in (recovery or invited) session. */
export function NewPasswordForm({ next, intro }: { next: string; intro: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => setHasSession(Boolean(data.user))); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 10) return setMessage("Use at least 10 characters.");
    if (password !== confirm) return setMessage("The passwords do not match.");
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setMessage(/reauth|recent/i.test(error.message) ? "This link has expired. Request a new reset link." : error.message);
    window.location.assign(next);
  }
  if (hasSession === false) return <div className="text-sm leading-6 text-white/65"><p>This link has expired or was already used.</p><Link href="/forgot-password" className="mt-4 inline-block text-[#c7ff4a]">Request a new link</Link></div>;
  return <form onSubmit={submit}>
    <p className="mb-5 text-sm leading-6 text-white/60">{intro}</p>
    <label htmlFor="new-password" className="mb-2 block text-[11px] text-white/65">New password</label>
    <input id="new-password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} className={fieldClass} />
    <label htmlFor="confirm-password" className="mb-2 block text-[11px] text-white/65">Confirm password</label>
    <input id="confirm-password" type="password" autoComplete="new-password" minLength={10} required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={fieldClass} />
    {message && <p role="alert" className="mb-4 rounded-xl border border-red-400/20 bg-red-400/[.06] p-3 text-xs text-red-200">{message}</p>}
    <button disabled={busy || hasSession === null} className={buttonClass}>{busy ? "Saving…" : "Save password"}</button>
  </form>;
}
