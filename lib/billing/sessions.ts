import type { SupabaseClient } from "@supabase/supabase-js";

/** What the provider says about a sandbox right now. */
export type SandboxInfo = { state: "running" | "paused" | "gone" | "unknown"; endAt?: string | null };
type Due = { session_id: string; sandbox_id: string; natural_end: string; terminated_at: string | null; started_at: string };

/**
 * Settles preview billing sessions whose sandbox has stopped. The end of a
 * session comes from the best evidence available, in this order: NYNZ's
 * shutdown record (failed build, replacement after an edit), the provider's
 * pause time, then NYNZ's visit record (the latest end any visit asked for).
 * Nothing is ever charged beyond what was held. A session whose sandbox the
 * provider still reports as running stays open. When the provider cannot be
 * reached for a long time and no shutdown is recorded, the session is charged
 * as a labelled estimate at its visit-record end and reconciled later.
 */
export async function settleSandboxSessions(deps: { db: SupabaseClient; sandboxInfo: (sandboxId: string) => Promise<SandboxInfo>; now?: Date; graceSeconds?: number; estimateAfterSeconds?: number }) {
  const now = deps.now || new Date();
  const { data, error } = await deps.db.rpc("sandbox_sessions_to_settle", { p_at: now.toISOString(), p_grace_seconds: deps.graceSeconds ?? 60 });
  if (error) throw error;
  const outcome = { settled: 0, estimated: 0, open: 0 };
  for (const row of (data || []) as Due[]) {
    const natural = new Date(row.natural_end);
    const shutdown = row.terminated_at ? new Date(row.terminated_at) : null;
    if (shutdown && shutdown <= natural) {
      await settle(deps.db, row.session_id, shutdown, "shutdown");
      outcome.settled += 1;
      continue;
    }
    const info = await deps.sandboxInfo(row.sandbox_id).catch((): SandboxInfo => ({ state: "unknown" }));
    if (info.state === "running") { outcome.open += 1; continue; }
    if (info.state === "paused" && info.endAt) {
      const end = new Date(Math.min(new Date(info.endAt).getTime(), natural.getTime()));
      await settle(deps.db, row.session_id, end, "provider_pause");
      outcome.settled += 1;
      continue;
    }
    if (info.state === "gone" || info.state === "paused") {
      await settle(deps.db, row.session_id, natural, "visit_log");
      outcome.settled += 1;
      continue;
    }
    // Provider unavailable: wait, then charge an estimate that can be reconciled.
    if (now.getTime() - natural.getTime() > (deps.estimateAfterSeconds ?? 3_600) * 1000) {
      await settle(deps.db, row.session_id, natural, "visit_log", "The provider's runtime record was unavailable; charged from NYNZ's visit record.");
      outcome.estimated += 1;
    } else outcome.open += 1;
  }
  return outcome;
}

/** Corrects estimated sessions once the provider reports a pause time. Refunds only. */
export async function reconcileEstimatedSessions(deps: { db: SupabaseClient; sandboxInfo: (sandboxId: string) => Promise<SandboxInfo> }) {
  const { data } = await deps.db.from("sandbox_sessions").select("id,sandbox_id").eq("status", "estimated").limit(50);
  let reconciled = 0;
  for (const row of data || []) {
    const info = await deps.sandboxInfo(row.sandbox_id).catch((): SandboxInfo => ({ state: "unknown" }));
    if (info.state === "paused" && info.endAt) {
      const { error } = await deps.db.rpc("reconcile_sandbox_session", { p_session: row.id, p_ended_at: info.endAt, p_source: "provider_pause" });
      if (!error) reconciled += 1;
    }
  }
  return reconciled;
}

async function settle(db: SupabaseClient, session: string, end: Date, source: string, estimateReason?: string) {
  const { error } = await db.rpc("settle_sandbox_session", { p_session: session, p_ended_at: end.toISOString(), p_source: source, p_estimate_reason: estimateReason ?? null });
  if (error) throw error;
}

/** E2B's view of a sandbox (read-only). */
export async function e2bSandboxInfo(sandboxId: string, apiKey: string | undefined): Promise<SandboxInfo> {
  if (!apiKey) return { state: "unknown" };
  const response = await fetch(`https://api.e2b.app/sandboxes/${encodeURIComponent(sandboxId)}`, { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return { state: "gone" };
  if (!response.ok) return { state: "unknown" };
  const body = await response.json() as { state?: string; endAt?: string };
  return { state: body.state === "paused" ? "paused" : body.state === "running" ? "running" : "unknown", endAt: body.endAt ?? null };
}
