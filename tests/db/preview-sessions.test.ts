import { beforeAll, describe, expect, it } from "vitest";
import { asService, createDb, createUser, outcome, type Db } from "./harness";

/**
 * Preview billing sessions and the trial budget, on the real migrations.
 * Replays use the recorded production timelines (2026-11-04/05): sandbox
 * creation times, the charged preview visits from the ledger, the last visit
 * implied by E2B's pause time (pause - 600 s), and NYNZ's shutdown time for a
 * sandbox replaced by an edit.
 */
let db: Db;
const PPS = 0.000046 * 95 * 100; // paise per sandbox-second at the configured E2B rate
const PPC = 100;
const q = <T = Record<string, any>>(sql: string, params: unknown[] = []) => asService(db, async (tx) => (await tx.query<T>(sql, params)).rows);
const at = (time: string) => new Date(time).toISOString();

async function customer(credits: number, source = "plan_included") {
  const user = await createUser(db, { email: `${crypto.randomUUID()}@example.test` });
  if (credits > 0) await q("select public.grant_credits($1,$2,$3,null,'test',null,gen_random_uuid()::text)", [user.id, source, credits]);
  return user.id;
}
async function project(owner: string, sandbox: string) {
  const [{ id }] = await q<{ id: string }>("insert into public.projects(owner_id,name,status,active_sandbox_id) values($1,'Replay','ready',$2) returning id", [owner, sandbox]);
  await q("select public.register_sandbox($1,$2,null,'preview')", [sandbox, id]);
  await q("update public.platform_resources set state='active' where provider_ref=$1", [sandbox]);
  return id;
}
const open = (sandbox: string, projectId: string, owner: string, time: string) => q("select (public.open_sandbox_session($1,$2,$3,null,600,$4,$5,$6)).*", [sandbox, projectId, owner, PPS, PPC, at(time)]).then((r) => r[0]);
const visit = (sandbox: string, projectId: string, owner: string, time: string, timeout = 600) => q("select public.extend_sandbox_session($1,$2,$3,$4,$5,$6,$7) r", [projectId, owner, sandbox, timeout, PPS, PPC, at(time)]).then((r) => r[0].r);
/** What the worker does: settle every segment that has stopped, at its known end. */
async function settleDue(time: string) {
  const due = await q<{ session_id: string; natural_end: string; terminated_at: string | null }>("select * from public.sandbox_sessions_to_settle($1, 60)", [at(time)]);
  for (const row of due) {
    const end = row.terminated_at && new Date(row.terminated_at) < new Date(row.natural_end) ? row.terminated_at : row.natural_end;
    await q("select public.settle_sandbox_session($1,$2,$3)", [row.session_id, end, row.terminated_at && end === row.terminated_at ? "shutdown" : "visit_log"]);
  }
  return due.length;
}
const sessions = (sandbox: string) => q("select * from public.sandbox_sessions where sandbox_id=$1 order by segment", [sandbox]);
const charged = (owner: string) => q<{ n: number; total: number }>("select count(*)::int n, coalesce(-sum(amount),0)::int total from public.credit_ledger where user_id=$1 and entry_type='consume'", [owner]).then((r) => r[0]);
const balance = (owner: string) => q("select public.credit_balance($1) b", [owner]).then((r) => r[0].b);

beforeAll(async () => { db = await createDb(); });

describe("replays of recorded sessions", () => {
  const replays = [
    { name: "Saffron Loom", sandbox: "i04cv32n84w87naaqvvt9", created: "2026-11-05T14:56:50Z", visits: ["2026-11-05T14:58:09Z", "2026-11-05T15:00:41Z", "2026-11-05T15:01:54Z"], shutdown: null, end: "2026-11-05T15:11:54Z", seconds: 904, credits: 4, today: 15 },
    { name: "Kesari Threads, first sandbox (replaced by the edit)", sandbox: "idxvi454qwce4z27lkz0s", created: "2026-11-05T12:04:17Z", visits: ["2026-11-05T12:05:21Z", "2026-11-05T12:10:02Z"], shutdown: "2026-11-05T12:19:53Z", end: "2026-11-05T12:19:53Z", seconds: 936, credits: 5, today: 15 },
    { name: "Kesari Threads, second sandbox", sandbox: "iggnf9qev4sxcy784z21p", created: "2026-11-05T12:17:41Z", visits: ["2026-11-05T12:18:35Z", "2026-11-05T12:20:27Z", "2026-11-05T12:25:20Z"], shutdown: null, end: "2026-11-05T12:35:20Z", seconds: 1059, credits: 5, today: 15 },
    { name: "StudioMark", sandbox: "i82f31vou4u94ivy22dea", created: "2026-11-04T19:23:07Z", visits: ["2026-11-04T19:23:44Z", "2026-11-04T19:30:00Z", "2026-11-04T19:33:13Z"], shutdown: null, end: "2026-11-04T19:43:13Z", seconds: 1206, credits: 6, today: 15 },
  ];
  for (const replay of replays) {
    it(`${replay.name}: one session, charged ${replay.credits} credits for ${replay.seconds} s (today: ${replay.today})`, async () => {
      const owner = await customer(100);
      const projectId = await project(owner, replay.sandbox);
      const opened = await open(replay.sandbox, projectId, owner, replay.created);
      expect(Number(opened.held_credits)).toBe(3);
      for (const time of replay.visits) await visit(replay.sandbox, projectId, owner, time);
      if (replay.shutdown) await q("update public.platform_resources set state='terminated', terminated_at=$2 where provider_ref=$1", [replay.sandbox, at(replay.shutdown)]);
      expect(await settleDue(new Date(new Date(replay.end).getTime() + 120_000).toISOString())).toBe(1);
      const [session] = await sessions(replay.sandbox);
      expect(session.status).toBe("settled");
      expect(new Date(session.ended_at).toISOString()).toBe(at(replay.end));
      expect(session.runtime_seconds).toBe(replay.seconds);
      expect(Number(session.charged_credits)).toBe(replay.credits);
      expect(await charged(owner)).toEqual({ n: 1, total: replay.credits });
      const b = await balance(owner);
      expect(Number(b.reserved)).toBe(0);
      expect(Number(b.available)).toBe(100 - replay.credits);
    });
  }
});

describe("session rules", () => {
  it("a reopen across a clock boundary within the held time costs nothing more", async () => {
    const owner = await customer(100);
    const sandbox = "sbx-boundary";
    const projectId = await project(owner, sandbox);
    await open(sandbox, projectId, owner, "2026-11-05T14:52:00Z");
    const first = await visit(sandbox, projectId, owner, "2026-11-05T14:59:59Z");
    const second = await visit(sandbox, projectId, owner, "2026-11-05T15:00:01Z");
    expect(second.held).toBe(first.held);
    expect(second.covered_until).toBe(first.covered_until);
    const [s] = await sessions(sandbox);
    expect(s.top_ups).toBe(1);
  });

  it("a visit after a pause starts a new segment; each is charged once for its own time", async () => {
    const owner = await customer(100);
    const sandbox = "sbx-pause";
    const projectId = await project(owner, sandbox);
    await open(sandbox, projectId, owner, "2026-11-05T10:00:00Z");
    await visit(sandbox, projectId, owner, "2026-11-05T10:01:00Z");
    // Paused at 10:11:00 (last visit + 600 s); the customer returns at 11:00.
    const resumed = await visit(sandbox, projectId, owner, "2026-11-05T11:00:00Z");
    expect(resumed.resumed).toBe(true);
    expect(resumed.segment).toBe(2);
    await settleDue("2026-11-05T12:00:00Z");
    const rows = await sessions(sandbox);
    expect(rows.map((r) => [r.segment, r.status, r.runtime_seconds])).toEqual([[1, "settled", 660], [2, "settled", 600]]);
    expect(await charged(owner)).toEqual({ n: 2, total: 3 + 3 });
  });

  it("duplicate visits and duplicate settlement never double-charge", async () => {
    const owner = await customer(100);
    const sandbox = "sbx-dupe";
    const projectId = await project(owner, sandbox);
    await open(sandbox, projectId, owner, "2026-11-05T09:00:00Z");
    const a = await visit(sandbox, projectId, owner, "2026-11-05T09:09:00Z");
    const b = await visit(sandbox, projectId, owner, "2026-11-05T09:09:00Z");
    expect(b).toEqual(a);
    expect((await open(sandbox, projectId, owner, "2026-11-05T09:09:30Z")).id).toBe(a.session);
    const [s] = await sessions(sandbox);
    await q("select public.settle_sandbox_session($1,$2,'visit_log')", [s.id, at("2026-11-05T09:19:00Z")]);
    await q("select public.settle_sandbox_session($1,$2,'visit_log')", [s.id, at("2026-11-05T09:25:00Z")]);
    expect(await charged(owner)).toEqual({ n: 1, total: 5 });
  });

  it("a shorter terminal timeout never shortens the recorded runtime", async () => {
    const owner = await customer(100);
    const sandbox = "sbx-terminal";
    const projectId = await project(owner, sandbox);
    await open(sandbox, projectId, owner, "2026-11-05T05:00:00Z");
    await visit(sandbox, projectId, owner, "2026-11-05T05:02:00Z");
    await visit(sandbox, projectId, owner, "2026-11-05T05:03:00Z", 60);
    await settleDue("2026-11-05T06:00:00Z");
    const [s] = await sessions(sandbox);
    expect(new Date(s.ended_at).toISOString()).toBe(at("2026-11-05T05:12:00Z"));
  });

  it("a visit is refused, and runtime not extended, when the account cannot hold the extension", async () => {
    const owner = await customer(4);
    const sandbox = "sbx-short";
    const projectId = await project(owner, sandbox);
    const opened = await open(sandbox, projectId, owner, "2026-11-05T08:00:00Z");
    expect(await outcome(visit(sandbox, projectId, owner, "2026-11-05T08:05:00Z"))).toMatch(/INSUFFICIENT_CREDITS/);
    const [s] = await sessions(sandbox);
    expect(s.covered_until).toEqual(opened.covered_until);
    expect(new Date(s.last_access_at).toISOString()).toBe(at("2026-11-05T08:00:00Z"));
  });

  it("missing runtime evidence is charged as a labelled estimate and reconciled later with a refund only", async () => {
    const owner = await customer(100);
    const sandbox = "sbx-estimate";
    const projectId = await project(owner, sandbox);
    const opened = await open(sandbox, projectId, owner, "2026-11-05T07:00:00Z");
    await visit(sandbox, projectId, owner, "2026-11-05T07:08:00Z");
    const [s] = await sessions(sandbox);
    const est = (await q("select (public.settle_sandbox_session($1,null,'none','no visit or provider record')).*", [s.id]))[0];
    expect(est.status).toBe("estimated");
    // Charged up to NYNZ's visit record (last visit + 600 s = 18 min), never the whole hold.
    expect(Number(est.runtime_seconds)).toBe(1080);
    expect(Number(est.charged_credits)).toBe(5);
    expect(Number(est.charged_credits)).toBeLessThan(Number(s.held_credits));
    const ledger = (await q("select cost_source, metadata from public.credit_ledger where event_key=$1", [`session:${s.id}`]))[0];
    expect(ledger.cost_source).toBe("runtime_estimate");
    expect(ledger.metadata.estimate).toBe(true);
    // Evidence arrives: the provider paused it at 07:12 (720 s, 4 credits).
    const rec = (await q("select (public.reconcile_sandbox_session($1,$2,'provider')).*", [s.id, at("2026-11-05T07:12:00Z")]))[0];
    expect(rec.status).toBe("reconciled");
    expect(Number(rec.refunded_credits)).toBe(1);
    await q("select public.reconcile_sandbox_session($1,$2,'provider')", [s.id, at("2026-11-05T07:12:00Z")]);
    const refunds = await q("select amount from public.credit_ledger where user_id=$1 and entry_type='grant' and reason='Preview time correction'", [owner]);
    expect(refunds.length).toBe(1);
    expect(opened.started_at).toBeTruthy();
  });

  it("a preview hold never blocks the customer's next build", async () => {
    const owner = await customer(100);
    const sandbox = "sbx-concurrency";
    const projectId = await project(owner, sandbox);
    await open(sandbox, projectId, owner, "2026-11-05T06:00:00Z");
    expect(await outcome(q("select public.reserve_credits($1,$2,gen_random_uuid(),5,1)", [owner, projectId]))).toBe("OK");
  });
});

describe("trial budget", () => {
  it("a trial account stops at the trial budget while paid accounts keep the rest of the platform cap", async () => {
    await q("update public.spend_limits set limit_paise=30000 where scope='trial'");
    const trial = await customer(60, "trial");
    const paid = await customer(500, "plan_included");
    expect((await q("select public.account_is_trial($1) t", [trial]))[0].t).toBe(true);
    expect((await q("select public.account_is_trial($1) t", [paid]))[0].t).toBe(false);
    // Trial accounts have spent ₹299 today.
    await q("select public.authorize_provider_spend('openrouter','model','m',29900,null,$1,'trial-load')", [trial]);
    expect((await q("select public.trial_budget_open($1) o", [trial]))[0].o).toBe(true);
    expect(await outcome(q("select public.authorize_provider_spend('openrouter','model','m',200,null,$1,'trial-over')", [trial]))).toMatch(/TRIAL_BUDGET/);
    // A paid account is unaffected by the trial budget: everything left under the ₹1,000 cap stays available to it
    // (at least ₹700 whenever trials are capped at ₹300).
    const [{ spent }] = await q<{ spent: number }>("select coalesce(sum(coalesce(actual_paise, estimated_paise)),0)::int spent from public.provider_spend where status <> 'voided' and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'");
    const [{ trialSpent }] = await q<{ trialSpent: number }>("select coalesce(sum(coalesce(actual_paise, estimated_paise)),0)::int \"trialSpent\" from public.provider_spend where status <> 'voided' and trial and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'");
    expect(100000 - trialSpent).toBeGreaterThanOrEqual(70000);
    expect(await outcome(q("select public.authorize_provider_spend('openrouter','model','m',$2,null,$1,'paid-load')", [paid, 100000 - spent]))).toBe("OK");
    expect(await outcome(q("select public.authorize_provider_spend('openrouter','model','m',2000,null,$1,'paid-over')", [paid]))).toMatch(/SPEND_LIMIT/);
    await q("select public.authorize_provider_spend('openrouter','model','m',1,null,$1,'trial-edge')", [trial]).catch(() => undefined);
    await q("update public.provider_spend set status='voided' where event_key in ('trial-load','paid-load')");
  });

  it("buying credits or a plan ends trial status", async () => {
    const user = await customer(60, "trial");
    await q("select public.grant_credits($1,'purchased',100,null,'Top-up',null,gen_random_uuid()::text)", [user]);
    expect((await q("select public.account_is_trial($1) t", [user]))[0].t).toBe(false);
  });
});
