/**
 * True parallel checks on a real PostgreSQL server (separate connections,
 * not the single-connection in-process database). Runs only when
 * NYNZ_PG_URL points at a disposable database; `pnpm test:concurrency`
 * starts one locally, and CI provides one. Skipped (and reported as skipped)
 * otherwise; sequential tests are never presented as parallel proof.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUPABASE_STUB, migrationFiles } from "../db/harness";

const url = process.env.NYNZ_PG_URL;
const suite = url ? describe : describe.skip;
let admin: pg.Client;

async function asService<T>(sql: string, params: unknown[]): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const result = await client.query(sql, params);
    await client.query("commit");
    return result.rows[0] as T;
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { await client.end(); }
}

suite("credit reservations under real concurrency", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query("drop schema if exists public cascade; drop schema if exists private cascade; drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema if exists extensions cascade; create schema public;");
    for (const role of ["anon", "authenticated", "service_role"]) await admin.query(`do $$ begin if exists (select 1 from pg_roles where rolname='${role}') then execute 'drop owned by ${role}'; execute 'drop role ${role}'; end if; end $$;`);
    await admin.query(SUPABASE_STUB);
    for (const m of migrationFiles()) await admin.query(m.sql);
  }, 120_000);
  afterAll(async () => { await admin?.end(); });

  async function customer(credits: number) {
    const user = randomUUID();
    await admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [user, `${user.slice(0, 8)}@example.test`]);
    await admin.query("select public.grant_credits($1,'plan_included',$2,null,'plan',null,$3)", [user, credits, `plan:${user}`]);
    const projects: string[] = [];
    for (let i = 0; i < 20; i += 1) projects.push((await admin.query("insert into public.projects(owner_id,name) values($1,$2) returning id", [user, `p${i}`])).rows[0].id);
    return { user, projects };
  }
  const outcome = (p: Promise<unknown>) => p.then(() => "OK", (e: Error) => e.message.split(" ")[0]);

  it("20 parallel reservations from separate connections never exceed the balance", async () => {
    const { user, projects } = await customer(100);
    const results = await Promise.all(projects.map((project) => outcome(asService("select public.reserve_credits($1,$2,$3,30,50)", [user, project, randomUUID()]))));
    expect(results.filter((r) => r === "OK")).toHaveLength(3);
    expect(results.filter((r) => r === "INSUFFICIENT_CREDITS")).toHaveLength(17);
    const held = (await admin.query("select coalesce(sum(amount-consumed),0)::int held from public.credit_reservations where user_id=$1 and status='active'", [user])).rows[0].held;
    expect(held).toBe(90);
  }, 60_000);

  it("parallel requests respect the plan's concurrency limit", async () => {
    const { user, projects } = await customer(10_000);
    const results = await Promise.all(projects.map((project) => outcome(asService("select public.reserve_credits($1,$2,$3,5,2)", [user, project, randomUUID()]))));
    expect(results.filter((r) => r === "OK")).toHaveLength(2);
    expect(results.filter((r) => r === "CONCURRENCY_LIMIT")).toHaveLength(18);
  }, 60_000);

  it("parallel duplicate provider events are charged exactly once", async () => {
    const { user, projects } = await customer(100);
    const build = randomUUID();
    await asService("select public.reserve_credits($1,$2,$3,50,5)", [user, projects[0], build]);
    await Promise.all(Array.from({ length: 15 }, () => outcome(asService("select public.consume_credits($1,7,'evt-dup','openrouter','m',700,'provider_reported')", [build]))));
    const consumed = (await admin.query("select consumed::int from public.credit_reservations where build_id=$1", [build])).rows[0].consumed;
    expect(consumed).toBe(7);
    expect((await admin.query("select count(*)::int n from public.credit_ledger where event_key='evt-dup'")).rows[0].n).toBe(1);
  }, 60_000);

  it("parallel provider calls cannot exceed a combined spending cap", async () => {
    await admin.query("update public.spend_limits set active=false");
    await admin.query("insert into public.spend_limits(name,period,window_start,window_end,limit_paise) values('Parallel ₹50','window',now()-interval '1 minute',now()+interval '1 hour',5000)");
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => outcome(asService("select public.authorize_provider_spend('openrouter','model','m',800,null,null,$1)", [`par-${i}`]))));
    expect(results.filter((r) => r === "OK")).toHaveLength(6);
    const total = (await admin.query("select sum(estimated_paise)::int s from public.provider_spend where status<>'voided'")).rows[0].s;
    expect(total).toBeLessThanOrEqual(5000);
  }, 60_000);
});
