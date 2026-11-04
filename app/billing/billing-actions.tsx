"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RazorpayOptions = Record<string, unknown> & { handler: (response: Record<string, string>) => void };
declare global { interface Window { Razorpay?: new (options: RazorpayOptions) => { open: () => void } } }

function loadCheckout() {
  return new Promise<void>((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(); script.onerror = () => reject(new Error("Checkout could not load"));
    document.body.appendChild(script);
  });
}

export function BillingActions(props: { kind: "plan"; plan: string; current?: string; hasSubscription: boolean; available: boolean; cancelScheduled: boolean } | { kind: "topup"; pack: string; label: string; available: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const button = "h-10 rounded-xl px-4 text-[12px] font-semibold transition disabled:opacity-45";

  async function post(url: string, body: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Please try again.");
    return data;
  }

  async function checkout() {
    setBusy(true); setMessage("");
    try {
      const isPlan = props.kind === "plan";
      const session = isPlan ? await post("/api/billing/checkout", { plan: props.plan }) : await post("/api/billing/topup", { pack: props.pack });
      await loadCheckout();
      new window.Razorpay!({
        key: session.keyId, name: "NYNZ", description: isPlan ? `${session.planName} plan` : "Credit top-up",
        ...(isPlan ? { subscription_id: session.subscriptionId } : { order_id: session.orderId, amount: session.amount, currency: "INR" }),
        prefill: { email: session.email }, theme: { color: "#0b121b" },
        handler: async (response) => {
          try { const done = await post("/api/billing/verify", { kind: isPlan ? "subscription" : "topup", ...response }); setMessage(done.message); }
          catch (error) { setMessage(error instanceof Error ? error.message : "We could not confirm the payment yet."); }
          router.refresh();
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Checkout could not be started."); setBusy(false); }
  }

  async function manage(action: "cancel" | "change") {
    if (action === "cancel" && !window.confirm("Cancel at the end of this billing period? Your plan stays active until then.")) return;
    setBusy(true);
    try { const done = await post("/api/billing/subscription", action === "cancel" ? { action } : { action, plan: props.kind === "plan" ? props.plan : "" }); setMessage(done.message); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    setBusy(false);
  }

  if (props.kind === "topup") return <div><button disabled={!props.available || busy} onClick={checkout} className={`${button} border border-white/[.15] text-white hover:bg-white/[.06]`}>{props.label}</button>{message && <p className="mt-2 text-[11px] text-white/70">{message}</p>}</div>;
  const isCurrent = props.current === props.plan;
  return <div>
    {isCurrent ? (props.cancelScheduled ? <p className="text-[12px] text-amber-200">Cancels at the end of this period.</p> : <button disabled={busy} onClick={() => manage("cancel")} className={`${button} border border-white/[.15] text-white/80 hover:bg-white/[.06]`}>Cancel at period end</button>)
      : props.hasSubscription ? <button disabled={!props.available || busy} onClick={() => manage("change")} className={`${button} border border-white/[.15] text-white hover:bg-white/[.06]`}>Switch at next renewal</button>
      : <button disabled={!props.available || busy} onClick={checkout} className={`${button} bg-[#c7ff4a] text-[#071019] hover:bg-[#d5ff72]`}>{props.available ? "Subscribe" : "Not available yet"}</button>}
    {message && <p role="status" className="mt-2 text-[11px] text-white/70">{message}</p>}
  </div>;
}
