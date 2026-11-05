/**
 * Preview billing through the real preview host code. Each "instance" is a
 * fresh import of preview-host/api/proxy.ts (its own 30-second connect cache,
 * like a separate Vercel instance) serving signed preview requests for
 * per-project hosts. The database is a local Supabase stack with every
 * migration; E2B is a stateful fake (fake-e2b.ts) that records exactly when
 * each sandbox ran. Elapsed time is simulated by moving every stored time
 * (database and fake) into the past. Settlement runs the worker's real
 * settleSandboxSessions and reconcileResources. Nothing leaves this machine.
 *
 *   npx tsx tests/e2e/preview-host/run.ts <supabase-workdir>
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { FakeE2B } from "./fake-e2b";

const workdir = process.argv[2];
const local = Object.fromEntries(execFileSync("supabase", ["status", "-o", "env", "--workdir", workdir], { encoding: "utf8" }).split("\n").filter((line) => line.includes("=")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, "")]; }));
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(local.API_URL) || !/@127\.0\.0\.1:\d+\//.test(local.DB_URL)) throw new Error("Refusing to run: Supabase is not local");

for (const name of ["E2B_COST_USD_PER_SECOND", "USD_TO_INR_RATE", "PAISE_PER_CREDIT", "E2B_PREVIEW_ACTIVE_SECONDS", "PREVIEW_VERCEL_PROJECT_ID", "VERCEL_TOKEN", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]) delete process.env[name];
Object.assign(process.env, {
  SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_URL: local.API_URL, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
  E2B_API_KEY: "fake-e2b-key", PREVIEW_SIGNING_SECRET: "local-preview-host-test-0123456789abcdef0123", NYNZ_APP_ORIGIN: "https://www.nynz.in",
  TRIAL_CREDITS: "60", TRIAL_DAYS: "7",
});

const fake = new FakeE2B();
fake.install();
const { issuePreviewToken } = await import("../../../preview-host/lib/token");
const { runtimeAdmissionArgs } = await import("../../../preview-host/lib/runtime");
const { settleSandboxSessions, reconcileEstimatedSessions, e2bSandboxInfo } = await import("../../../lib/billing/sessions");
const { reconcileResources } = await import("../../../lib/platform/reconcile");
const { sandboxPaisePerSecond, paisePerCredit } = await import("../../../lib/billing/pricing");
const { BuildMeter } = await import("../../../lib/billing/meter");
const { admitPaidWork } = await import("../../../lib/billing/entitlements");

const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: local.DB_URL });
await db.connect();
const sql = async <T = any>(text: string, params: unknown[] = []) => (await db.query(text, params)).rows as T[];
const one = async <T = any>(text: string, params: unknown[] = []) => (await sql<T>(text, params))[0];

const PPS = sandboxPaisePerSecond(), PPC = paisePerCredit();
const credits = (seconds: number) => Math.max(0, Math.ceil((seconds * PPS) / PPC));
const results: Array<{ ok: boolean; line: string }> = [];
const check = (name: string, ok: boolean, detail = "") => { const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`; results.push({ ok, line }); console.log(line); };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ledgerRows: string[] = [];

// ---------------------------------------------------------------------------
// The preview host, as deployed: one module instance per simulated Vercel instance.
let instances = 0;
const proxyUrl = pathToFileURL(path.resolve("preview-host/api/proxy.ts")).href;
async function instance() { return (await import(`${proxyUrl}?instance=${++instances}`)).default as (req: any, res: any) => Promise<void>; }

type Res = { statusCode: number; headers: Record<string, string>; body: string };
async function request(handler: Awaited<ReturnType<typeof instance>>, project: string, user: string, opts: { path?: string; query?: Record<string, string>; cookie?: string } = {}): Promise<Res> {
  const host = `${project}.preview.nynz.in`;
  const cookie = opts.cookie ?? `__Host-nynz_preview=${encodeURIComponent(issuePreviewToken({ typ: "s", projectId: project, userId: user, aud: host }).token)}`;
  const req = Object.assign(Readable.from([]), { method: "GET", headers: { host, cookie, accept: "text/html" }, query: { path: (opts.path || "/").replace(/^\//, ""), ...(opts.query || {}) } });
  const res: Res & { status: (c: number) => any; setHeader: (k: string, v: string) => any; send: (b: unknown) => any } = {
    statusCode: 0, headers: {}, body: "",
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); return this; },
    send(b) { this.body = typeof b === "string" ? b : Buffer.isBuffer(b) ? b.toString("utf8") : String(b ?? ""); return this; },
  };
  await handler(req, res);
  return res;
}
const visit = async (project: string, user: string) => request(await instance(), project, user);

// ---------------------------------------------------------------------------
// Fixtures.
async function customer(label: string, amount: number, source = "promotional") {
  const { data, error } = await admin.auth.admin.createUser({ email: `${label}-${randomUUID().slice(0, 8)}@example.com`, password: "local-only-password-1", email_confirm: true });
  if (error) throw error;
  const user = data.user.id;
  if (amount > 0) await sql("select public.grant_credits($1,$2,$3,now()+interval '7 days','fixture',null,$4)", [user, source, amount, `${source}:${user}`]);
  return user;
}
async function project(user: string) { return (await one("insert into public.projects(owner_id,name) values($1,'Preview fixture') returning id", [user])).id as string; }
async function sandbox(projectId: string, user: string, opts: { worker?: boolean; createdSecondsAgo?: number } = {}) {
  const id = `sbx${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await sql("select public.register_sandbox($1,$2,null,'preview')", [id, projectId]);
  await sql("update public.platform_resources set state='active', created_at=now()-make_interval(secs=>$2) where provider_ref=$1", [id, opts.createdSecondsAgo ?? 0]);
  await sql("update public.projects set active_sandbox_id=$1, status='ready' where id=$2", [id, projectId]);
  fake.create(id, 600, opts.createdSecondsAgo ?? 0);
  if (opts.worker !== false) {
    // Exactly what the worker does when a build creates the sandbox.
    const opened = await admin.rpc("open_sandbox_session", { p_sandbox: id, p_project: projectId, p_user: user, p_build: null, p_timeout: 600, p_pps: PPS, p_ppc: PPC });
    if (opened.error) throw opened.error;
  }
  return id;
}
const available = async (user: string) => Number(((await admin.rpc("credit_balance", { p_user: user })).data as { available: number }).available);
const sessions = (sb: string) => sql("select * from public.sandbox_sessions where sandbox_id=$1 order by segment", [sb]);
const connects = (sb: string) => fake.calls.filter((c) => c.startsWith(`connect ${sb} `)).length;
const consumes = (user: string) => sql("select event_key, amount, cost_source, metadata from public.credit_ledger where user_id=$1 and entry_type='consume' order by id", [user]);

/** As if `seconds` had passed: every stored time moves into the past. */
async function advance(seconds: number) {
  fake.shift(seconds);
  const s = `make_interval(secs => ${Number(seconds)})`;
  await sql(`update public.sandbox_sessions set started_at=started_at-${s}, last_access_at=last_access_at-${s}, runs_until=runs_until-${s}, covered_until=covered_until-${s}, ended_at=ended_at-${s}, created_at=created_at-${s}`);
  await sql(`update public.platform_resources set created_at=created_at-${s}, terminated_at=terminated_at-${s}, last_accessed_at=last_accessed_at-${s}, terminate_requested_at=terminate_requested_at-${s}`);
  await sql(`update public.credit_reservations set created_at=created_at-${s}`);
}
const unreachable = new Set<string>();
const sandboxInfo = (id: string) => unreachable.has(id) ? Promise.resolve({ state: "unknown" as const }) : e2bSandboxInfo(id, process.env.E2B_API_KEY);
const settle = () => settleSandboxSessions({ db: admin, sandboxInfo });

// ---------------------------------------------------------------------------
async function main() {
  // A recent worker heartbeat, so admission works as in production.
  await sql("insert into public.worker_heartbeats(worker_id,status,last_seen_at,capabilities) values('preview-host-test','idle',now(),'{\"generation\":true,\"sandbox\":true,\"preview_origin\":true}') on conflict (worker_id) do update set last_seen_at=now()");
  console.log(`Rate: ${PPS.toFixed(3)} paise per second (configured), ${PPC} paise per credit`);

  // 1. Open a preview -------------------------------------------------------
  const a = await customer("open", 100);
  const pa = await project(a);
  const sa = await sandbox(pa, a);
  check("1a worker holds the first 10 minutes when the build creates the sandbox", (await sessions(sa))[0]?.held_credits == credits(600), `${(await sessions(sa))[0]?.held_credits} credits held`);
  await advance(200); // build time
  const host = `${pa}.preview.nynz.in`;
  const exchangeToken = issuePreviewToken({ typ: "x", projectId: pa, userId: a, aud: host }).token;
  const hostA = await instance();
  const exchanged = await request(hostA, pa, a, { path: "/__nynz/exchange", query: { t: exchangeToken, next: "/" }, cookie: "" });
  const cookie = (exchanged.headers["set-cookie"] || "").split(";")[0];
  check("1b one-time link exchanged for a host-bound session cookie", exchanged.statusCode === 303 && cookie.startsWith("__Host-nynz_preview="), `${exchanged.statusCode}`);
  const before1 = (await sessions(sa))[0];
  const opened = await request(hostA, pa, a, { cookie });
  const after1 = (await sessions(sa))[0];
  check("1c preview opens through the host and is served by the sandbox", opened.statusCode === 200 && opened.body.includes(`Served by ${sa}`), `${opened.statusCode}`);
  check("1d hold topped up before the host extended runtime (one connect, timeout 600 s)", connects(sa) === 1 && fake.calls.includes(`connect ${sa} 600`) && Number(after1.held_credits) > Number(before1.held_credits),
    `held ${before1.held_credits} -> ${after1.held_credits}, covered to visit + 20 min`);
  const cached = await request(hostA, pa, a, { cookie });
  check("1e a repeat request within 30 s uses the instance's connect cache: no extension, no new hold", cached.statusCode === 200 && connects(sa) === 1 && (await sessions(sa))[0].top_ups === after1.top_ups);

  // 2. Reconnect across a clock boundary -------------------------------------
  let offset = (Date.now() / 1000) % 600;
  if (offset > 500 || offset < 5) { await wait((605 - offset) * 1000); offset = (Date.now() / 1000) % 600; }
  await advance(offset + 30);
  const lastVisit = new Date((await sessions(sa))[0].last_access_at).getTime() / 1000;
  const now2 = Date.now() / 1000;
  const crossed = Math.floor(lastVisit / 600) !== Math.floor(now2 / 600);
  const reconnect = await visit(pa, a);
  const s2 = await sessions(sa);
  check("2a reconnect after a 10-minute clock boundary keeps the same session (no new charge, no resume)", crossed && reconnect.statusCode === 200 && s2.length === 1 && s2[0].status === "open" && fake.boxes.get(sa)!.resumes === 0,
    `previous visit ${Math.round(now2 - lastVisit)} s earlier, in the previous clock window`);
  check("2b no clock-window charge exists for this sandbox", (await consumes(a)).length === 0);

  // 3. Pause and reopen ------------------------------------------------------
  await advance(700); // idle: the sandbox pauses at its timeout
  check("3a sandbox paused at the provider after its timeout", !fake.running(sa));
  const reopen = await visit(pa, a);
  const s3 = await sessions(sa);
  check("3b reopening resumes the sandbox and opens segment 2; segment 1 is charged its running time", reopen.statusCode === 200 && fake.boxes.get(sa)!.resumes === 1 && s3.length === 2 && s3[0].status === "settled" && s3[1].status === "open",
    `segment 1: ${s3[0].runtime_seconds} s (${s3[0].end_source}), ran ${Math.round(fake.boxes.get(sa)!.intervals[0][1] - fake.boxes.get(sa)!.intervals[0][0]) / 1000} s at the provider`);
  check("3c segment 1 seconds match the provider's running interval (within 2 s)", Math.abs(Number(s3[0].runtime_seconds) - (fake.boxes.get(sa)!.intervals[0][1] - fake.boxes.get(sa)!.intervals[0][0]) / 1000) <= 2);
  await advance(300);
  await visit(pa, a);
  await advance(100);

  // 4. Replace the sandbox after an edit -------------------------------------
  const sb = await sandbox(pa, a); // the edit build's new sandbox (worker opens its session)
  await sql("update public.projects set active_sandbox_id=$1 where id=$2", [sa, pa]); // still building: A stays active
  await advance(150);
  await sql("update public.projects set active_sandbox_id=$1 where id=$2", [sb, pa]); // complete_staged_build swap
  await sql("select public.request_resource_termination('e2b_sandbox',$1,'replaced')", [sa]);
  const connectsA = connects(sa);
  const replaced = await visit(pa, a);
  check("4a after the edit the host serves the new sandbox and never extends the replaced one", replaced.statusCode === 200 && replaced.body.includes(`Served by ${sb}`) && connects(sa) === connectsA);
  await reconcileResources({ db: admin, killSandbox: async (id: string) => { fake.kill(id); }, listSandboxes: async () => [], idleDays: 7 } as any);
  await advance(90); // the next maintenance pass, after the 60-second grace
  await settle();
  const s4 = await sessions(sa);
  const ranA = fake.ranSeconds(sa);
  check("4b the replaced sandbox's open segment is settled at its shutdown", s4[1].status === "settled" && s4[1].end_source === "shutdown", `segment 2: ${s4[1].runtime_seconds} s`);
  const billedA = s4.reduce((sum, row) => sum + Number(row.runtime_seconds), 0);
  check("4c billed seconds for the replaced sandbox equal the seconds it ran (within 2 s)", Math.abs(billedA - ranA) <= 2, `billed ${billedA} s, ran ${ranA.toFixed(0)} s`);
  await advance(700);
  await settle();
  const sB = await sessions(sb);
  check("4d the new sandbox is settled from the provider's pause time", sB.length === 1 && sB[0].status === "settled" && sB[0].end_source === "provider_pause" && Math.abs(Number(sB[0].runtime_seconds) - fake.ranSeconds(sb)) <= 2,
    `${sB[0].runtime_seconds} s billed, ${fake.ranSeconds(sb).toFixed(0)} s ran`);
  const rowsA = await consumes(a);
  const chargedA = rowsA.reduce((sum, row) => sum - Number(row.amount), 0);
  const expectA = [...s4, ...sB].reduce((sum, row) => sum + credits(Number(row.runtime_seconds)), 0);
  check("4e each segment charged once at its actual seconds; no clock-window or build-sandbox charge", rowsA.length === s4.length + sB.length && rowsA.every((row) => row.event_key.startsWith("session:")) && chargedA === expectA && (await available(a)) === 100 - chargedA,
    `${chargedA} credits for ${(ranA + fake.ranSeconds(sb)).toFixed(0)} s; balance ${await available(a)}`);
  check("4f measured charges are labelled as estimates at the configured rate", rowsA.every((row) => row.cost_source === "configured_rate_estimate" && row.metadata.cost_estimate === true && row.metadata.estimate === false));
  ledgerRows.push(...rowsA.map((row) => `${row.metadata.step}: ${row.metadata.seconds} s, ${-row.amount} credits, ${row.cost_source}, source ${row.metadata.source}`));

  // 5. A refused hold stops the host before it extends runtime -----------------
  const c = await customer("refused", credits(600));
  const pc = await project(c);
  const sc = await sandbox(pc, c);
  await advance(60);
  const runsBefore = (await sessions(sc))[0].runs_until.getTime();
  const refused = await visit(pc, c);
  check("5a no credits for the extension: the visit is refused with the credits page and the provider is never called", refused.statusCode === 503 && refused.body.includes("Not enough credits") && connects(sc) === 0 && (await sessions(sc))[0].runs_until.getTime() === runsBefore);
  const t = await customer("trial-refused", 0);
  await sql("select public.grant_credits($1,'trial',60,now()+interval '7 days','Welcome trial credits',null,$2)", [t, `trial:${t}`]);
  const pt = await project(t);
  const st = await sandbox(pt, t);
  await advance(60);
  const spent = Number((await one("select coalesce(sum(coalesce(actual_paise,estimated_paise)),0) s from public.provider_spend where trial and status<>'voided' and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'")).s);
  await sql("update public.spend_limits set limit_paise=$1 where scope='trial'", [spent]);
  const trialRefused = await visit(pt, t);
  check("5b trial allowance used up: the visit is refused with the trial page and the provider is never called", trialRefused.statusCode === 503 && trialRefused.body.includes("Free trial previews are paused") && connects(st) === 0);
  await sql("update public.spend_limits set limit_paise=30000 where scope='trial'");

  // 6. Retries and concurrent visits never charge the same runtime twice -------
  const d = await customer("concurrent", 100);
  const pd = await project(d);
  const sd = await sandbox(pd, d);
  await advance(100);
  const hosts = await Promise.all(Array.from({ length: 5 }, () => instance()));
  const burst = await Promise.all([
    ...hosts.flatMap((h) => Array.from({ length: 4 }, () => request(h, pd, d))),
    ...Array.from({ length: 5 }, () => admin.rpc("authorize_sandbox_runtime", runtimeAdmissionArgs(sd, pd, d, 600))), // the previous host, still deployed during rollout
  ]);
  const pages = burst.slice(0, 20) as Res[];
  const oldHost = burst.slice(20) as Array<{ error: unknown }>;
  const s6 = await sessions(sd);
  check("6a 20 concurrent visits on 5 instances plus 5 calls from the previous host: all served, one open segment, nothing charged yet", pages.every((p) => p.statusCode === 200) && oldHost.every((r) => !r.error) && s6.length === 1 && (await consumes(d)).length === 0,
    `${connects(sd)} connects, hold ${s6[0].held_credits} credits after ${s6[0].top_ups} top-ups`);
  check("6b the previous host's calls created no clock-window charge", Number((await one("select count(*) n from public.provider_spend where event_key like $1", [`runtime:${sd}:%`])).n) === 0);
  await advance(400); await visit(pd, d); await advance(400);
  const sweep = await admin.rpc("reconcile_credits");
  const hold = await one("select status from public.credit_reservations where build_id=$1", [s6[0].id]);
  check("6c a 15-minute-old preview hold survives the maintenance sweep while its session is open", !sweep.error && hold.status === "active");
  await advance(700);
  const race = await Promise.allSettled([settle(), settle(), settle(), visit(pd, d), admin.rpc("settle_sandbox_session", { p_session: s6[0].id, p_ended_at: new Date().toISOString(), p_source: "retry" })]);
  const s6b = await sessions(sd);
  const keyed = await sql("select event_key, count(*)::int n from public.credit_ledger where user_id=$1 and entry_type='consume' group by 1", [d]);
  check("6d three settlement runs, a duplicate settlement claiming a later end and a reopening visit at once: no errors, segment 1 charged exactly once", race.every((r) => r.status === "fulfilled" && !(r.value as any)?.error) && keyed.every((k) => k.n === 1) && keyed.length === 1 && s6b[0].status === "settled" && s6b.length === 2,
    `segment 1: ${s6b[0].runtime_seconds} s (${s6b[0].end_source}), ${s6b[0].charged_credits} credits; ran ${(fake.boxes.get(sd)!.intervals[0][1] - fake.boxes.get(sd)!.intervals[0][0]) / 1000} s`);
  check("6e segment 1 seconds match the provider's running interval (within 2 s)", Math.abs(Number(s6b[0].runtime_seconds) - (fake.boxes.get(sd)!.intervals[0][1] - fake.boxes.get(sd)!.intervals[0][0]) / 1000) <= 2);

  // 7. A visit that cannot reach the sandbox is not charged -------------------
  await advance(700); await settle();
  const balance7 = await available(d);
  fake.kill(sd); // deleted at the provider while paused (DB still lists it)
  const gone = await visit(pd, d);
  const s7 = await sessions(sd);
  check("7a sandbox gone at the provider: the visit fails and its new hold is released with no charge", gone.statusCode === 503 && s7.at(-1).status === "settled" && s7.at(-1).end_source === "connect_failed" && Number(s7.at(-1).charged_credits) === 0 && (await available(d)) === balance7);

  // 8. Switchover from the previous billing ---------------------------------
  // The previous preview host's charge, recreated exactly from 20261104101100 under another name.
  const oldSql = readFileSync("supabase/migrations/20261104101100_runtime_admission.sql", "utf8").match(/create or replace function public\.authorize_sandbox_runtime\([\s\S]*?\nend; \$\$;/)![0].replace("public.authorize_sandbox_runtime(", "public.legacy_authorize_sandbox_runtime_v034(");
  await sql(oldSql);
  const e = await customer("legacy", 100);
  const pe = await project(e);
  const se = await sandbox(pe, e, { worker: false, createdSecondsAgo: 3600 });
  await sql("select public.legacy_authorize_sandbox_runtime_v034($1,$2,$3,600,525,6)", [pe, e, se]); // charged by the old host before the migration
  const legacyCharged = 100 - await available(e);
  const firstVisit = await visit(pe, e);
  await advance(700); await settle();
  const s8 = await sessions(se);
  check("8a a preview paid under the previous billing is not charged again for the same 10-minute windows", firstVisit.statusCode === 200 && legacyCharged === 6 && 100 - await available(e) === 6 && Number(s8[0].charged_credits) === 0,
    `old charge 6 credits; new segment starts ${Math.round((s8[0].started_at.getTime() - s8[0].last_access_at.getTime()) / 1000)} s after the visit`);
  const f = await customer("legacy-build", 100);
  const pf = await project(f);
  const sf = await sandbox(pf, f, { worker: false, createdSecondsAgo: 200 });
  const buildId = randomUUID();
  await sql("select public.reserve_credits($1,$2,$3,10,99)", [f, pf, buildId]);
  await sql("select public.consume_credits($1,3,$2,'e2b',null,262,'allocated_runtime_estimate',$3::jsonb)", [buildId, `e2b:${sf}:build`, JSON.stringify({ allocated_seconds: 600, step: "Preview environment (build and checks)" })]);
  await sql("select public.settle_reservation($1,'build done')", [buildId]);
  await visit(pf, f);
  await advance(700); await settle();
  const s8b = await sessions(sf);
  const ranF = fake.ranSeconds(sf);
  check("8b a sandbox built by the previous worker is charged only after its 10 paid minutes", Number(s8b[0].runtime_seconds) <= Math.ceil(ranF - 600) + 2 && 100 - await available(f) === 3 + Number(s8b[0].charged_credits),
    `ran ${ranF.toFixed(0)} s: 3 credits (old build charge, 600 s) + ${s8b[0].charged_credits} credits for ${s8b[0].runtime_seconds} s`);

  // 9. Fallback charge when the provider has no record, then correction ------
  const g = await customer("estimate", 100);
  const pg_ = await project(g);
  const sg = await sandbox(pg_, g);
  await visit(pg_, g);
  fake.boxes.get(sg)!.endAt = Date.now() + 300_000; // the provider paused it earlier than NYNZ's visit record
  unreachable.add(sg);
  await advance(600 + 3700); await settle();
  const s9 = await sessions(sg);
  const est = (await consumes(g))[0];
  check("9a provider unreachable for over an hour: charged from the visit record, labelled an estimate", s9[0].status === "estimated" && est.cost_source === "runtime_estimate" && est.metadata.estimate === true, `${s9[0].runtime_seconds} s, ${s9[0].charged_credits} credits`);
  unreachable.delete(sg);
  await reconcileEstimatedSessions({ db: admin, sandboxInfo });
  await reconcileEstimatedSessions({ db: admin, sandboxInfo });
  const s9b = await sessions(sg);
  const refunds = await sql("select amount from public.credit_ledger where user_id=$1 and entry_type='grant' and reason='Preview time correction'", [g]);
  check("9b when the provider's record returns, the estimate is corrected by a single refund (never an extra charge)", s9b[0].status === "reconciled" && refunds.length === 1 && Number(refunds[0].amount) === Number(s9b[0].refunded_credits) && Number(s9b[0].refunded_credits) > 0,
    `${s9b[0].runtime_seconds} s actual, ${s9b[0].refunded_credits} credit refunded`);

  // 10. The trial allowance holds across concurrent accounts --------------------
  const trialSpent = Number((await one("select coalesce(sum(coalesce(actual_paise,estimated_paise)),0) s from public.provider_spend where trial and status<>'voided' and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'")).s);
  await sql("update public.spend_limits set limit_paise=$1 where scope='trial'", [trialSpent + 30000]); // a fresh ₹300 for this check
  await sql("delete from public.spend_limits where scope='all'"); // isolate the trial limit from the platform cap in this check
  const trialists = await Promise.all(Array.from({ length: 12 }, (_, i) => customer(`trial-${i}`, 0)));
  const payer = await customer("payer", 100, "purchased");
  const work = async (user: string) => {
    const projectId = await project(user);
    const buildId = randomUUID();
    const refusal = await admitPaidWork(admin, { userId: user, projectId, buildId, credits: 5 });
    if (refusal) { const body = await refusal.json(); return { admitted: false, code: body.code as string, message: body.error as string }; }
    const meter = new BuildMeter(admin, { id: buildId, requested_by: user, project_id: projectId });
    try { await meter.beforeModelCall({ models: ["anthropic/claude-sonnet-5.5"], estimatedPaise: 4000 }); return { admitted: true, sent: true }; }
    catch (error) { return { admitted: true, sent: false, code: (error as { code?: string }).code }; }
  };
  const outcomes = await Promise.all([...trialists, payer].map(work));
  const trialOut = outcomes.slice(0, 12), payOut = outcomes[12];
  const newTrial = Number((await one("select coalesce(sum(estimated_paise),0) s from public.provider_spend where trial and user_id = any($1)", [trialists])).s);
  check("10a 12 trial accounts at once: exactly 7 model requests authorised (₹280 of ₹300); 5 stopped with TRIAL_BUDGET before any request", trialOut.filter((o) => o.sent).length === 7 && trialOut.filter((o) => o.code === "TRIAL_BUDGET").length === 5 && newTrial === 28000,
    `${trialOut.filter((o) => o.sent).length} sent, ${trialOut.filter((o) => !o.sent).length} refused, ₹${newTrial / 100} authorised`);
  check("10b a paid account at the same moment is unaffected", payOut.sent === true);
  const topUp = await customer("trial-last", 0);
  await work(topUp); // a 4000 request no longer fits (28000 + 4000 > 30000)
  const filler = new BuildMeter(admin, { id: randomUUID(), requested_by: trialists[0], project_id: await project(trialists[0]) });
  await filler.beforeModelCall({ models: ["m"], estimatedPaise: 2000 }); // exactly ₹300 now
  const late = await customer("trial-late", 0);
  const lateOut = await work(late);
  const lateHolds = Number((await one("select count(*) n from public.credit_reservations where user_id=$1", [late])).n);
  check("10c once ₹300 is used, a new trial request is refused at admission: no hold, no request", lateOut.admitted === false && lateOut.code === "TRIAL_BUDGET" && lateHolds === 0, (lateOut as { message?: string }).message);
  check("10d paid work is still admitted after the trial allowance is used up", (await work(await customer("payer-2", 100, "purchased"))).sent === true);
  await sql("update public.spend_limits set limit_paise=30000 where scope='trial'");

  console.log("\nLedger rows for the first customer (preview opened, reconnected, paused, reopened, replaced):");
  for (const row of ledgerRows) console.log(`  ${row}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await db.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => { console.error(error); await db.end().catch(() => undefined); process.exit(1); });
