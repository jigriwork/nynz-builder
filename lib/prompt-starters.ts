/**
 * Curated starting briefs. They describe what NYNZ builds today: React web
 * apps with demonstration data saved in the browser. None of them claim real
 * payments, accounts, databases or publishing.
 */
export const STARTERS = [
  { label: "Booking", title: "Class booking for a yoga studio", prompt: "Build a class booking app for a small yoga studio called Stillwater. Members browse a weekly timetable, see how many spots are left, book or cancel a class, and join a waitlist when a class is full. The studio manager has a Today view listing each class with its attendees. Calm, airy design with soft greens and plenty of white space. Use demonstration data saved in the browser; no real payments or sign-in." },
  { label: "Inventory", title: "Inventory and orders for a ceramics brand", prompt: "Build an inventory and order tracker for a small ceramics brand called Kiln & Co. Show products with stock levels and low-stock warnings, let staff add or adjust stock, and track orders through New, Packed and Shipped. Include a dashboard with totals and a searchable order list. Warm, earthy design. Use demonstration data saved in the browser." },
  { label: "CRM", title: "Client CRM for a design agency", prompt: "Build a lightweight CRM for a five-person design agency. Track clients and their contacts, deals moving through Lead, Proposal, Won and Lost on a drag-friendly board, and notes or follow-up dates for each client. Add a Home view showing follow-ups due this week. Clean, professional design. Use demonstration data saved in the browser; no email sending." },
  { label: "Portal", title: "Member portal for a sports club", prompt: "Build a member portal for a neighbourhood badminton club. Members see upcoming sessions, sign up for a session, view club announcements and update their own profile details. A simple admin view lets the organiser post announcements and see who signed up. Bright, energetic design. Use demonstration data saved in the browser; sign-in can be simulated with a member picker." },
  { label: "Storefront", title: "Storefront for a tea shop", prompt: "Build a storefront for a small tea shop called Leaf & Ember. Show a filterable product catalogue with product detail pages, a cart with quantity controls and an order summary page. Checkout should end at an order confirmation screen; do not take real payments. Elegant, minimal design with large product photography placeholders. Use demonstration data." },
  { label: "Tracker", title: "Personal habit tracker", prompt: "Build a personal habit tracker. I can add habits, tick them off each day, see current and best streaks, and view a weekly and monthly progress chart. Include gentle reminders text and a dark mode toggle. Friendly, motivating design that works well on a phone. Save everything in the browser." },
] as const;

export type StarterDraft = { name: string; purpose: string; users: string; features: string; look: string; data: "demo" | "backend" };

/** Turns the structured helper form into an editable brief (no AI call). */
export function draftToPrompt(d: StarterDraft) {
  const lines = [
    `Build ${d.name.trim() ? `an app called ${d.name.trim()}` : "an app"}${d.purpose.trim() ? ` that ${d.purpose.trim().replace(/^(that|to)\s+/i, "")}` : ""}.`,
    d.users.trim() && `It is for ${d.users.trim().replace(/^(for)\s+/i, "")}.`,
    d.features.trim() && `Essential features and actions:\n${d.features.split(/\n|;/).map((f) => f.trim()).filter(Boolean).map((f) => `- ${f}`).join("\n")}`,
    d.look.trim() && `Look and feel: ${d.look.trim()}.`,
    d.data === "demo" ? "Use demonstration data saved in the browser." : "I will connect my own Supabase project for real data; use it for storage and sign-in where needed.",
  ];
  return lines.filter(Boolean).join("\n\n");
}
