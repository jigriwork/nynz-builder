"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type Field = {
  name: string; label: string;
  type?: "text" | "email" | "number" | "select" | "textarea" | "checkbox" | "datetime" | "date" | "hidden" | "csv" | "idempotency";
  options?: Array<[string, string]>; required?: boolean; defaultValue?: string | number | boolean; placeholder?: string; help?: string;
};

const input = "w-full rounded-lg border border-white/[.12] bg-[#0a1018] px-3 py-2 text-[12px] text-white caret-[#c7ff4a] outline-none placeholder:text-white/35 focus:border-[#c7ff4a]/50";

/**
 * Posts an admin action. If the server asks for recent authentication, the
 * person re-enters their own password (never stored or shown) and the action
 * is retried; if MFA is required they are sent to step-up verification.
 */
export function ActionForm({ action, fields, submitLabel, email, danger, confirmText, compact }: { action: string; fields: Field[]; submitLabel: string; email: string; danger?: boolean; confirmText?: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<unknown>(null);

  function collect(form: HTMLFormElement) {
    const data = new FormData(form);
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = data.get(field.name);
      if (field.type === "checkbox") out[field.name] = raw === "on";
      else if (field.type === "number") out[field.name] = raw === "" || raw === null ? null : Number(raw);
      else if (field.type === "csv") out[field.name] = String(raw || "").split(",").map((v) => v.trim()).filter(Boolean);
      else if (field.type === "datetime") out[field.name] = raw ? new Date(String(raw)).toISOString() : null;
      else if (field.type === "idempotency") out[field.name] = String(raw);
      else if (field.type === "hidden" && typeof field.defaultValue === "number") out[field.name] = Number(raw);
      else if (field.type === "hidden" && typeof field.defaultValue === "boolean") out[field.name] = raw === "true";
      else out[field.name] = raw === null ? null : String(raw);
    }
    return out;
  }

  async function send(form: HTMLFormElement) {
    setBusy(true); setMessage(null);
    const response = await fetch("/api/admin/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, input: collect(form) }) });
    const body = await response.json().catch(() => ({ error: "Unexpected response" }));
    setBusy(false);
    if (response.ok) {
      setResult(body.result); router.refresh();
      const outcome = deliveryMessage(body.result);
      setMessage(outcome || { tone: "ok", text: "Done." });
      return;
    }
    if (body.code === "REAUTH_REQUIRED") { setNeedPassword(true); setMessage({ tone: "error", text: "For your security, confirm your password to continue." }); return; }
    if (body.code === "MFA_REQUIRED") { window.location.assign(`/account/security?stepup=1&next=${encodeURIComponent(window.location.pathname)}`); return; }
    setMessage({ tone: "error", text: `${body.error || "That action could not be completed."}${body.ref ? ` (ref ${body.ref.slice(0, 8)})` : ""}` });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (confirmText && !window.confirm(confirmText)) return;
    if (needPassword) {
      setBusy(true);
      const { error } = await createClient().auth.signInWithPassword({ email, password });
      setPassword("");
      setBusy(false);
      if (error) { setMessage({ tone: "error", text: "That password was not accepted." }); return; }
      setNeedPassword(false);
    }
    await send(form);
  }

  return <form onSubmit={submit} className={compact ? "flex flex-wrap items-end gap-2" : "space-y-3"}>
    {fields.map((field) => {
      if (field.type === "hidden") return <input key={field.name} type="hidden" name={field.name} defaultValue={String(field.defaultValue ?? "")} />;
      if (field.type === "idempotency") return <input key={field.name} type="hidden" name={field.name} defaultValue={crypto.randomUUID()} />;
      return <label key={field.name} className={`block ${compact ? "min-w-[140px] flex-1" : ""}`}>
        <span className="mb-1 block text-[11px] text-white/60">{field.label}</span>
        {field.type === "select" ? <select name={field.name} defaultValue={String(field.defaultValue ?? "")} required={field.required} className={input}>{field.options?.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          : field.type === "textarea" ? <textarea name={field.name} defaultValue={String(field.defaultValue ?? "")} required={field.required} placeholder={field.placeholder} rows={2} className={input} />
          : field.type === "checkbox" ? <input type="checkbox" name={field.name} defaultChecked={Boolean(field.defaultValue)} className="h-4 w-4 accent-[#c7ff4a]" />
          : <input name={field.name} type={field.type === "datetime" ? "datetime-local" : field.type === "csv" ? "text" : field.type || "text"} step={field.type === "number" ? "any" : undefined} defaultValue={field.defaultValue === undefined ? undefined : String(field.defaultValue)} required={field.required} placeholder={field.placeholder} className={input} />}
        {field.help && <span className="mt-1 block text-[10px] leading-4 text-white/40">{field.help}</span>}
      </label>;
    })}
    {needPassword && <label className="block"><span className="mb-1 block text-[11px] text-amber-200">Your password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className={input} /></label>}
    <button disabled={busy} className={`h-9 rounded-lg px-3.5 text-[12px] font-medium transition disabled:opacity-50 ${danger ? "border border-red-400/40 text-red-200 hover:bg-red-400/10" : "bg-[#c7ff4a] text-[#071019] hover:bg-[#d5ff72]"}`}>{busy ? "Working…" : needPassword ? "Confirm and continue" : submitLabel}</button>
    {message && <p role="status" className={`text-[11px] ${message.tone === "ok" ? "text-[#c7ff4a]" : "text-red-300"}`}>{message.text}</p>}
    {result !== null && result !== undefined && typeof result === "object" && <pre className="max-h-64 overflow-auto rounded-lg bg-black/30 p-2 text-[10px] text-white/70">{JSON.stringify(result, null, 2)}</pre>}
  </form>;
}

/** Says separately whether the record was saved and whether an email actually left. */
function deliveryMessage(result: unknown): { tone: "ok" | "error"; text: string } | null {
  const r = (result || {}) as { delivery?: string; emailError?: { code?: string; status?: number | null } };
  switch (r.delivery) {
    case "email_sent": return { tone: "ok", text: "Saved. Email sent." };
    case "in_app_only": return { tone: "ok", text: "Saved. No email sent: this person already has an account and accepts inside NYNZ." };
    case "suppressed_test_address": return { tone: "ok", text: "Saved. No email sent: test address." };
    case "email_failed": {
      const code = r.emailError?.code || "unknown";
      const why = code === "over_email_send_rate_limit" ? "the hourly email limit was reached. Try again later." : `the email provider refused it (${code}${r.emailError?.status ? `, ${r.emailError.status}` : ""}).`;
      return { tone: "error", text: `Saved, but no email was sent: ${why}` };
    }
    default: return null;
  }
}
