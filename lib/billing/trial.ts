/**
 * When free trial building reopens. The shared daily trial allowance
 * (spend_limits scope "trial", period "day") resets at midnight India time,
 * the same boundary authorize_provider_spend uses.
 */
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

export function trialReopensAt(now: Date = new Date()): Date {
  const local = now.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS + DAY_MS - IST_OFFSET_MS);
}

/** "12:00 am India time on Fri, 7 Nov (in about 3 hours)" */
export function describeTrialReopen(at: Date | string, now: Date = new Date()): string {
  const when = typeof at === "string" ? new Date(at) : at;
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }).format(when);
  const minutes = Math.max(0, Math.round((when.getTime() - now.getTime()) / 60_000));
  const relative = minutes < 60 ? (minutes <= 1 ? "in a minute" : `in ${minutes} minutes`) : `in about ${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"}`;
  return `12:00 am India time on ${day} (${relative})`;
}

export function trialPausedMessage(now: Date = new Date()) {
  return `Free trial building is paused until ${describeTrialReopen(trialReopensAt(now), now)}. Free trials share a daily allowance and today's is used up. Your projects are safe, and nothing was charged for this request.`;
}
