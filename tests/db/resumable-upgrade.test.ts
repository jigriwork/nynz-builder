import { describe, expect, it } from "vitest";
import { createDb, migrationFiles } from "./harness";
import { MIGRATION, UNTIL, exercise, seed, snapshot, verify, type Exec } from "../rehearsal/resumable-upgrade";

/** Resumable-builds migration on production-shaped existing data (in-process Postgres). */
describe("20261105100000_resumable_builds on existing builds and credits", () => {
  it("leaves existing records unchanged, backfills requests and keeps the previous worker working", async () => {
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
    const exec: Exec = async (sql, params) => (await db.query<Record<string, any>>(sql, params)).rows;
    const results = [...await verify(exec, before!), ...await exercise(exec)];
    for (const result of results) expect({ check: result.name, ok: result.ok, detail: result.detail }).toMatchObject({ ok: true });
  }, 120_000);
});
