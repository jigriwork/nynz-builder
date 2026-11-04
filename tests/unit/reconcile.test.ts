import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileResources } from "../../lib/platform/reconcile";

type Row = Record<string, any>;
/** Minimal in-memory stand-in for the parts of supabase-js the reconciler uses. */
function fakeDb(tables: Record<string, Row[]>, storage: Record<string, string[]>) {
  const rpcCalls: string[] = [];
  function query(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: { kind: "select" | "update" | "upsert"; values?: Row } = { kind: "select" };
    const builder: any = {
      select: () => builder, order: () => builder, limit: () => builder,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), builder),
      update: (values: Row) => ((op = { kind: "update", values }), builder),
      upsert: (values: Row) => {
        const rows = (tables[table] ||= []);
        const existing = rows.find((r) => r.kind === values.kind && r.provider_ref === values.provider_ref);
        if (existing) Object.assign(existing, values); else rows.push({ ...values });
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (v: unknown) => void) => {
        const rows = (tables[table] ||= []).filter((r) => filters.every((f) => f(r)));
        if (op.kind === "update") rows.forEach((r) => Object.assign(r, op.values));
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }
  const db = {
    from: query,
    rpc: async (name: string) => { rpcCalls.push(name); return { data: name === "reconcile_credits" ? { released: 0, expired: 0 } : 0, error: null }; },
    storage: { from: (bucket: string) => ({
      list: async (prefix: string) => ({ data: (storage[`${bucket}/${prefix}`] || []).map((name) => ({ id: name, name })), error: null }),
      remove: async (names: string[]) => { const key = names[0].split("/").slice(0, -1).join("/"); storage[`${bucket}/${key}`] = []; return { data: null, error: null }; },
    }) },
  };
  return { db: db as unknown as SupabaseClient, rpcCalls };
}

describe("resource reconciliation", () => {
  it("terminates marked resources idempotently, cleans storage and kills orphans", async () => {
    const tables = { platform_resources: [
      { id: "r1", kind: "e2b_sandbox", provider_ref: "sbx-replaced", state: "terminating", attempts: 0 },
      { id: "r2", kind: "e2b_sandbox", provider_ref: "sbx-gone", state: "terminating", attempts: 0 },
      { id: "r3", kind: "storage_prefix", provider_ref: "project-assets/p1", state: "terminating", attempts: 0 },
      { id: "r4", kind: "e2b_sandbox", provider_ref: "sbx-live", state: "active", attempts: 0 },
    ] };
    const storage = { "project-assets/p1": ["a.png", "b.svg"] };
    const killed: string[] = [];
    const { db, rpcCalls } = fakeDb(tables, storage);
    const now = Date.now();
    const summary = await reconcileResources({
      db, now: () => now,
      killSandbox: async (id) => { if (id === "sbx-gone") throw new Error("SandboxNotFoundError: sandbox not found"); killed.push(id); },
      listSandboxes: async () => [
        { sandboxId: "sbx-live", startedAt: new Date(now - 3600_000), metadata: {} },
        { sandboxId: "sbx-orphan", startedAt: new Date(now - 3600_000), metadata: { projectId: "p9" } },
        { sandboxId: "sbx-new", startedAt: new Date(now - 60_000), metadata: {} },
      ],
    });
    expect(killed.sort()).toEqual(["sbx-orphan", "sbx-replaced"]);
    expect(tables.platform_resources.filter((r) => ["r1", "r2", "r3"].includes(r.id)).map((r) => r.state)).toEqual(["terminated", "terminated", "terminated"]);
    expect(tables.platform_resources.find((r) => r.id === "r4")!.state).toBe("active");
    expect(tables.platform_resources.find((r) => r.provider_ref === "sbx-orphan")).toMatchObject({ state: "terminated", terminate_reason: "orphan" });
    expect(storage["project-assets/p1"]).toEqual([]);
    expect(summary).toMatchObject({ killed: 2, storageRemoved: 2, orphansKilled: 1, killFailures: 0 });
    expect(rpcCalls).toEqual(["retire_stale_provisioning", "retire_idle_previews", "reconcile_credits"]);

    // Re-running changes nothing and kills nothing new.
    killed.length = 0;
    await reconcileResources({ db, now: () => now, killSandbox: async (id) => { killed.push(id); }, listSandboxes: async () => [] });
    expect(killed).toEqual([]);
  });

  it("records failures for retry instead of marking resources terminated", async () => {
    const tables = { platform_resources: [{ id: "r1", kind: "e2b_sandbox", provider_ref: "sbx-x", state: "terminating", attempts: 2 }] };
    const { db } = fakeDb(tables, {});
    const summary = await reconcileResources({ db, killSandbox: async () => { throw new Error("E2B 503"); }, listSandboxes: async () => [] });
    expect(summary.killFailures).toBe(1);
    expect(tables.platform_resources[0]).toMatchObject({ state: "terminating", attempts: 3, last_error: "E2B 503" });
  });
});
