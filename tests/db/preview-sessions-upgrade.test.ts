import { describe, expect, it } from "vitest";
import { createDb, migrationFiles } from "./harness";
import { MIGRATION, UNTIL, exercise, seed, snapshot, verify, type Exec } from "../rehearsal/preview-sessions-upgrade";

/** 0.5.0 preview billing switchover on production-shaped previews, holds and grants (in-process Postgres). */
describe("20261106100000_preview_sessions_and_trial on existing previews and holds", () => {
  it("keeps balances and grants, never double-charges paid runtime, survives the rollout overlap and rolls back cleanly", async () => {
    let before: Awaited<ReturnType<typeof snapshot>> | undefined;
    const db = await createDb({
      until: UNTIL,
      beforeRest: async (db) => {
        const exec: Exec = async (sql, params) => (await db.query<Record<string, any>>(sql, params)).rows;
        await seed(exec);
        before = await snapshot(exec);
      },
    });
    expect(migrationFiles().map((m) => m.name)).toContain(MIGRATION);
    const exec: Exec = async (sql, params) => params ? (await db.query<Record<string, any>>(sql, params)).rows : ((await db.exec(sql)).at(-1)?.rows as Array<Record<string, any>>) || [];
    const results = [...await verify(exec, before!), ...await exercise(exec)];
    for (const result of results) expect({ check: result.name, ok: result.ok, detail: result.detail }).toMatchObject({ ok: true });
  }, 120_000);
});
