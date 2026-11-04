import type { SupabaseClient } from "@supabase/supabase-js";
import { redact } from "./redact";

export type ReconcileDeps = {
  db: SupabaseClient;
  killSandbox: (sandboxId: string) => Promise<unknown>;
  listSandboxes: () => Promise<Array<{ sandboxId: string; startedAt: Date; metadata: Record<string, string> }>>;
  now?: () => number;
  idleDays?: number;
  orphanGraceMinutes?: number;
};

/** Removes every object under a storage prefix, including nested folders. */
async function removePrefix(db: SupabaseClient, bucket: string, prefix: string, depth = 0): Promise<number> {
  if (depth > 8) throw new Error("Storage cleanup depth exceeded");
  let removed = 0;
  for (let page = 0; page < 50; page += 1) {
    const { data: entries, error } = await db.storage.from(bucket).list(prefix, { limit: 100 });
    if (error) throw error;
    const files = (entries || []).filter((item) => item.id).map((item) => `${prefix}/${item.name}`);
    const folders = (entries || []).filter((item) => !item.id).map((item) => `${prefix}/${item.name}`);
    for (const folder of folders) removed += await removePrefix(db, bucket, folder, depth + 1);
    if (files.length) {
      const result = await db.storage.from(bucket).remove(files);
      if (result.error) throw result.error;
      removed += files.length;
    }
    // A page containing only folders may have more siblings after those
    // folders are emptied. Re-list rather than marking a partial cleanup done.
    if ((entries || []).length < 100) return removed;
  }
  throw new Error("Storage cleanup page budget exceeded; retry required");
}

const isNotFound = (error: unknown) => /not\s*found|404|does not exist/i.test(error instanceof Error ? `${error.name} ${error.message}` : String(error));

/**
 * Idempotent resource reconciliation. Safe to run concurrently with builds and
 * to re-run after a crash: every step moves records toward a terminal state
 * and treats "already gone" as success.
 *   1. retire stale provisioning records and idle previews (marks terminating)
 *   2. kill sandboxes marked terminating
 *   3. remove storage objects for deleted projects
 *   4. kill NYNZ sandboxes at the provider that no live record accounts for
 *   5. release finished credit reservations and expire lapsed grants
 */
export async function reconcileResources(deps: ReconcileDeps) {
  const { db } = deps;
  const now = deps.now?.() ?? Date.now();
  const summary = { stale: 0, idle: 0, killed: 0, killFailures: 0, storageRemoved: 0, orphansKilled: 0, credits: null as unknown, errors: [] as string[] };

  const stale = await db.rpc("retire_stale_provisioning", { p_minutes: 120 });
  if (stale.error) summary.errors.push(`stale: ${stale.error.message}`); else summary.stale = Number(stale.data || 0);
  const idle = await db.rpc("retire_idle_previews", { p_days: deps.idleDays ?? 7 });
  if (idle.error) summary.errors.push(`idle: ${idle.error.message}`); else summary.idle = Number(idle.data || 0);

  const { data: terminating, error: terminatingError } = await db.from("platform_resources").select("id,kind,provider_ref,attempts").eq("state", "terminating").order("terminate_requested_at").limit(200);
  if (terminatingError) summary.errors.push("cleanup registry unavailable");
  for (const resource of terminating || []) {
    try {
      if (resource.kind === "e2b_sandbox") {
        try { await deps.killSandbox(resource.provider_ref); } catch (error) { if (!isNotFound(error)) throw error; }
        summary.killed += 1;
      } else if (resource.kind === "storage_prefix" || resource.kind === "deployment_artifact") {
        const [bucket, ...rest] = String(resource.provider_ref).split("/");
        const prefix = rest.join("/");
        if (!["project-assets", "published-sites"].includes(bucket) || !prefix || prefix.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid cleanup storage target");
        summary.storageRemoved += await removePrefix(db, bucket, prefix);
      }
      const marked = await db.from("platform_resources").update({ state: "terminated", terminated_at: new Date(now).toISOString(), last_error: null }).eq("id", resource.id).eq("state", "terminating");
      if (marked.error) throw marked.error;
    } catch (error) {
      summary.killFailures += 1;
      const message = error instanceof Error ? redact(error.message).slice(0, 300) : "cleanup failed";
      await db.from("platform_resources").update({ attempts: Number(resource.attempts || 0) + 1, last_error: message, ...(Number(resource.attempts || 0) >= 9 ? { state: "failed" } : {}) }).eq("id", resource.id);
    }
  }

  try {
    const live = await deps.listSandboxes();
    if (live.length) {
      const ids = live.map((item) => item.sandboxId);
      const known = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await db.from("platform_resources").select("provider_ref").eq("kind", "e2b_sandbox").in("state", ["provisioning", "active", "paused"]).in("provider_ref", ids.slice(i, i + 200));
        // Missing evidence is not evidence of an orphan. Never kill a live
        // customer preview when the registry lookup failed.
        if (error || !data) throw new Error("Resource registry unavailable; orphan deletion skipped");
        (data || []).forEach((row) => known.add(row.provider_ref));
      }
      const grace = (deps.orphanGraceMinutes ?? 15) * 60_000;
      for (const sandbox of live) {
        if (known.has(sandbox.sandboxId) || now - sandbox.startedAt.getTime() < grace) continue;
        try { await deps.killSandbox(sandbox.sandboxId); } catch (error) { if (!isNotFound(error)) { summary.errors.push(`orphan ${sandbox.sandboxId}`); continue; } }
        summary.orphansKilled += 1;
        await db.from("platform_resources").upsert({
          kind: "e2b_sandbox", provider_ref: sandbox.sandboxId, project_id: sandbox.metadata.projectId || null, build_id: sandbox.metadata.buildId || null,
          purpose: "build", state: "terminated", terminate_reason: "orphan", terminated_at: new Date(now).toISOString(), metadata: { orphan: true },
        }, { onConflict: "kind,provider_ref" });
      }
    }
  } catch (error) {
    summary.errors.push(`orphan scan: ${error instanceof Error ? redact(error.message).slice(0, 200) : "failed"}`);
  }

  const credits = await db.rpc("reconcile_credits");
  if (credits.error) summary.errors.push(`credits: ${credits.error.message}`); else summary.credits = credits.data;
  return summary;
}
