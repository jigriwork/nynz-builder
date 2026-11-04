"use client";

import { FormEvent, useState } from "react";
import { AuthShell, buttonClass, fieldClass } from "@/components/auth/auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    const response = await fetch("/api/account/password-reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    setMessage(body.message || body.error || "Please try again.");
  }
  return <AuthShell eyebrow="Account recovery" title="Reset your password">
    <form onSubmit={submit}>
      <p className="mb-5 text-sm leading-6 text-white/60">Enter the email you use for NYNZ. We will send a single-use link to choose a new password. We never send or display existing passwords.</p>
      <label htmlFor="email" className="mb-2 block text-[11px] text-white/65">Email address</label>
      <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
      {message && <p role="status" className="mb-4 rounded-xl border border-[#c7ff4a]/20 bg-[#c7ff4a]/[.06] p-3 text-xs leading-5 text-[#c7ff4a]">{message}</p>}
      <button disabled={busy} className={buttonClass}>{busy ? "Sending…" : "Send reset link"}</button>
    </form>
  </AuthShell>;
}
