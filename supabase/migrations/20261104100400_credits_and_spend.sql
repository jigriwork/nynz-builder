-- NYNZ release 0.3, part 5: customer credit ledger and platform spend caps.
--
-- Four things are kept separate:
--   * customer credits/entitlements      -> credit_grants, credit_reservations, credit_ledger
--   * provider tokens/resource usage     -> usage_events (unchanged; historical rows preserved)
--   * NYNZ's spend at providers          -> provider_spend, spend_limits (platform-wide caps)
--   * company payments and expenses      -> billing tables (next migration)
-- Historical usage_events are NOT converted into balances or payments.
--
-- Paid work reserves credits before it starts; each provider call is checked
-- against the reservation and against platform spend caps BEFORE the request
-- is sent; actual cost is consumed afterwards (deduplicated by event key); the
-- unused reservation is released when the build ends for any reason.

create table if not exists public.credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('plan_included', 'purchased', 'promotional', 'owner_testing', 'adjustment', 'refund_restore')),
  amount bigint not null check (amount > 0),
  remaining bigint not null check (remaining >= 0),
  expires_at timestamptz,
  subscription_id uuid,
  payment_id uuid,
  created_by uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  check (remaining <= amount)
);
create index if not exists credit_grants_user_idx on public.credit_grants(user_id, expires_at);

create table if not exists public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid,
  build_id uuid unique,
  amount bigint not null check (amount >= 0),
  consumed bigint not null default 0 check (consumed >= 0),
  status text not null default 'active' check (status in ('active', 'settled', 'released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists credit_reservations_active_idx on public.credit_reservations(user_id) where status = 'active';

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_type text not null check (entry_type in ('grant', 'consume', 'expire', 'adjust_debit', 'reserve', 'release', 'overrun_absorbed')),
  amount bigint not null,
  grant_id uuid,
  reservation_id uuid,
  build_id uuid,
  event_key text,
  provider text,
  model text,
  cost_paise bigint,
  cost_source text,
  actor_id uuid,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists credit_ledger_event_key on public.credit_ledger(event_key) where event_key is not null;
create index if not exists credit_ledger_user_idx on public.credit_ledger(user_id, created_at desc);

create or replace function private.ledger_immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'LEDGER_IS_APPEND_ONLY' using errcode = 'P0001'; end; $$;
drop trigger if exists credit_ledger_immutable on public.credit_ledger;
create trigger credit_ledger_immutable before update or delete on public.credit_ledger for each row execute function private.ledger_immutable();

-- Platform spend ----------------------------------------------------------------
create table if not exists public.spend_limits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text,
  period text not null check (period in ('day', 'month', 'window')),
  window_start timestamptz,
  window_end timestamptz,
  limit_paise bigint not null check (limit_paise > 0),
  warn_at_percent integer not null default 80 check (warn_at_percent between 1 and 100),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  note text,
  check (period <> 'window' or (window_start is not null and window_end is not null and window_end > window_start))
);

create table if not exists public.provider_spend (
  id bigint generated always as identity primary key,
  provider text not null,
  kind text not null check (kind in ('model', 'sandbox', 'scrape', 'other')),
  model text,
  build_id uuid,
  user_id uuid,
  estimated_paise bigint not null default 0 check (estimated_paise >= 0),
  actual_paise bigint check (actual_paise >= 0),
  cost_source text,
  status text not null default 'authorized' check (status in ('authorized', 'settled', 'voided')),
  event_key text unique,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists provider_spend_created_idx on public.provider_spend(created_at desc, provider);

-- A conservative default; the owner changes it in the admin console.
insert into public.spend_limits(name, provider, period, limit_paise, note)
select 'Platform daily provider spend', null, 'day', 100000, 'Default ₹1,000/day across all providers. Adjust in Admin → Providers.'
where not exists (select 1 from public.spend_limits);

do $$ declare t text; begin
  foreach t in array array['credit_accounts','credit_grants','credit_reservations','credit_ledger','spend_limits','provider_spend'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
end $$;
grant insert on public.credit_accounts to service_role;
grant select on public.credit_grants, public.credit_ledger, public.credit_reservations to authenticated;
create policy credit_grants_own on public.credit_grants for select to authenticated using (user_id = auth.uid() or private.has_staff_cap('credits.read'));
create policy credit_ledger_own on public.credit_ledger for select to authenticated using (user_id = auth.uid() or private.has_staff_cap('credits.read'));
create policy credit_reservations_own on public.credit_reservations for select to authenticated using (user_id = auth.uid() or private.has_staff_cap('credits.read'));

-- Core ledger functions -------------------------------------------------------------
create or replace function private.lock_credit_account(p_user uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.credit_accounts(user_id) values (p_user) on conflict do nothing;
  perform 1 from public.credit_accounts where user_id = p_user for update;
end; $$;

create or replace function private.credit_available(p_user uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(remaining) from public.credit_grants where user_id = p_user and (expires_at is null or expires_at > now())), 0)
       - coalesce((select sum(amount - consumed) from public.credit_reservations where user_id = p_user and status = 'active'), 0);
$$;

create or replace function public.credit_balance(p_user uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'included', coalesce(sum(remaining) filter (where source = 'plan_included' and live), 0),
    'purchased', coalesce(sum(remaining) filter (where source = 'purchased' and live), 0),
    'promotional', coalesce(sum(remaining) filter (where source in ('promotional', 'adjustment', 'refund_restore') and live), 0),
    'owner_testing', coalesce(sum(remaining) filter (where source = 'owner_testing' and live), 0),
    'reserved', coalesce((select sum(amount - consumed) from public.credit_reservations where user_id = p_user and status = 'active'), 0),
    'used', coalesce((select -sum(amount) from public.credit_ledger where user_id = p_user and entry_type = 'consume'), 0),
    'available', private.credit_available(p_user),
    'next_expiry', min(expires_at) filter (where live and remaining > 0 and expires_at is not null)
  ) from (select g.*, (g.expires_at is null or g.expires_at > now()) as live from public.credit_grants g where g.user_id = p_user) x;
$$;

create or replace function public.my_credit_balance() returns jsonb language sql stable security definer set search_path = '' as $$
  select public.credit_balance(auth.uid());
$$;

create or replace function public.grant_credits(p_user uuid, p_source text, p_amount bigint, p_expires_at timestamptz, p_reason text,
  p_actor uuid, p_idempotency text, p_subscription uuid default null, p_payment uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_amount <= 0 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  select id into v_id from public.credit_grants where idempotency_key = p_idempotency;
  if found then return v_id; end if;
  perform private.lock_credit_account(p_user);
  insert into public.credit_grants(user_id, source, amount, remaining, expires_at, subscription_id, payment_id, created_by, reason, idempotency_key)
  values (p_user, p_source, p_amount, p_amount, p_expires_at, p_subscription, p_payment, p_actor, p_reason, p_idempotency) returning id into v_id;
  insert into public.credit_ledger(user_id, entry_type, amount, grant_id, actor_id, reason, metadata)
  values (p_user, 'grant', p_amount, v_id, p_actor, p_reason, jsonb_build_object('source', p_source, 'expires_at', p_expires_at));
  return v_id;
end; $$;

create or replace function public.reserve_credits(p_user uuid, p_project uuid, p_build uuid, p_amount bigint, p_max_concurrent integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_amount < 0 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  perform private.lock_credit_account(p_user);
  select id into v_id from public.credit_reservations where build_id = p_build;
  if found then return v_id; end if;
  if (select count(*) from public.credit_reservations where user_id = p_user and status = 'active') >= p_max_concurrent then
    raise exception 'CONCURRENCY_LIMIT' using errcode = 'P0001';
  end if;
  if private.credit_available(p_user) < p_amount then raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001'; end if;
  insert into public.credit_reservations(user_id, project_id, build_id, amount) values (p_user, p_project, p_build, p_amount) returning id into v_id;
  insert into public.credit_ledger(user_id, entry_type, amount, reservation_id, build_id, metadata)
  values (p_user, 'reserve', 0, v_id, p_build, jsonb_build_object('held', p_amount));
  return v_id;
end; $$;

-- Ensure the reservation can absorb the next call's worst case; extends it
-- from the available balance if possible. Returns false when it cannot.
create or replace function public.ensure_reservation_headroom(p_build uuid, p_needed bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.credit_reservations; v_short bigint;
begin
  select * into r from public.credit_reservations where build_id = p_build;
  if not found or r.status <> 'active' then return false; end if;
  perform private.lock_credit_account(r.user_id);
  select * into r from public.credit_reservations where id = r.id for update;
  v_short := p_needed - (r.amount - r.consumed);
  if v_short <= 0 then return true; end if;
  if private.credit_available(r.user_id) < v_short then return false; end if;
  update public.credit_reservations set amount = amount + v_short where id = r.id;
  insert into public.credit_ledger(user_id, entry_type, amount, reservation_id, build_id, metadata)
  values (r.user_id, 'reserve', 0, r.id, p_build, jsonb_build_object('held', v_short, 'extension', true));
  return true;
end; $$;

create or replace function public.consume_credits(p_build uuid, p_amount bigint, p_event_key text, p_provider text, p_model text,
  p_cost_paise bigint, p_cost_source text, p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.credit_reservations; v_charge bigint; v_left bigint; g record; v_take bigint; v_alloc jsonb := '[]'::jsonb; v_headroom bigint; v_extend bigint;
begin
  if p_event_key is null or p_amount < 0 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.credit_ledger where event_key = p_event_key) then return jsonb_build_object('duplicate', true); end if;
  select * into r from public.credit_reservations where build_id = p_build;
  if not found then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'No reservation'; end if;
  perform private.lock_credit_account(r.user_id);
  select * into r from public.credit_reservations where id = r.id for update;
  if exists (select 1 from public.credit_ledger where event_key = p_event_key) then return jsonb_build_object('duplicate', true); end if;
  -- A late provider response after settlement is charged against the
  -- balance directly (never below zero); the rest is absorbed by NYNZ.
  v_headroom := case when r.status = 'active' then r.amount - r.consumed else 0 end;
  v_extend := greatest(0, least(p_amount - v_headroom, private.credit_available(r.user_id)));
  v_charge := least(p_amount, v_headroom + v_extend);
  v_left := v_charge;
  for g in select id, remaining from public.credit_grants
           where user_id = r.user_id and remaining > 0 and (expires_at is null or expires_at > now())
           order by expires_at nulls last, case source when 'owner_testing' then 0 when 'plan_included' then 1 when 'promotional' then 2 when 'adjustment' then 2 else 3 end, created_at
           for update loop
    exit when v_left <= 0;
    v_take := least(v_left, g.remaining);
    update public.credit_grants set remaining = remaining - v_take where id = g.id;
    v_alloc := v_alloc || jsonb_build_array(jsonb_build_object('grant', g.id, 'amount', v_take));
    v_left := v_left - v_take;
  end loop;
  v_charge := v_charge - v_left;
  update public.credit_reservations set consumed = consumed + v_charge, amount = greatest(amount, consumed + v_charge) where id = r.id;
  insert into public.credit_ledger(user_id, entry_type, amount, reservation_id, build_id, event_key, provider, model, cost_paise, cost_source, metadata)
  values (r.user_id, 'consume', -v_charge, r.id, p_build, p_event_key, p_provider, p_model, p_cost_paise, p_cost_source,
          coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('allocations', v_alloc, 'requested', p_amount));
  if v_charge < p_amount then
    insert into public.credit_ledger(user_id, entry_type, amount, reservation_id, build_id, provider, model, metadata)
    values (r.user_id, 'overrun_absorbed', 0, r.id, p_build, p_provider, p_model, jsonb_build_object('uncharged_credits', p_amount - v_charge, 'event_key', p_event_key));
  end if;
  return jsonb_build_object('charged', v_charge, 'absorbed', p_amount - v_charge);
end; $$;

create or replace function public.settle_reservation(p_build uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.credit_reservations;
begin
  select * into r from public.credit_reservations where build_id = p_build;
  if not found then return jsonb_build_object('settled', false); end if;
  perform private.lock_credit_account(r.user_id);
  select * into r from public.credit_reservations where id = r.id for update;
  if r.status <> 'active' then return jsonb_build_object('settled', false, 'status', r.status); end if;
  update public.credit_reservations set status = case when consumed > 0 then 'settled' else 'released' end, settled_at = now() where id = r.id;
  insert into public.credit_ledger(user_id, entry_type, amount, reservation_id, build_id, reason, metadata)
  values (r.user_id, 'release', 0, r.id, p_build, left(p_reason, 200), jsonb_build_object('released', r.amount - r.consumed, 'consumed', r.consumed));
  return jsonb_build_object('settled', true, 'consumed', r.consumed, 'released', r.amount - r.consumed);
end; $$;

-- Periodic reconciliation: release reservations whose build ended, vanished
-- or stalled; expire lapsed grants.
create or replace function public.reconcile_credits() returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_released integer := 0; v_expired integer := 0; g record;
begin
  for r in select cr.build_id from public.credit_reservations cr left join public.build_jobs j on j.id = cr.build_id
           where cr.status = 'active' and ((j.id is null and cr.created_at < now() - interval '10 minutes') or j.status in ('succeeded', 'failed', 'cancelled') or cr.created_at < now() - interval '12 hours') loop
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

-- Platform spend caps: authorise before calling a provider.
create or replace function public.authorize_provider_spend(p_provider text, p_kind text, p_model text, p_estimate bigint, p_build uuid, p_user uuid, p_event_key text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare l record; v_spent bigint; v_from timestamptz; v_to timestamptz; v_id bigint;
begin
  perform pg_advisory_xact_lock(7364202);
  select id into v_id from public.provider_spend where event_key = p_event_key;
  if found then return v_id; end if;
  for l in select * from public.spend_limits where active and (provider is null or provider = p_provider) loop
    if l.period = 'day' then v_from := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'; v_to := v_from + interval '1 day';
    elsif l.period = 'month' then v_from := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'; v_to := v_from + interval '1 month';
    else v_from := l.window_start; v_to := l.window_end; if now() not between v_from and v_to then continue; end if;
    end if;
    select coalesce(sum(coalesce(actual_paise, estimated_paise)), 0) into v_spent from public.provider_spend
    where status <> 'voided' and created_at >= v_from and created_at < v_to and (l.provider is null or provider = l.provider);
    if v_spent + p_estimate > l.limit_paise then
      raise exception 'SPEND_LIMIT' using errcode = 'P0001', detail = l.name;
    end if;
  end loop;
  insert into public.provider_spend(provider, kind, model, build_id, user_id, estimated_paise, event_key)
  values (p_provider, p_kind, p_model, p_build, p_user, p_estimate, p_event_key) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.settle_provider_spend(p_id bigint, p_actual bigint, p_source text) returns void
language sql security definer set search_path = '' as $$
  update public.provider_spend set actual_paise = p_actual, cost_source = p_source, status = 'settled', settled_at = now()
  where id = p_id and status = 'authorized';
$$;

-- A request that failed before the provider accepted it costs nothing.
create or replace function public.void_provider_spend(p_id bigint) returns void
language sql security definer set search_path = '' as $$
  update public.provider_spend set status = 'voided', settled_at = now() where id = p_id and status = 'authorized';
$$;

-- Costs that cannot be pre-authorised per call (sandbox time, scrapes) are
-- recorded after the fact so caps still see them.
create or replace function public.record_provider_spend(p_provider text, p_kind text, p_model text, p_actual bigint, p_source text, p_build uuid, p_user uuid, p_event_key text)
returns void language sql security definer set search_path = '' as $$
  insert into public.provider_spend(provider, kind, model, build_id, user_id, estimated_paise, actual_paise, cost_source, status, event_key, settled_at)
  values (p_provider, p_kind, p_model, p_build, p_user, p_actual, p_actual, p_source, 'settled', p_event_key, now())
  on conflict (event_key) do nothing;
$$;

-- Staff credit operations -------------------------------------------------------------
create table if not exists public.staff_credit_limits (
  role public.staff_role primary key,
  max_per_grant bigint,
  max_per_day bigint
);
insert into public.staff_credit_limits(role, max_per_grant, max_per_day) values
  ('owner', null, null), ('billing', 5000, 20000), ('support', 200, 1000), ('operations', 0, 0), ('readonly', 0, 0)
on conflict (role) do nothing;
alter table public.staff_credit_limits enable row level security;
revoke all on public.staff_credit_limits from public, anon, authenticated;
grant select on public.staff_credit_limits to service_role, authenticated;
create policy staff_credit_limits_read on public.staff_credit_limits for select to authenticated using (private.has_staff_cap('credits.read'));

create table if not exists public.owner_testing_budget (
  id boolean primary key default true check (id),
  monthly_credit_cap bigint not null default 500 check (monthly_credit_cap >= 0)
);
insert into public.owner_testing_budget(id) values (true) on conflict do nothing;
alter table public.owner_testing_budget enable row level security;
revoke all on public.owner_testing_budget from public, anon, authenticated;
grant select on public.owner_testing_budget to service_role;

create or replace function public.admin_grant_credits(p_user uuid, p_amount bigint, p_source text, p_expires_at timestamptz, p_reason text, p_idempotency text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_role public.staff_role; lim public.staff_credit_limits; v_today bigint; v_id uuid; v_month bigint;
begin
  v_actor := private.assert_staff('credits.grant', 900);
  if p_source not in ('promotional', 'adjustment', 'owner_testing', 'refund_restore') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_amount <= 0 or char_length(trim(coalesce(p_reason, ''))) < 3 or char_length(coalesce(p_idempotency, '')) < 8 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'Expiry must be in the future'; end if;
  if exists (select 1 from public.credit_grants where idempotency_key = 'staff:' || p_idempotency) then raise exception 'DUPLICATE' using errcode = 'P0001'; end if;
  select role into v_role from public.staff_members where user_id = v_actor;
  -- Owner testing credits: owner only, to themselves, within an explicit monthly budget, always expiring.
  if p_source = 'owner_testing' then
    if v_role <> 'owner' or p_user <> v_actor then raise exception 'OWNER_ONLY' using errcode = 'P0001'; end if;
    if p_expires_at is null or p_expires_at > now() + interval '31 days' then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'Owner testing credits must expire within 31 days'; end if;
    select coalesce(sum(amount), 0) into v_month from public.credit_grants where user_id = v_actor and source = 'owner_testing' and created_at > now() - interval '30 days';
    if v_month + p_amount > (select monthly_credit_cap from public.owner_testing_budget) then raise exception 'LIMIT_EXCEEDED' using errcode = 'P0001'; end if;
  elsif p_user = v_actor then
    raise exception 'SELF_MODIFICATION' using errcode = 'P0001';
  end if;
  select * into lim from public.staff_credit_limits where role = v_role;
  select coalesce(sum(amount), 0) into v_today from public.credit_grants where created_by = v_actor and created_at > now() - interval '1 day';
  if p_amount > coalesce(lim.max_per_grant, p_amount) and not ('credits.adjust_large' = any (private.staff_capabilities(v_actor)) and v_role in ('owner', 'billing') and lim.max_per_grant is null) then
    raise exception 'LIMIT_EXCEEDED' using errcode = 'P0001';
  end if;
  if lim.max_per_day is not null and v_today + p_amount > lim.max_per_day then raise exception 'LIMIT_EXCEEDED' using errcode = 'P0001'; end if;
  v_id := public.grant_credits(p_user, p_source, p_amount, p_expires_at, p_reason, v_actor, 'staff:' || p_idempotency);
  perform private.audit(v_actor, 'staff', 'credits.granted', 'user', p_user::text, p_reason, null,
    jsonb_build_object('amount', p_amount, 'source', p_source, 'expires_at', p_expires_at, 'grant_id', v_id));
  return v_id;
end; $$;

create or replace function public.admin_debit_credits(p_user uuid, p_amount bigint, p_reason text, p_idempotency text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_left bigint := p_amount; g record; v_take bigint; v_alloc jsonb := '[]'::jsonb;
begin
  v_actor := private.assert_staff('credits.adjust_large', 900);
  perform private.assert_not_protected_target(v_actor, p_user);
  if p_amount <= 0 or char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.credit_ledger where event_key = 'staff-debit:' || p_idempotency) then raise exception 'DUPLICATE' using errcode = 'P0001'; end if;
  perform private.lock_credit_account(p_user);
  if private.credit_available(p_user) < p_amount then raise exception 'LIMIT_EXCEEDED' using errcode = 'P0001', detail = 'Cannot debit reserved or missing credits'; end if;
  for g in select id, remaining from public.credit_grants where user_id = p_user and remaining > 0 and (expires_at is null or expires_at > now())
           order by expires_at nulls last, created_at for update loop
    exit when v_left <= 0;
    v_take := least(v_left, g.remaining);
    update public.credit_grants set remaining = remaining - v_take where id = g.id;
    v_alloc := v_alloc || jsonb_build_array(jsonb_build_object('grant', g.id, 'amount', v_take));
    v_left := v_left - v_take;
  end loop;
  insert into public.credit_ledger(user_id, entry_type, amount, event_key, actor_id, reason, metadata)
  values (p_user, 'adjust_debit', -(p_amount - v_left), 'staff-debit:' || p_idempotency, v_actor, p_reason, jsonb_build_object('allocations', v_alloc));
  perform private.audit(v_actor, 'staff', 'credits.debited', 'user', p_user::text, p_reason, null, jsonb_build_object('amount', p_amount - v_left));
  return p_amount - v_left;
end; $$;

create or replace function public.admin_set_spend_limit(p_id uuid, p_name text, p_provider text, p_period text, p_limit_paise bigint,
  p_warn integer, p_active boolean, p_window_start timestamptz, p_window_end timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_before jsonb; v_id uuid := p_id;
begin
  v_actor := private.assert_staff('providers.manage', 900);
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if v_id is null then
    insert into public.spend_limits(name, provider, period, limit_paise, warn_at_percent, active, window_start, window_end, created_by)
    values (left(p_name, 120), nullif(p_provider, ''), p_period, p_limit_paise, coalesce(p_warn, 80), coalesce(p_active, true), p_window_start, p_window_end, v_actor)
    returning id into v_id;
  else
    select to_jsonb(s) into v_before from public.spend_limits s where id = v_id for update;
    if v_before is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
    update public.spend_limits set name = left(p_name, 120), provider = nullif(p_provider, ''), period = p_period, limit_paise = p_limit_paise,
      warn_at_percent = coalesce(p_warn, 80), active = coalesce(p_active, true), window_start = p_window_start, window_end = p_window_end where id = v_id;
  end if;
  perform private.audit(v_actor, 'staff', 'spend_limit.saved', 'spend_limit', v_id::text, p_reason, v_before,
    (select to_jsonb(s) from public.spend_limits s where id = v_id));
  return v_id;
end; $$;

do $$ declare f text; begin
  foreach f in array array[
    'grant_credits(uuid,text,bigint,timestamptz,text,uuid,text,uuid,uuid)', 'reserve_credits(uuid,uuid,uuid,bigint,integer)',
    'ensure_reservation_headroom(uuid,bigint)', 'consume_credits(uuid,bigint,text,text,text,bigint,text,jsonb)', 'settle_reservation(uuid,text)',
    'reconcile_credits()', 'authorize_provider_spend(text,text,text,bigint,uuid,uuid,text)', 'settle_provider_spend(bigint,bigint,text)',
    'void_provider_spend(bigint)', 'record_provider_spend(text,text,text,bigint,text,uuid,uuid,text)', 'credit_balance(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['my_credit_balance()', 'admin_grant_credits(uuid,bigint,text,timestamptz,text,text)', 'admin_debit_credits(uuid,bigint,text,text)',
    'admin_set_spend_limit(uuid,text,text,text,bigint,integer,boolean,timestamptz,timestamptz,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function private.lock_credit_account(uuid) from public;
revoke all on function private.credit_available(uuid) from public;
