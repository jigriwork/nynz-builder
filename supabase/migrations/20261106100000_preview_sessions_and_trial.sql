-- NYNZ 0.5: preview billing sessions and the revised trial.
--
-- Switchover: the old clock-window preview charge ends, and session billing
-- starts, at the moment this migration commits. authorize_sandbox_runtime
-- (still called by the previous preview host and terminal during the
-- rollout) now holds and meters through the session path, and runtime a
-- sandbox already paid for under the old billing is not charged again
-- (private.legacy_paid_until). Preview holds are kept out of the build-hold
-- sweep in reconcile_credits, which old and new workers both run.
--
-- 1. One billing session per sandbox. The sandbox a build creates becomes the
--    project's preview, so its build time and later preview time are the same
--    runtime and are charged once. A session row (a "segment") opens when the
--    sandbox is created, holding credits for its first timeout. Before any
--    preview or terminal visit extends the runtime, the hold is topped up if
--    the extension would run past what is held; if the account cannot cover
--    it, the visit is refused and runtime is not extended. Every visit records
--    its time and the timeout it set, so the sandbox's pause time is known
--    from NYNZ's own records (last visit + its timeout). A shutdown (failed
--    build, replacement after an edit) ends it earlier. The actual seconds are
--    charged once and the rest of the hold is released. A visit after a pause
--    opens the next segment. Duplicate events change nothing. When runtime
--    evidence is missing, the held amount is charged as an estimate and can be
--    reconciled later; reconciliation only ever refunds.
-- 2. Trial: a trial grant source, a separate trial daily spending limit that
--    counts only spending by trial-only accounts, and runtime holds that never
--    occupy a build-concurrency slot.

-- Runtime holds are not builds.
alter table public.credit_reservations add column if not exists kind text not null default 'build';
alter table public.credit_reservations drop constraint if exists credit_reservations_kind_check;
alter table public.credit_reservations add constraint credit_reservations_kind_check check (kind in ('build', 'runtime'));

create or replace function public.reserve_credits(p_user uuid, p_project uuid, p_build uuid, p_amount bigint, p_max_concurrent integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_amount < 0 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  perform private.lock_credit_account(p_user);
  select id into v_id from public.credit_reservations where build_id = p_build;
  if found then return v_id; end if;
  if (select count(*) from public.credit_reservations where user_id = p_user and status = 'active' and kind = 'build') >= p_max_concurrent then
    raise exception 'CONCURRENCY_LIMIT' using errcode = 'P0001';
  end if;
  if private.credit_available(p_user) < p_amount then raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001'; end if;
  insert into public.credit_reservations(user_id, project_id, build_id, amount) values (p_user, p_project, p_build, p_amount) returning id into v_id;
  insert into public.credit_ledger(user_id, entry_type, amount, reservation_id, build_id, metadata)
  values (p_user, 'reserve', 0, v_id, p_build, jsonb_build_object('held', p_amount));
  return v_id;
end; $$;

create or replace function private.reserve_runtime(p_user uuid, p_project uuid, p_operation uuid, p_amount bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.lock_credit_account(p_user);
  if private.credit_available(p_user) < p_amount then raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001'; end if;
  insert into public.credit_reservations(user_id, project_id, build_id, amount, kind) values (p_user, p_project, p_operation, p_amount, 'runtime') returning id into v_id;
  insert into public.credit_ledger(user_id, entry_type, amount, reservation_id, build_id, metadata)
  values (p_user, 'reserve', 0, v_id, p_operation, jsonb_build_object('held', p_amount, 'kind', 'preview time'));
  return v_id;
end; $$;

-- Trial grants and the trial spending limit.
alter table public.credit_grants drop constraint if exists credit_grants_source_check;
alter table public.credit_grants add constraint credit_grants_source_check
  check (source in ('plan_included', 'purchased', 'promotional', 'owner_testing', 'adjustment', 'refund_restore', 'trial'));
alter table public.spend_limits add column if not exists scope text not null default 'all';
alter table public.spend_limits drop constraint if exists spend_limits_scope_check;
alter table public.spend_limits add constraint spend_limits_scope_check check (scope in ('all', 'trial'));
alter table public.provider_spend add column if not exists trial boolean not null default false;

-- A trial-only account: it has a trial grant and has never had paid, plan or
-- owner credits or a live subscription.
create or replace function private.is_trial_account(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null
    and exists (select 1 from public.credit_grants where user_id = p_user and (source = 'trial' or idempotency_key like 'trial:%'))
    and not exists (select 1 from public.credit_grants where user_id = p_user and source in ('plan_included', 'purchased', 'owner_testing'))
    and not exists (select 1 from public.subscriptions where user_id = p_user and status in ('authenticated', 'active', 'pending'));
$$;

insert into public.spend_limits(name, provider, period, limit_paise, scope, note)
select 'Free trial daily spend', null, 'day', 30000, 'trial', 'Spending by trial-only accounts (₹300/day to start). Paid accounts keep the rest of the platform cap.'
where not exists (select 1 from public.spend_limits where scope = 'trial');

-- Platform caps, now with the trial-only limit.
create or replace function public.authorize_provider_spend(p_provider text, p_kind text, p_model text, p_estimate bigint, p_build uuid, p_user uuid, p_event_key text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare l record; v_spent bigint; v_from timestamptz; v_to timestamptz; v_id bigint; v_trial boolean;
begin
  perform pg_advisory_xact_lock(7364202);
  select id into v_id from public.provider_spend where event_key = p_event_key;
  if found then return v_id; end if;
  v_trial := private.is_trial_account(p_user);
  for l in select * from public.spend_limits where active and (provider is null or provider = p_provider) and (scope = 'all' or (scope = 'trial' and v_trial)) loop
    if l.period = 'day' then v_from := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'; v_to := v_from + interval '1 day';
    elsif l.period = 'month' then v_from := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'; v_to := v_from + interval '1 month';
    else v_from := l.window_start; v_to := l.window_end; if now() not between v_from and v_to then continue; end if;
    end if;
    select coalesce(sum(coalesce(actual_paise, estimated_paise)), 0) into v_spent from public.provider_spend
    where status <> 'voided' and created_at >= v_from and created_at < v_to and (l.provider is null or provider = l.provider) and (l.scope = 'all' or trial);
    if v_spent + p_estimate > l.limit_paise then
      raise exception '%', case when l.scope = 'trial' then 'TRIAL_BUDGET' else 'SPEND_LIMIT' end using errcode = 'P0001', detail = l.name;
    end if;
  end loop;
  insert into public.provider_spend(provider, kind, model, build_id, user_id, estimated_paise, event_key, trial)
  values (p_provider, p_kind, p_model, p_build, p_user, p_estimate, p_event_key, v_trial) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.account_is_trial(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.is_trial_account(p_user) $$;

-- Whether a trial account can still start paid work today (true for everyone else).
create or replace function public.trial_budget_open(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare l public.spend_limits; v_spent bigint; v_from timestamptz;
begin
  if not private.is_trial_account(p_user) then return true; end if;
  for l in select * from public.spend_limits where active and scope = 'trial' and period = 'day' loop
    v_from := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
    select coalesce(sum(coalesce(actual_paise, estimated_paise)), 0) into v_spent from public.provider_spend
    where status <> 'voided' and trial and created_at >= v_from;
    if v_spent >= l.limit_paise then return false; end if;
  end loop;
  return true;
end; $$;

-- ---------------------------------------------------------------------------
-- Preview billing sessions.
create table if not exists public.sandbox_sessions (
  id uuid primary key default gen_random_uuid(),
  sandbox_id text not null,
  segment integer not null default 1,
  project_id uuid not null,
  owner_id uuid not null,
  build_id uuid,
  started_at timestamptz not null,
  last_access_at timestamptz not null,
  last_timeout_seconds integer not null check (last_timeout_seconds between 1 and 3600),
  -- The latest end any visit has asked for (visit time + its timeout); never shortened.
  runs_until timestamptz not null,
  covered_until timestamptz not null,
  held_credits bigint not null default 0 check (held_credits >= 0),
  top_ups integer not null default 0,
  paise_per_second numeric not null check (paise_per_second > 0),
  paise_per_credit integer not null check (paise_per_credit > 0),
  status text not null default 'open' check (status in ('open', 'settled', 'estimated', 'reconciled')),
  ended_at timestamptz,
  end_source text,
  runtime_seconds integer,
  charged_credits bigint,
  refunded_credits bigint not null default 0,
  estimate_reason text,
  created_at timestamptz not null default now(),
  unique (sandbox_id, segment)
);
create unique index if not exists sandbox_sessions_one_open on public.sandbox_sessions(sandbox_id) where status = 'open';
create index if not exists sandbox_sessions_owner_idx on public.sandbox_sessions(owner_id, created_at desc);
alter table public.sandbox_sessions enable row level security;
revoke all on public.sandbox_sessions from public, anon, authenticated;
grant select on public.sandbox_sessions to authenticated;
grant select, insert, update on public.sandbox_sessions to service_role;
create policy sandbox_sessions_owner_read on public.sandbox_sessions for select to authenticated using (owner_id = auth.uid());

create or replace function private.session_credits(p_seconds numeric, p_pps numeric, p_ppc integer) returns bigint
language sql immutable set search_path = '' as $$ select greatest(0, ceil(p_seconds * p_pps / p_ppc))::bigint $$;

-- Runtime a sandbox already paid for under the previous billing (before this
-- migration): a 10-minute clock-window charge covered the sandbox until the
-- end of the following window, and a build's sandbox charge covered its first
-- allocated seconds from creation. A sandbox that has never had a session is
-- only charged from the end of that time, so the switchover never charges the
-- same runtime twice.
create or replace function private.legacy_paid_until(p_sandbox text) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(
    (select max(to_timestamp((split_part(l.event_key, ':', 4)::numeric + 2) * split_part(l.event_key, ':', 3)::numeric))
       from public.credit_ledger l
      where l.entry_type = 'consume' and left(l.event_key, length('runtime:' || p_sandbox || ':')) = 'runtime:' || p_sandbox || ':'
        and split_part(l.event_key, ':', 3) ~ '^[0-9]+$' and split_part(l.event_key, ':', 4) ~ '^[0-9]+$'),
    (select r.created_at + make_interval(secs => coalesce(
        (select (l.metadata->>'allocated_seconds')::numeric from public.credit_ledger l where l.event_key = 'e2b:' || p_sandbox || ':build' limit 1), 600))
       from public.platform_resources r
      where r.kind = 'e2b_sandbox' and r.provider_ref = p_sandbox and r.purpose = 'preview'
      order by r.created_at limit 1));
$$;

-- Opens a session segment (worker: when a build creates the sandbox; host:
-- the first visit to a sandbox without an open segment, or after a pause).
-- p_start is when charging starts; it is later than the visit only for time
-- already paid under the previous billing.
create or replace function private.open_segment(p_sandbox text, p_project uuid, p_user uuid, p_build uuid, p_timeout integer, p_pps numeric, p_ppc integer, p_at timestamptz, p_start timestamptz default null)
returns public.sandbox_sessions language plpgsql security definer set search_path = '' as $$
declare s public.sandbox_sessions; v_id uuid := gen_random_uuid(); v_credits bigint; v_segment integer; v_start timestamptz; v_end timestamptz; v_seconds numeric;
begin
  v_start := greatest(p_at, coalesce(p_start, p_at));
  v_end := p_at + make_interval(secs => p_timeout);
  v_seconds := greatest(0, extract(epoch from v_end - v_start));
  v_credits := private.session_credits(v_seconds, p_pps, p_ppc);
  perform private.reserve_runtime(p_user, p_project, v_id, v_credits);
  perform public.authorize_provider_spend('e2b', 'sandbox', null, ceil(v_seconds * p_pps)::bigint, p_build, p_user, 'session:' || v_id || ':0');
  select coalesce(max(segment), 0) + 1 into v_segment from public.sandbox_sessions where sandbox_id = p_sandbox;
  insert into public.sandbox_sessions(id, sandbox_id, segment, project_id, owner_id, build_id, started_at, last_access_at, last_timeout_seconds, runs_until, covered_until, held_credits, paise_per_second, paise_per_credit)
  values (v_id, p_sandbox, v_segment, p_project, p_user, p_build, v_start, p_at, p_timeout, v_end, greatest(v_end, v_start), v_credits, p_pps, p_ppc)
  returning * into s;
  return s;
end; $$;

create or replace function public.open_sandbox_session(p_sandbox text, p_project uuid, p_user uuid, p_build uuid, p_timeout integer, p_pps numeric, p_ppc integer, p_at timestamptz default now())
returns public.sandbox_sessions language plpgsql security definer set search_path = '' as $$
declare s public.sandbox_sessions;
begin
  if p_timeout < 1 or p_timeout > 3600 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  perform private.lock_credit_account(p_user);
  select * into s from public.sandbox_sessions where sandbox_id = p_sandbox and status = 'open';
  if found then return s; end if;
  return private.open_segment(p_sandbox, p_project, p_user, p_build, p_timeout, p_pps, p_ppc, p_at);
end; $$;

-- Settles a segment: charges its seconds once, releases the rest of the hold.
create or replace function public.settle_sandbox_session(p_session uuid, p_ended_at timestamptz, p_source text, p_estimate_reason text default null)
returns public.sandbox_sessions language plpgsql security definer set search_path = '' as $$
declare s public.sandbox_sessions; v_end timestamptz; v_seconds integer; v_credits bigint; v_owner uuid; v_cost bigint; v_first bigint;
begin
  -- Same lock order as extend_sandbox_session (account, then session) so a
  -- settlement and a visit can never deadlock.
  select owner_id into v_owner from public.sandbox_sessions where id = p_session;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform private.lock_credit_account(v_owner);
  select * into s from public.sandbox_sessions where id = p_session for update;
  if s.status <> 'open' then return s; end if;
  -- A sandbox cannot run past the latest end any visit asked for, so no
  -- settlement (or retry claiming a later end) is charged beyond it.
  v_end := greatest(least(coalesce(p_ended_at, s.runs_until), s.runs_until), s.started_at);
  v_seconds := ceil(extract(epoch from v_end - s.started_at))::integer;
  v_credits := private.session_credits(v_seconds, s.paise_per_second, s.paise_per_credit);
  -- The provider cost is the running seconds at NYNZ's configured rate, so it
  -- is always labelled an estimate; a fallback charge is also labelled.
  v_cost := ceil(v_seconds * s.paise_per_second)::bigint;
  if v_credits > 0 then
    perform public.consume_credits(s.id, v_credits, 'session:' || s.id, 'e2b', null, v_cost,
      case when p_estimate_reason is null then 'configured_rate_estimate' else 'runtime_estimate' end,
      jsonb_build_object('step', 'Preview time', 'seconds', v_seconds, 'source', p_source, 'sandbox', s.sandbox_id, 'segment', s.segment,
        'project_id', s.project_id, 'estimate', p_estimate_reason is not null, 'cost_estimate', true, 'paise_per_credit', s.paise_per_credit));
  end if;
  -- Replace the held spend estimates with the estimate for the time that ran.
  select min(id) into v_first from public.provider_spend where event_key like 'session:' || s.id || ':%' and status = 'authorized';
  update public.provider_spend set estimated_paise = case when id = v_first then v_cost else 0 end,
    cost_source = case when p_estimate_reason is null then 'configured_rate_estimate' else 'runtime_estimate' end
  where event_key like 'session:' || s.id || ':%' and status = 'authorized';
  perform public.settle_reservation(s.id, 'preview time settled');
  update public.sandbox_sessions set status = case when p_estimate_reason is null then 'settled' else 'estimated' end,
    ended_at = v_end, end_source = p_source, runtime_seconds = v_seconds, charged_credits = v_credits, estimate_reason = p_estimate_reason
  where id = s.id returning * into s;
  return s;
end; $$;

-- Preview host and terminal: called before a visit extends the sandbox's
-- runtime. Returns whether the extension is covered; raises when it cannot
-- be held. Idempotent for repeated visits at the same moment.
create or replace function public.extend_sandbox_session(p_project uuid, p_user uuid, p_sandbox text, p_timeout integer, p_pps numeric, p_ppc integer, p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sandbox_sessions; v_needed timestamptz; v_cover timestamptz; v_total bigint; v_add bigint; v_ok boolean; v_resumed boolean := false;
begin
  if p_timeout < 1 or p_timeout > 3600 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.authorize_sandbox_access(p_project, p_user) a where a.sandbox_id = p_sandbox) then
    raise exception 'NOT_PROJECT_OWNER' using errcode = 'P0001';
  end if;
  perform private.lock_credit_account(p_user);
  select * into s from public.sandbox_sessions where sandbox_id = p_sandbox and status = 'open' for update;
  -- The sandbox paused before this visit: close that segment at its known end.
  if found and least(s.runs_until, s.covered_until) < p_at then
    perform public.settle_sandbox_session(s.id, least(s.runs_until, s.covered_until), 'visit_log');
    found := false;
    v_resumed := true;
  end if;
  if not found then
    s := private.open_segment(p_sandbox, p_project, p_user, null, p_timeout, p_pps, p_ppc, p_at,
      case when exists (select 1 from public.sandbox_sessions where sandbox_id = p_sandbox) then null else private.legacy_paid_until(p_sandbox) end);
    return jsonb_build_object('session', s.id, 'segment', s.segment, 'covered_until', s.covered_until, 'held', s.held_credits, 'opened', true, 'resumed', v_resumed, 'visit_at', p_at);
  end if;
  v_needed := p_at + make_interval(secs => p_timeout);
  if s.covered_until < v_needed then
    -- Reserve before extending: cover this visit plus one more timeout.
    v_cover := v_needed + make_interval(secs => p_timeout);
    v_total := private.session_credits(extract(epoch from v_cover - s.started_at), s.paise_per_second, s.paise_per_credit);
    v_add := greatest(0, v_total - s.held_credits);
    if v_add > 0 then
      select public.ensure_reservation_headroom(s.id, v_total) into v_ok;
      if not v_ok then raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001'; end if;
      perform public.authorize_provider_spend('e2b', 'sandbox', null, ceil(extract(epoch from v_cover - s.covered_until) * s.paise_per_second)::bigint, null, p_user, 'session:' || s.id || ':' || (s.top_ups + 1));
    end if;
    update public.sandbox_sessions set covered_until = v_cover, held_credits = greatest(held_credits, v_total), top_ups = top_ups + case when v_add > 0 then 1 else 0 end
    where id = s.id returning * into s;
  end if;
  update public.sandbox_sessions set last_access_at = greatest(last_access_at, p_at), last_timeout_seconds = case when p_at >= last_access_at then p_timeout else last_timeout_seconds end,
    runs_until = greatest(runs_until, p_at + make_interval(secs => p_timeout))
  where id = s.id returning * into s;
  return jsonb_build_object('session', s.id, 'segment', s.segment, 'covered_until', s.covered_until, 'held', s.held_credits, 'opened', false, 'resumed', false, 'visit_at', p_at);
end; $$;

-- Preview host: the visit that opened a segment could not reach the sandbox
-- (for example it was deleted while paused). Nothing ran, so the segment is
-- closed with no charge and its hold released. Ignored once anything else
-- has used the segment.
create or replace function public.abandon_sandbox_visit(p_session uuid, p_visit timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare s public.sandbox_sessions; v_owner uuid;
begin
  select owner_id into v_owner from public.sandbox_sessions where id = p_session;
  if not found then return false; end if;
  perform private.lock_credit_account(v_owner);
  select * into s from public.sandbox_sessions where id = p_session for update;
  if s.status <> 'open' or s.last_access_at <> p_visit or s.started_at < p_visit or s.top_ups > 0 then return false; end if;
  perform public.settle_sandbox_session(s.id, s.started_at, 'connect_failed');
  return true;
end; $$;

-- The previous preview host and terminal call this. From this migration on it
-- holds and meters through the session path, so the old clock-window charge
-- ends the moment the migration commits, whichever code is still running.
create or replace function public.authorize_sandbox_runtime(
  p_project uuid, p_user uuid, p_sandbox text, p_seconds integer,
  p_estimate bigint, p_credits bigint, p_paise_per_credit bigint default 100
) returns bigint language plpgsql security definer set search_path = '' as $$
begin
  if p_seconds < 60 or p_seconds > 3600 or p_estimate < 1 or p_credits < 1 or p_paise_per_credit < 1 or p_credits <> ceil(p_estimate::numeric/p_paise_per_credit) then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  -- The old estimate is for twice the timeout.
  perform public.extend_sandbox_session(p_project, p_user, p_sandbox, p_seconds, p_estimate::numeric / (2 * p_seconds), p_paise_per_credit::integer, now());
  return 0;
end; $$;

-- Maintenance (every worker, old or new): a preview hold belongs to its
-- session and is released only when the session settles, never by the
-- build-hold sweep. A hold whose session is already closed is released.
create or replace function public.reconcile_credits() returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_released integer := 0; v_expired integer := 0; g record;
begin
  for r in select cr.build_id from public.credit_reservations cr left join public.build_jobs j on j.id = cr.build_id
           where cr.status = 'active' and (
             (cr.kind = 'build' and ((j.id is null and cr.created_at < now() - interval '10 minutes') or j.status in ('succeeded', 'failed', 'cancelled') or cr.created_at < now() - interval '12 hours'))
             or (cr.kind = 'runtime' and cr.created_at < now() - interval '10 minutes'
                 and not exists (select 1 from public.sandbox_sessions s where s.id = cr.build_id and s.status = 'open'))) loop
    perform public.settle_reservation(r.build_id, 'reconciled');
    v_released := v_released + 1;
  end loop;
  for g in select id, user_id, remaining from public.credit_grants where remaining > 0 and expires_at is not null and expires_at <= now() for update skip locked loop
    update public.credit_grants set remaining = 0 where id = g.id;
    insert into public.credit_ledger(user_id, entry_type, amount, grant_id, reason) values (g.user_id, 'expire', -g.remaining, g.id, 'Credits expired');
    v_expired := v_expired + 1;
  end loop;
  return jsonb_build_object('released', v_released, 'expired', v_expired);
end; $$;

-- Worker: open segments whose sandbox has stopped (or must have) by now.
create or replace function public.sandbox_sessions_to_settle(p_at timestamptz default now(), p_grace_seconds integer default 60)
returns table(session_id uuid, sandbox_id text, natural_end timestamptz, terminated_at timestamptz, started_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.sandbox_id, least(s.runs_until, s.covered_until), r.terminated_at, s.started_at
  from public.sandbox_sessions s
  left join public.platform_resources r on r.kind = 'e2b_sandbox' and r.provider_ref = s.sandbox_id
  where s.status = 'open'
    and (least(s.runs_until, s.covered_until) < p_at - make_interval(secs => p_grace_seconds)
         or (r.terminated_at is not null and r.terminated_at < p_at - make_interval(secs => p_grace_seconds)));
$$;

-- An estimated segment is corrected once real evidence is available. It only
-- ever refunds: a customer is never charged more after the fact.
create or replace function public.reconcile_sandbox_session(p_session uuid, p_ended_at timestamptz, p_source text)
returns public.sandbox_sessions language plpgsql security definer set search_path = '' as $$
declare s public.sandbox_sessions; v_seconds integer; v_actual bigint; v_refund bigint; l public.credit_ledger; v_owner uuid;
begin
  select owner_id into v_owner from public.sandbox_sessions where id = p_session;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform private.lock_credit_account(v_owner);
  select * into s from public.sandbox_sessions where id = p_session for update;
  if s.status <> 'estimated' then return s; end if;
  v_seconds := ceil(extract(epoch from greatest(p_ended_at, s.started_at) - s.started_at))::integer;
  v_actual := private.session_credits(v_seconds, s.paise_per_second, s.paise_per_credit);
  v_refund := greatest(0, coalesce(s.charged_credits, 0) - v_actual);
  if v_refund > 0 then
    select * into l from public.credit_ledger where event_key = 'session:' || s.id;
    perform public.grant_credits(s.owner_id, 'refund_restore', v_refund,
      (select max(g.expires_at) from public.credit_grants g where g.id in (select (a->>'grant')::uuid from jsonb_array_elements(coalesce(l.metadata->'allocations', '[]'::jsonb)) a)),
      'Preview time correction', null, 'session-refund:' || s.id);
  end if;
  update public.sandbox_sessions set status = 'reconciled', ended_at = greatest(p_ended_at, s.started_at), end_source = p_source,
    runtime_seconds = v_seconds, refunded_credits = v_refund
  where id = s.id returning * into s;
  return s;
end; $$;

revoke all on function private.reserve_runtime(uuid, uuid, uuid, bigint) from public;
revoke all on function private.is_trial_account(uuid) from public;
revoke all on function private.session_credits(numeric, numeric, integer) from public;
revoke all on function private.open_segment(text, uuid, uuid, uuid, integer, numeric, integer, timestamptz, timestamptz) from public;
revoke all on function private.legacy_paid_until(text) from public;
revoke all on function public.abandon_sandbox_visit(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.abandon_sandbox_visit(uuid, timestamptz) to service_role;
revoke all on function public.authorize_sandbox_runtime(uuid,uuid,text,integer,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.authorize_sandbox_runtime(uuid,uuid,text,integer,bigint,bigint,bigint) to service_role;
revoke all on function public.trial_budget_open(uuid) from public, anon, authenticated;
revoke all on function public.account_is_trial(uuid) from public, anon, authenticated;
grant execute on function public.account_is_trial(uuid) to service_role;
revoke all on function public.open_sandbox_session(text, uuid, uuid, uuid, integer, numeric, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.settle_sandbox_session(uuid, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.extend_sandbox_session(uuid, uuid, text, integer, numeric, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.sandbox_sessions_to_settle(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.reconcile_sandbox_session(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.trial_budget_open(uuid) to service_role;
grant execute on function public.open_sandbox_session(text, uuid, uuid, uuid, integer, numeric, integer, timestamptz) to service_role;
grant execute on function public.settle_sandbox_session(uuid, timestamptz, text, text) to service_role;
grant execute on function public.extend_sandbox_session(uuid, uuid, text, integer, numeric, integer, timestamptz) to service_role;
grant execute on function public.sandbox_sessions_to_settle(timestamptz, integer) to service_role;
grant execute on function public.reconcile_sandbox_session(uuid, timestamptz, text) to service_role;
