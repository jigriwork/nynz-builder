"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarCheck2, Check, Package, Rocket, TrendingUp } from "lucide-react";

/**
 * Hero motion around the homepage composer: small "moments" from apps people
 * build (a booking, a sale, an order, a release) float beside the composer and
 * change every few seconds, plus a soft spotlight that follows the pointer.
 *
 * Performance: only transform and opacity animate. Content changes live in
 * these small components, so they never re-render the composer. Everything is
 * static with reduced motion, and the spotlight is off on touch screens.
 */

type Moment = { app: string; title: string; detail: string };

const BOOKINGS: Moment[] = [
  { app: "Yoga studio", title: "Booking confirmed", detail: "Sunrise flow · Sat 7:00 am" },
  { app: "Salon", title: "Appointment booked", detail: "Haircut · Today 5:30 pm" },
  { app: "Clinic", title: "Visit scheduled", detail: "Dr. Mishra · Mon 11:00 am" },
];
const ORDERS: Moment[] = [
  { app: "Tea shop", title: "New order #1042", detail: "Assam gold 250 g · ₹420" },
  { app: "Ceramics", title: "New order #318", detail: "Blue glaze mug ×2 · ₹1,150" },
  { app: "Bakery", title: "New order #77", detail: "Chocolate cake 1 kg · ₹890" },
];
const RELEASES: Moment[] = [
  { app: "Sports club", title: "Version 3 is live", detail: "Added member check-in" },
  { app: "Agency CRM", title: "Version 5 is live", detail: "Added a deals board" },
  { app: "Habit tracker", title: "Version 2 is live", detail: "Added streak badges" },
];
const SALES = [
  { app: "Storefront", total: "₹42,300", bars: [.35, .5, .42, .7, .58, .86, 1] },
  { app: "Bookings", total: "₹18,950", bars: [.5, .38, .62, .55, .8, .7, .95] },
  { app: "Memberships", total: "₹61,200", bars: [.28, .44, .6, .52, .74, .9, .82] },
];

function useCycle(length: number, every: number, offset: number) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        // Skip updates while the tab is hidden or someone is typing in a composer.
        if (document.hidden || document.activeElement?.closest(".nynz-composer")) return;
        setIndex((value) => (value + 1) % length);
      }, every);
    }, offset);
    return () => { clearTimeout(start); if (timer) clearInterval(timer); };
  }, [length, every, offset]);
  return index;
}

function Card({ className, rotate, delay, children }: { className: string; rotate: number; delay: number; children: React.ReactNode }) {
  return <div aria-hidden className={`nynz-moment pointer-events-none absolute w-[224px] ${className}`} style={{ "--r": `${rotate}deg`, animationDelay: `${delay}s, ${delay + .9}s` } as React.CSSProperties}>
    <div className="rounded-2xl border border-white/[.09] bg-[#0f1824]/95 p-3.5 text-left shadow-[0_24px_60px_rgba(0,0,0,.45)]">{children}</div>
  </div>;
}

function MomentBody({ moment, icon: Icon, tone }: { moment: Moment; icon: typeof Check; tone: string }) {
  return <div key={moment.title} className="nynz-pop-in flex items-start gap-3">
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></span>
    <span className="min-w-0">
      <span className="block text-[10px] uppercase tracking-[.16em] text-white/40">{moment.app}</span>
      <span className="mt-0.5 block truncate text-[13px] font-medium text-[#f4f1e8]">{moment.title}</span>
      <span className="block truncate text-[11px] text-white/50">{moment.detail}</span>
    </span>
  </div>;
}

/** Four floating moments around the composer, on wide screens only. */
export function HeroMoments() {
  const booking = BOOKINGS[useCycle(BOOKINGS.length, 4200, 900)];
  const order = ORDERS[useCycle(ORDERS.length, 4200, 2000)];
  const release = RELEASES[useCycle(RELEASES.length, 4200, 3100)];
  const sales = SALES[useCycle(SALES.length, 4200, 1500)];
  return <div className="hidden hero:block">
    <Card className="-left-[238px] -top-4" rotate={-5} delay={1.0}><MomentBody moment={booking} icon={CalendarCheck2} tone="bg-[#c7ff4a]/12 text-[#c7ff4a]" /></Card>
    <Card className="-right-[238px] -top-8" rotate={4} delay={1.15}>
      <div key={sales.app} className="nynz-pop-in">
        <div className="flex items-center justify-between"><span className="text-[10px] uppercase tracking-[.16em] text-white/40">{sales.app}</span><span className="flex items-center gap-1 text-[10px] text-[#c7ff4a]"><TrendingUp className="h-3 w-3" />This week</span></div>
        <p className="mt-1 text-[20px] font-semibold tracking-[-.03em] text-[#f4f1e8]">{sales.total}</p>
        <div className="mt-2 flex h-10 items-end gap-1.5">{sales.bars.map((height, index) => <span key={index} className="nynz-grow flex-1 origin-bottom rounded-sm bg-gradient-to-t from-[#5a97c7]/60 to-[#c7ff4a]/80" style={{ height: `${height * 100}%`, animationDelay: `${index * 60}ms` }} />)}</div>
      </div>
    </Card>
    <Card className="-left-[214px] bottom-4" rotate={3} delay={1.3}><MomentBody moment={order} icon={Package} tone="bg-[#5a97c7]/15 text-[#8cc4ee]" /></Card>
    <Card className="-right-[214px] bottom-0" rotate={-4} delay={1.45}><MomentBody moment={release} icon={Rocket} tone="bg-[#ff9933]/12 text-[#ffb366]" /></Card>
  </div>;
}

/** One rotating moment above the composer on phones and tablets. */
export function HeroTicker() {
  const all = [BOOKINGS[0], ORDERS[0], RELEASES[0], BOOKINGS[1], ORDERS[1], RELEASES[1], BOOKINGS[2], ORDERS[2], RELEASES[2]];
  const icons = [CalendarCheck2, Package, Rocket];
  const index = useCycle(all.length, 3200, 1400);
  const moment = all[index];
  const Icon = icons[index % 3];
  return <div aria-hidden className="mt-8 flex h-9 justify-center hero:hidden">
    <span key={index} className="nynz-pop-in inline-flex max-w-full items-center gap-2 rounded-full border border-white/[.09] bg-[#0f1824] py-1.5 pl-1.5 pr-3.5 text-[12px] text-white/70 shadow-[0_12px_30px_rgba(0,0,0,.35)]">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#c7ff4a]/12 text-[#c7ff4a]"><Icon className="h-3.5 w-3.5" /></span>
      <span className="truncate"><span className="font-medium text-[#f4f1e8]">{moment.title}</span><span className="text-white/45"> · {moment.app}</span></span>
    </span>
  </div>;
}

/** A soft glow that follows the pointer across the hero (mouse and trackpad only). */
export function HeroSpotlight() {
  const glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = glow.current;
    const host = node?.parentElement;
    if (!node || !host || !window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0; let x = 0; let y = 0;
    const move = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      x = event.clientX - box.left; y = event.clientY - box.top;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; node.style.transform = `translate3d(${x - 300}px, ${y - 300}px, 0)`; node.style.opacity = "1"; });
    };
    const leave = () => { node.style.opacity = "0"; };
    host.addEventListener("pointermove", move, { passive: true });
    host.addEventListener("pointerleave", leave);
    return () => { host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", leave); cancelAnimationFrame(frame); };
  }, []);
  return <div ref={glow} aria-hidden className="pointer-events-none absolute left-0 top-0 z-0 h-[600px] w-[600px] rounded-full opacity-0 transition-opacity duration-500 will-change-transform" style={{ background: "radial-gradient(circle, rgba(199,255,74,.09), rgba(90,151,199,.05) 40%, transparent 68%)" }} />;
}
