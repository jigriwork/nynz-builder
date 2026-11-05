/**
 * Rehearses 20261105100000_resumable_builds.sql on a disposable PostgreSQL
 * server: applies every earlier migration, seeds production-shaped builds and
 * credits, snapshots them, applies the new migration in one transaction (as
 * `supabase db push` does), then verifies and exercises old and new paths.
 * Run through scripts/rehearse-resumable-migration.sh.
 */
import pg from "pg";
import { SUPABASE_STUB, migrationFiles } from "../db/harness";
import { MIGRATION, UNTIL, exercise, seed, snapshot, verify, type Exec } from "./resumable-upgrade";

const url = process.env.NYNZ_REHEARSAL_PG_URL || "";
const target = new URL(url);
if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/nynz_rehearsal") throw new Error("Rehearsal requires the disposable local nynz_rehearsal database");

const client = new pg.Client({ connectionString: url });
await client.connect();
const exec: Exec = async (sql, params) => (await client.query(sql, params as unknown[])).rows;
const version = (await exec("show server_version"))[0].server_version;
await client.query(SUPABASE_STUB);
for (const m of migrationFiles().filter((m) => m.name <= UNTIL)) await client.query(m.sql);
await seed(exec);
const before = await snapshot(exec);
const migration = migrationFiles().find((m) => m.name === MIGRATION)!;
const started = Date.now();
await client.query("begin");
await client.query(migration.sql);
await client.query("commit");
const took = Date.now() - started;
const results = [...await verify(exec, before), ...await exercise(exec)];
console.log(`PostgreSQL ${version}; ${before.counts.builds} builds, ${before.counts.ledger} ledger rows; migration applied in ${took} ms`);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
await client.end();
process.exit(results.every((r) => r.ok) ? 0 : 1);
