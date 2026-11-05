/**
 * Release rehearsal for 20261106100000_preview_sessions_and_trial.sql (0.5.0)
 * on data shaped like production, as inventoried read-only on 2026-11-05
 * (scripts/ops/preview-billing-inventory.ts): 11 live previews, each with a
 * build-sandbox charge; clock-window preview charges in earlier windows and,
 * to cover a deploy right after a preview was opened, two in the current
 * window; an owner-testing grant; three 25-credit trial grants
 * ("trial:<user>", promotional) partly used; other promotional grants; the
 * ₹1,000 daily platform cap and an inactive verification limit. Production
 * had no active holds; an in-progress build hold and a stale finished-build
 * hold are added so the deploy is rehearsed with holds present. Every credit
 * row is written through the real (pre-migration) functions.
 *
 * Used by tests/db/preview-sessions-upgrade.test.ts (in-process Postgres)
 * and scripts/rehearse-preview-billing.sh (disposable PostgreSQL 17).
 */
import { readFileSync } from "node:fs";

export type Exec = (sql: string, params?: unknown[]) => Promise<Array<Record<string, any>>>;
export const UNTIL = "20261105100000_resumable_builds.sql";
export const MIGRATION = "20261106100000_preview_sessions_and_trial.sql";
export const ROLLBACK = "supabase/rollback/20261106100000_preview_sessions_down.sql";

const id = (prefix: number, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { owner: id(3, 1), t1: id(3, 2), t2: id(3, 3), t3: id(3, 4), promo: id(3, 5) };
const USERS = Object.values(U);
const PPS = 0.000046 * 95 * 100, PPC = 100;
const credits = (seconds: number) => Math.max(0, Math.ceil((seconds * PPS) / PPC));
type Live = { sandbox: string; project: string; owner: string; windowsAgo: number | null; createdMinutesAgo: number };
export const LIVE: Live[] = [];

export async function seed(exec: Exec) {
  for (const [email, user] of Object.entries(U)) await exec("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [user, `${email}@rehearsal.test`]);
  await exec("select public.grant_credits($1,'owner_testing',500,null,'Owner testing',null,'rh5:owner')", [U.owner]);
  await exec("select public.grant_credits($1,'promotional',40,now()+interval '20 days','Promo',null,'rh5:owner-promo')", [U.owner]);
  for (const user of [U.t1, U.t2, U.t3]) await exec("select public.grant_credits($1,'promotional',25,now()+interval '5 days','Welcome trial credits',null,$2)", [user, `trial:${user}`]);
  for (let i = 0; i < 6; i += 1) await exec("select public.grant_credits($1,'promotional',10,now()+interval '30 days','Promo',null,$2)", [U.promo, `rh5:promo-${i}`]);
  await exec("insert into public.spend_limits(name,provider,period,limit_paise,active) values('Platform daily provider spend',null,'day',100000,true)");
  await exec("insert into public.spend_limits(name,provider,period,limit_paise,active,window_start,window_end) values('Release verification ₹50 (all providers)',null,'window',5000,false,now()-interval '2 days',now()-interval '1 day')");

  // 11 live previews: owner 5, trials 2 + 2 + 1, promo-only 1.
  const owners = [U.owner, U.owner, U.owner, U.owner, U.owner, U.t1, U.t1, U.t2, U.t2, U.t3, U.promo];
  // Windows ago of the latest clock-window charge (null: none yet). Two in the current window.
  const windows: Array<number | null> = [0, 12, 12, 30, null, 0, 14, 13, null, 20, 25];
  for (let n = 0; n < 11; n += 1) {
    const owner = owners[n], project = id(4, n + 1), sandbox = `rh5sbx${String(n).padStart(4, "0")}`, build = id(5, n + 1);
    const createdMinutesAgo = n === 4 ? 3 : 240 + n * 10; // one preview built 3 minutes ago, still in its first 10 minutes
    await exec("insert into public.projects(id,owner_id,name,status) values($1,$2,$3,'ready')", [project, owner, `Rehearsal preview ${n}`]);
    await exec("insert into public.build_jobs(id,project_id,requested_by,prompt,mode,idempotency_key,status,created_at,finished_at) values($1,$2,$3,'Build','create',$4,'succeeded',now()-make_interval(mins=>$5),now()-make_interval(mins=>$5))", [build, project, owner, `rh5-${build}`, createdMinutesAgo]);
    await exec("select public.register_sandbox($1,$2,$3,'preview')", [sandbox, project, build]);
    await exec("update public.platform_resources set state='active', created_at=now()-make_interval(mins=>$2) where provider_ref=$1", [sandbox, createdMinutesAgo]);
    await exec("update public.projects set active_sandbox_id=$1 where id=$2", [sandbox, project]);
    // The 0.4.2 worker's build-sandbox charge: 3 credits for the first 600 s.
    await exec("select public.reserve_credits($1,$2,$3,5,10)", [owner, project, build]);
    await exec("select public.consume_credits($1,3,$2,'e2b',null,262,'allocated_runtime_estimate',$3::jsonb)", [build, `e2b:${sandbox}:build`, JSON.stringify({ seconds: 300, allocated_seconds: 600, outcome: "succeeded", provisional: true, step: "Preview environment (build and checks)" })]);
    await exec("select public.settle_reservation($1,'succeeded')", [build]);
    // The 0.3.10 preview host's clock-window charge, through the real pre-migration function.
    if (windows[n] !== null) {
      await exec("select public.authorize_sandbox_runtime($1,$2,$3,600,525,6)", [project, owner, sandbox]);
      if (windows[n]! > 0) {
        // Backdate the charge to an earlier window (seed only: the ledger is append-only by trigger).
        const shift = windows[n]! * 600;
        await exec("set session_replication_role = replica");
        for (const table of ["credit_ledger", "provider_spend"]) {
          await exec(`update public.${table} set event_key = 'runtime:' || $1 || ':600:' || (split_part(event_key, ':', 4)::bigint - $2)::text, created_at = created_at - make_interval(secs => $3) where event_key like 'runtime:' || $1 || ':%'`, [sandbox, windows[n], shift]);
        }
        await exec("set session_replication_role = origin");
      }
    }
    LIVE.push({ sandbox, project, owner, windowsAgo: windows[n], createdMinutesAgo });
  }
  // Holds present at deploy time: a build in progress, and a finished build whose hold was never released.
  await exec("insert into public.build_jobs(id,project_id,requested_by,prompt,mode,idempotency_key,status,created_at,started_at) values($1,$2,$3,'Edit','edit','rh5-running','generating',now()-interval '4 minutes',now()-interval '4 minutes')", [id(6, 1), id(4, 1), U.owner]);
  await exec("select public.reserve_credits($1,$2,$3,20,10)", [U.owner, id(4, 1), id(6, 1)]);
  await exec("select public.consume_credits($1,4,'openrouter:rh5-running','openrouter','m',350,'provider_reported','{}')", [id(6, 1)]);
  await exec("insert into public.build_jobs(id,project_id,requested_by,prompt,mode,idempotency_key,status,created_at,finished_at) values($1,$2,$3,'Edit','edit','rh5-stale','succeeded',now()-interval '1 hour',now()-interval '50 minutes')", [id(6, 2), id(4, 2), U.owner]);
  await exec("select public.reserve_credits($1,$2,$3,5,10)", [U.owner, id(4, 2), id(6, 2)]);
}

export async function snapshot(exec: Exec) {
  const balances: Record<string, unknown> = {};
  for (const user of USERS) balances[user] = (await exec("select public.credit_balance($1) b", [user]))[0].b;
  return {
    balances,
    grants: await exec("select id, user_id, source, amount, remaining, expires_at, idempotency_key from public.credit_grants order by id"),
    reservations: await exec("select id, user_id, build_id, amount, consumed, status from public.credit_reservations order by id"),
    ledger: Number((await exec("select count(*) n from public.credit_ledger"))[0].n),
    spend: await exec("select id, name, period, limit_paise, active from public.spend_limits order by id"),
  };
}

type Result = { name: string; ok: boolean; detail?: string };
const strip = (rows: Array<Record<string, any>>) => JSON.stringify(rows.map((r) => ({ ...r, expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null })));

/** Straight after the migration, before any new code runs. */
export async function verify(exec: Exec, before: Awaited<ReturnType<typeof snapshot>>): Promise<Result[]> {
  const after = await snapshot(exec);
  const r: Result[] = [];
  r.push({ name: "every balance is unchanged", ok: JSON.stringify(after.balances) === JSON.stringify(before.balances) });
  r.push({ name: "every grant keeps its amount, remaining credits, source and expiry date", ok: strip(after.grants) === strip(before.grants), detail: `${after.grants.length} grants` });
  r.push({ name: "existing holds are unchanged and are build holds", ok: JSON.stringify(after.reservations) === JSON.stringify(before.reservations) && Number((await exec("select count(*) n from public.credit_reservations where kind <> 'build'"))[0].n) === 0, detail: `${after.reservations.filter((x) => x.status === "active").length} active` });
  r.push({ name: "the migration writes no ledger rows", ok: after.ledger === before.ledger });
  const limits = await exec("select name, period, limit_paise, active, scope from public.spend_limits order by id");
  r.push({ name: "the platform cap is unchanged and one ₹300/day trial limit is added", ok: limits.filter((l) => l.scope === "all").map((l) => `${l.name}|${l.limit_paise}|${l.active}`).join() === before.spend.map((l) => `${l.name}|${l.limit_paise}|${l.active}`).join() && limits.filter((l) => l.scope === "trial").length === 1 && limits.find((l) => l.scope === "trial")!.limit_paise == 30000 });
  const trial = async (user: string) => (await exec("select public.account_is_trial($1) t", [user]))[0].t;
  r.push({ name: "the three 25-credit trial accounts count as trial accounts; owner and promo-only accounts do not", ok: (await trial(U.t1)) && (await trial(U.t2)) && (await trial(U.t3)) && !(await trial(U.owner)) && !(await trial(U.promo)) });
  for (const user of [U.t1, U.t2, U.t3]) await exec("select public.grant_credits($1,'trial',60,now()+interval '7 days','Welcome trial credits',null,$2)", [user, `trial:${user}`]);
  const regrant = await exec("select amount, remaining, expires_at, source from public.credit_grants where idempotency_key like 'trial:%' order by id");
  const was = before.grants.filter((g) => String(g.idempotency_key).startsWith("trial:"));
  r.push({ name: "a 60-credit trial grant for an existing 25-credit account is a no-op (same balance and expiry)", ok: strip(regrant) === strip(was.map(({ amount, remaining, expires_at, source }) => ({ amount, remaining, expires_at, source }))), detail: was.map((g) => `${g.remaining}/${g.amount}`).join(", ") });
  // Every live preview is covered by time paid under the previous billing until a visit places a hold.
  let covered = 0;
  const lines: string[] = [];
  for (const live of LIVE) {
    const row = (await exec(`select private.legacy_paid_until($1) paid,
      greatest((select max(created_at) from public.credit_ledger where event_key like 'runtime:' || $1 || ':%'), (select created_at from public.platform_resources where provider_ref = $1)) + interval '600 seconds' latest_end`, [live.sandbox]))[0];
    if (new Date(row.paid).getTime() >= new Date(row.latest_end).getTime() - 1000) covered += 1;
    else lines.push(live.sandbox);
  }
  r.push({ name: "every live preview's latest possible end is within time it already paid for", ok: covered === LIVE.length, detail: `${covered}/${LIVE.length}${lines.length ? `; not: ${lines.join(",")}` : ""}` });
  return r;
}

/** The rollout overlap, then settlement, then rollback. */
export async function exercise(exec: Exec): Promise<Result[]> {
  const r: Result[] = [];
  const consumes = async () => Number((await exec("select count(*) n from public.credit_ledger where entry_type='consume'"))[0].n);
  const windowRows = async () => Number((await exec("select count(*) n from public.credit_ledger where event_key like 'runtime:%'"))[0].n);
  const c0 = await consumes(), w0 = await windowRows();

  // Old preview host (0.3.10) still serving right after the migration: every live preview is visited.
  for (const live of LIVE) await exec("select public.authorize_sandbox_runtime($1,$2,$3,600,525,6)", [live.project, live.owner, live.sandbox]);
  const opened = await exec("select s.*, extract(epoch from s.started_at - s.last_access_at) delay from public.sandbox_sessions s order by sandbox_id");
  const underHeld = opened.filter((s) => Number(s.held_credits) < credits((new Date(s.covered_until).getTime() - new Date(s.started_at).getTime()) / 1000));
  r.push({ name: "old host after the switchover: each live preview gets one held session and no clock-window charge", ok: opened.length === LIVE.length && underHeld.length === 0 && (await consumes()) === c0 && (await windowRows()) === w0, detail: `${opened.length} sessions, ${opened.reduce((s, x) => s + Number(x.held_credits), 0)} credits held` });
  const current = LIVE.filter((l) => l.windowsAgo === 0).map((l) => opened.find((s) => s.sandbox_id === l.sandbox)!);
  r.push({ name: "previews charged in the current window start metering only after their paid windows", ok: current.every((s) => Number(s.delay) >= 600), detail: current.map((s) => `${Math.round(Number(s.delay))} s`).join(", ") });
  const fresh = opened.find((s) => s.sandbox_id === LIVE[4].sandbox)!;
  r.push({ name: "a preview built 3 minutes before the switchover starts metering after its paid first 600 s", ok: Math.abs(Number(fresh.delay) - (600 - 180)) <= 5, detail: `${Math.round(Number(fresh.delay))} s` });

  // Old worker (0.4.2) during the overlap: a new build for a customer with a preview hold.
  const ow = { project: id(4, 8), build: id(7, 1), sandbox: "rh5sbx-oldworker" };
  await exec("insert into public.build_jobs(id,project_id,requested_by,prompt,mode,idempotency_key,status) values($1,$2,$3,'Edit','edit','rh5-old-worker','generating')", [ow.build, ow.project, U.t2]);
  const admitted = await exec("select public.reserve_credits($1,$2,$3,5,1) id", [U.t2, ow.project, ow.build]).then(() => true, () => false);
  r.push({ name: "old worker: a trial customer with an open preview hold can still start a build (one build at a time)", ok: admitted });
  await exec("select public.register_sandbox($1,$2,$3,'preview')", [ow.sandbox, ow.project, ow.build]);
  await exec("update public.platform_resources set state='active' where provider_ref=$1", [ow.sandbox]);
  await exec("select public.consume_credits($1,3,$2,'e2b',null,262,'allocated_runtime_estimate',$3::jsonb)", [ow.build, `e2b:${ow.sandbox}:build`, JSON.stringify({ allocated_seconds: 600 })]);
  await exec("update public.build_jobs set status='succeeded', finished_at=now() where id=$1", [ow.build]);
  await exec("select public.settle_reservation($1,'succeeded')", [ow.build]);
  await exec("update public.projects set active_sandbox_id=$1 where id=$2", [ow.sandbox, ow.project]);
  await exec("select public.extend_sandbox_session($1,$2,$3,600,$4,100)", [ow.project, U.t2, ow.sandbox, PPS]);
  const owSession = (await exec("select extract(epoch from started_at - last_access_at) delay from public.sandbox_sessions where sandbox_id=$1", [ow.sandbox]))[0];
  r.push({ name: "old worker's new preview: its 3-credit build charge covers the first 600 s, then a new-host visit meters after that", ok: Math.abs(Number(owSession.delay) - 600) <= 5 });

  // New worker: opens a session with the sandbox; maintenance from either worker keeps preview holds.
  const nw = { project: id(4, 11), sandbox: "rh5sbx-newworker" };
  await exec("select public.register_sandbox($1,$2,null,'preview')", [nw.sandbox, nw.project]);
  await exec("select public.open_sandbox_session($1,$2,$3,null,600,$4,100)", [nw.sandbox, nw.project, U.promo, PPS]);
  await exec("update public.credit_reservations set created_at = now() - interval '20 minutes' where kind = 'runtime'");
  await exec("select public.reconcile_credits()");
  const holds = await exec("select r.kind, r.status, r.build_id, s.status session from public.credit_reservations r left join public.sandbox_sessions s on s.id = r.build_id where r.status = 'active' or r.build_id = $1", [id(6, 2)]);
  r.push({ name: "maintenance keeps every open preview hold and the running build's hold, and releases the stale finished-build hold", ok: holds.filter((h) => h.kind === "runtime").every((h) => h.status === "active" && h.session === "open") && holds.some((h) => h.build_id === id(6, 1) && h.status === "active") && holds.find((h) => h.build_id === id(6, 2))?.status !== "active",
    detail: `${holds.filter((h) => h.kind === "runtime" && h.status === "active").length} preview holds kept` });

  // Settlement once each sandbox has paused, then repeated (a retry) with a later end.
  const open = await exec("select id, runs_until from public.sandbox_sessions where status = 'open'");
  for (const s of open) await exec("select public.settle_sandbox_session($1,$2,'provider_pause')", [s.id, s.runs_until]);
  for (const s of open) await exec("select public.settle_sandbox_session($1,now()+interval '1 day','retry')", [s.id]);
  const settled = await exec("select s.sandbox_id, s.charged_credits, s.held_credits, s.runtime_seconds, (select count(*) from public.credit_ledger l where l.event_key = 'session:' || s.id) n from public.sandbox_sessions s");
  r.push({ name: "each session is charged once, never above its hold; the retry changes nothing", ok: settled.every((s) => Number(s.n) <= 1 && Number(s.charged_credits) <= Number(s.held_credits)) && Number((await exec("select count(*) n from public.credit_reservations where kind='runtime' and status='active'"))[0].n) === 0,
    detail: `${settled.reduce((a, s) => a + Number(s.charged_credits), 0)} credits for ${settled.reduce((a, s) => a + Number(s.runtime_seconds), 0)} s across ${settled.length} sessions` });
  const doubled = settled.filter((s) => LIVE.find((l) => l.sandbox === s.sandbox_id && l.windowsAgo === 0) && Number(s.charged_credits) > 0);
  r.push({ name: "no runtime paid under the previous billing is charged again", ok: doubled.length === 0 });
  r.push({ name: "credits add up for every account (available + held + used = granted)", ok: await balanced(exec) });

  // Rollback to 0.4.2.
  for (const live of LIVE.slice(0, 3)) await exec("select public.authorize_sandbox_runtime($1,$2,$3,600,525,6)", [live.project, live.owner, live.sandbox]);
  const sql = readFileSync(ROLLBACK, "utf8").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  await exec(sql);
  const after = await exec("select count(*) filter (where status='open') open from public.sandbox_sessions");
  const w1 = await windowRows();
  await exec("select public.authorize_sandbox_runtime($1,$2,$3,600,525,6)", [LIVE[1].project, LIVE[1].owner, LIVE[1].sandbox]);
  const trialLimit = (await exec("select active from public.spend_limits where scope='trial'"))[0].active;
  r.push({ name: "rollback: open sessions settled, the old clock-window charge is back, the trial limit is off", ok: Number(after[0].open) === 0 && (await windowRows()) === w1 + 1 && trialLimit === false && Number((await exec("select count(*) n from public.credit_reservations where kind='runtime' and status='active'"))[0].n) === 0 });
  r.push({ name: "credits still add up after the rollback", ok: await balanced(exec) });
  return r;
}

async function balanced(exec: Exec) {
  for (const user of USERS) {
    const b = (await exec("select public.credit_balance($1) b", [user]))[0].b;
    const granted = Number((await exec("select coalesce(sum(amount),0) s from public.credit_grants where user_id=$1", [user]))[0].s);
    if (Number(b.available) + Number(b.reserved) + Number(b.used) !== granted) return false;
  }
  return true;
}
