/**
 * Read-only inventory before the 0.5 preview billing switchover: live
 * previews, active holds, previous-billing runtime charges and trial grants.
 * Selects only; prints counts and amounts, never emails or keys.
 *
 *   npx tsx scripts/ops/preview-billing-inventory.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const count = async (table: string, build: (q: any) => any) => { const { count: n, error } = await build(db.from(table).select("*", { count: "exact", head: true })); if (error) throw error; return n ?? 0; };
const day = new Date(Date.now() - 86_400_000).toISOString();

const sandboxes = (await db.from("platform_resources").select("provider_ref,project_id,purpose,state,created_at,last_accessed_at").eq("kind", "e2b_sandbox").in("state", ["active", "paused", "provisioning"])).data || [];
const reservations = (await db.from("credit_reservations").select("id,user_id,build_id,amount,consumed,created_at").eq("status", "active")).data || [];
const grants = (await db.from("credit_grants").select("user_id,source,amount,remaining,expires_at,idempotency_key")).data || [];
const limits = (await db.from("spend_limits").select("name,provider,period,limit_paise,active")).data || [];
const windows = (await db.from("credit_ledger").select("event_key,amount,created_at").like("event_key", "runtime:%").gte("created_at", day)).data || [];
const trialGrants = grants.filter((g) => String(g.idempotency_key || "").startsWith("trial:"));
const now = Date.now();
const out = {
  live_preview_sandboxes: sandboxes.length,
  live_by_state: Object.fromEntries(["active", "paused", "provisioning"].map((s) => [s, sandboxes.filter((x) => x.state === s).length])),
  projects_with_live_preview: await count("projects", (q) => q.not("active_sandbox_id", "is", null)),
  builds_in_progress: await count("build_jobs", (q) => q.not("status", "in", "(succeeded,failed,cancelled)")),
  active_holds: reservations.map((r) => ({ held: r.amount, used: r.consumed, age_minutes: Math.round((now - Date.parse(r.created_at)) / 60_000) })),
  runtime_window_charges_all_time: await count("credit_ledger", (q) => q.like("event_key", "runtime:%")),
  runtime_window_charges_last_24h: windows.length,
  latest_window_charge_minutes_ago: windows.length ? Math.round((now - Math.max(...windows.map((w) => Date.parse(w.created_at)))) / 60_000) : null,
  build_sandbox_charges: await count("credit_ledger", (q) => q.like("event_key", "e2b:%:build")),
  grant_sources: grants.reduce((acc: Record<string, number>, g) => { acc[g.source] = (acc[g.source] || 0) + 1; return acc; }, {}),
  trial_key_grants: { count: trialGrants.length, amounts: [...new Set(trialGrants.map((g) => g.amount))], sources: [...new Set(trialGrants.map((g) => g.source))], unexpired_with_credits: trialGrants.filter((g) => g.remaining > 0 && (!g.expires_at || Date.parse(g.expires_at) > now)).length, remaining_total: trialGrants.reduce((s, g) => s + Number(g.remaining), 0) },
  spend_limits: limits.map((l) => `${l.name} ${l.period} ${l.limit_paise}${l.provider ? ` ${l.provider}` : ""}${l.active ? "" : " (inactive)"}`),
  subscriptions: await count("subscriptions", (q) => q),
  // Whether the 0.5 schema is present (expected: absent before the migration).
  schema_0_5: {
    sandbox_sessions: await db.from("sandbox_sessions").select("id").limit(1).then((r) => r.error ? `absent (${r.error.code})` : "present"),
    reservation_kind: await db.from("credit_reservations").select("kind").limit(1).then((r) => r.error ? `absent (${r.error.code})` : "present"),
  },
};
console.log(JSON.stringify(out, null, 2));
