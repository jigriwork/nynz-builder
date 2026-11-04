"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { buttonClass, fieldClass } from "@/components/auth/auth-shell";

type Factor = { id: string; friendly_name?: string; status: string; factor_type: string };

export function SecurityPanel({ email, stepUp, next, privileged }: { email: string; stepUp: boolean; next: string; privileged: boolean }) {
  const supabase = createClient();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [aal, setAal] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const [{ data: list }, { data: level }] = await Promise.all([supabase.auth.mfa.listFactors(), supabase.auth.mfa.getAuthenticatorAssuranceLevel()]);
    setFactors(((list?.all || []) as Factor[]).filter((f) => f.factor_type === "totp"));
    setAal(level?.currentLevel || null);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);
  const verified = factors.filter((f) => f.status === "verified");

  async function enroll() {
    setMessage("");
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `NYNZ ${new Date().toISOString().slice(0, 10)}` });
    if (error || !data) return setMessage(error?.message || "Could not start set-up.");
    setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }
  async function verify(event: FormEvent, factorId: string) {
    event.preventDefault();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setCode("");
    if (error) return setMessage("That code was not accepted. Check the time on your device and try again.");
    setEnrolling(null); setMessage("Two-factor verification is active for this session.");
    await load();
    if (stepUp) window.location.assign(next);
  }
  async function remove(factorId: string) {
    if (!window.confirm("Remove this authenticator? Privileged access will require setting one up again.")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    setMessage(error ? "Remove requires a verified two-factor session. Verify a code first." : "Authenticator removed.");
    await load();
  }
  async function signOutEverywhere() {
    if (!window.confirm("Sign out of NYNZ on every device, including this one?")) return;
    await supabase.auth.signOut({ scope: "global" });
    window.location.assign("/login");
  }

  return <div className="space-y-6 text-sm">
    {message && <p role="status" className="rounded-xl border border-white/[.12] bg-white/[.04] p-3 text-xs text-white/80">{message}</p>}
    <section>
      <h2 className="text-[13px] font-medium text-white">Two-factor authentication</h2>
      <p className="mt-1 text-xs leading-5 text-white/55">{privileged ? "Your account has staff access. Once an authenticator is added, the admin console requires a code at each sign-in." : "Add an authenticator app for extra protection."} Session level: {aal === "aal2" ? "verified with a code" : "password only"}.</p>
      {verified.map((f) => <div key={f.id} className="mt-3 rounded-xl border border-white/[.1] p-3">
        <p className="text-xs text-white">{f.friendly_name || "Authenticator app"} · verified</p>
        {aal !== "aal2" && <form onSubmit={(e) => verify(e, f.id)} className="mt-3"><label htmlFor={`code-${f.id}`} className="mb-2 block text-[11px] text-white/65">6-digit code</label><input id={`code-${f.id}`} inputMode="numeric" pattern="[0-9]{6}" required value={code} onChange={(e) => setCode(e.target.value)} className={fieldClass} /><button className={buttonClass}>Verify</button></form>}
        <button onClick={() => remove(f.id)} className="mt-2 text-xs text-red-300 hover:text-red-200">Remove authenticator</button>
      </div>)}
      {!verified.length && !enrolling && <button onClick={enroll} className={`${buttonClass} mt-3`}>Set up an authenticator app</button>}
      {enrolling && <form onSubmit={(e) => verify(e, enrolling.id)} className="mt-3 rounded-xl border border-white/[.1] p-3">
        <p className="mb-3 text-xs text-white/65">Scan this code with your authenticator app, then enter the 6-digit code it shows.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enrolling.qr} alt="Authenticator set-up code" className="mx-auto mb-3 h-44 w-44 rounded-lg bg-white p-2" />
        <p className="mb-3 break-all text-center font-mono text-[10px] text-white/50">Manual key: {enrolling.secret}</p>
        <input aria-label="6-digit code" inputMode="numeric" pattern="[0-9]{6}" required value={code} onChange={(e) => setCode(e.target.value)} className={fieldClass} />
        <button className={buttonClass}>Confirm and activate</button>
      </form>}
    </section>
    <section>
      <h2 className="text-[13px] font-medium text-white">Password</h2>
      <p className="mt-1 text-xs leading-5 text-white/55">Signed in as {email}. To change your password, use a reset link; it proves you control this email address.</p>
      <Link href="/forgot-password" className="mt-2 inline-block text-xs text-[#c7ff4a]">Send me a reset link</Link>
    </section>
    <section>
      <h2 className="text-[13px] font-medium text-white">Sessions</h2>
      <button onClick={signOutEverywhere} className="mt-2 text-xs text-red-300 hover:text-red-200">Sign out of all devices</button>
    </section>
  </div>;
}
