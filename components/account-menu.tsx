"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Coins, CreditCard, LogOut, ShieldCheck, ShieldHalf, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VERSION_LABEL } from "@/lib/version";

export type AccountSummary = { email: string; availableCredits: number | null; isStaff: boolean; canOpenAdmin: boolean; pendingInvitations: number };

/** Account menu shared by the workspace screens. "Admin console" appears only for staff with admin access; the server re-checks on every admin request. */
export function AccountMenu({ account }: { account: AccountSummary }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  async function signOut() { await createClient().auth.signOut(); window.location.assign("/"); }
  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] text-white/75 transition hover:bg-white/[.06] hover:text-white";
  return <div ref={root} className="relative">
    <button onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-2 rounded-full border border-white/[.08] bg-white/[.03] py-1.5 pl-1.5 pr-2.5 text-[12px] text-white/70 transition hover:bg-white/[.07]">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-[#c7ff4a] to-[#5ad1b3] text-[10px] font-semibold text-[#071019]">{account.email.slice(0, 1).toUpperCase()}</span>
      <span className="hidden max-w-[180px] truncate sm:inline">{account.email}</span>
      {account.pendingInvitations > 0 && <span className="h-2 w-2 rounded-full bg-[#c7ff4a]" aria-label="Pending invitation" />}
      <ChevronDown className="h-3.5 w-3.5 text-white/40" />
    </button>
    {open && <div role="menu" className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-white/[.1] bg-[#111924] p-1.5 shadow-[0_20px_60px_rgba(0,0,0,.5)]">
      <div className="border-b border-white/[.06] px-3 pb-2.5 pt-2"><p className="truncate text-[12px] text-white">{account.email}</p>{account.availableCredits !== null && <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#c7ff4a]"><Coins className="h-3 w-3" />{account.availableCredits.toLocaleString()} credits available</p>}</div>
      <div className="py-1">
        <Link role="menuitem" href="/billing" className={item}><CreditCard className="h-3.5 w-3.5" /> Plan and billing</Link>
        <Link role="menuitem" href="/account/security" className={item}><ShieldCheck className="h-3.5 w-3.5" /> Account security</Link>
        {account.pendingInvitations > 0 && <Link role="menuitem" href="/account/invitations" className={item}><UserPlus className="h-3.5 w-3.5" /> Staff invitation ({account.pendingInvitations})</Link>}
        {account.canOpenAdmin && <Link role="menuitem" href="/admin" className={item}><ShieldHalf className="h-3.5 w-3.5" /> Admin console</Link>}
      </div>
      <div className="border-t border-white/[.06] pt-1"><button role="menuitem" onClick={signOut} className={item}><LogOut className="h-3.5 w-3.5" /> Sign out</button><a href="/version" className="block px-3 pb-1 pt-2 font-mono text-[10px] text-white/40">NYNZ {VERSION_LABEL}</a></div>
    </div>}
  </div>;
}
