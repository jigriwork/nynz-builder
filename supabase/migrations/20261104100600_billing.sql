-- NYNZ release 0.3, part 7: plans, subscriptions, payments and expenses.
--
-- Money is stored in integer minor units (paise). Collected tax is stored
-- separately from revenue (net_minor). A subscription is never activated from
-- a browser callback: only signed, deduplicated provider webhooks (or a
-- server-side reconciliation against the provider API) change its status.
-- No GSTIN, legal entity or invoice details are stored or invented here.

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  version integer not null default 1,
  name text not null,
  description text,
  price_minor bigint not null check (price_minor >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  tax_rate_bps integer not null default 1800 check (tax_rate_bps between 0 and 5000),
  billing_interval text not null default 'month' check (billing_interval = 'month'),
  monthly_credits bigint not null default 0 check (monthly_credits >= 0),
  max_concurrent_builds integer not null default 1 check (max_concurrent_builds between 1 and 20),
  max_projects integer not null default 3 check (max_projects between 1 and 1000),
  features jsonb not null default '[]'::jsonb,
  provider_plan_id text,
  public boolean not null default true,
  effective_from timestamptz not null default now(),
  retired_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (code, version)
);
create unique index if not exists plans_one_current on public.plans(code) where retired_at is null;

-- Allowance assumptions are documented in docs/BILLING.md. Credits are ₹1 of
-- measured provider cost each (PAISE_PER_CREDIT=100), so Starter's 400 credits
-- cap provider spend at roughly 40% of its ex-GST price.
insert into public.plans(code, name, description, price_minor, monthly_credits, max_concurrent_builds, max_projects, features, public) values
  ('free', 'Free', 'Explore NYNZ with a small trial allowance.', 0, 0, 1, 3, '["Trial credits for new accounts","Private previews","Source export"]', true),
  ('starter', 'Starter', 'For individuals building and iterating on a few apps.', 99900, 400, 1, 10, '["400 credits each month","1 build at a time","Up to 10 projects","Private previews","Source export"]', true),
  ('pro', 'Pro', 'For founders and teams shipping more often.', 149900, 650, 2, 30, '["650 credits each month","2 builds at a time","Up to 30 projects","Private previews","Source export","Priority support"]', true)
on conflict (code, version) do nothing;

create table if not exists public.topup_packs (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  credits bigint not null check (credits > 0),
  price_minor bigint not null check (price_minor > 0),
  tax_rate_bps integer not null default 1800,
  credit_validity_days integer not null default 365,
  active boolean not null default false
);
-- Inactive until the owner reviews and sets the price.
insert into public.topup_packs(code, name, credits, price_minor, active) values ('credits_100', '100 credits', 100, 19900, false) on conflict do nothing;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  plan_id uuid not null references public.plans(id),
  provider text not null default 'razorpay' check (provider = 'razorpay'),
  provider_subscription_id text unique,
  status text not null default 'created' check (status in ('created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired', 'paused')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_until timestamptz,
  scheduled_plan_id uuid references public.plans(id),
  checkout_verified_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists subscriptions_one_open on public.subscriptions(user_id) where status in ('created', 'authenticated', 'active', 'pending', 'paused');

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete restrict,
  subscription_id uuid references public.subscriptions(id),
  topup_order_id uuid,
  provider text not null default 'razorpay',
  provider_payment_id text not null unique,
  provider_order_id text,
  provider_invoice_id text,
  kind text not null check (kind in ('subscription', 'topup')),
  amount_minor bigint not null check (amount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  net_minor bigint not null check (net_minor >= 0),
  fee_minor bigint,
  currency text not null default 'INR',
  status text not null check (status in ('authorized', 'captured', 'failed', 'refunded', 'partially_refunded')),
  method text,
  refunded_minor bigint not null default 0,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  check (tax_minor + net_minor = amount_minor)
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  provider_refund_id text unique,
  amount_minor bigint not null check (amount_minor > 0),
  status text not null default 'requested' check (status in ('requested', 'processed', 'failed')),
  reason text not null,
  reverse_credits boolean not null default false,
  credits_reversed bigint not null default 0,
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  provider text not null default 'razorpay',
  event_id text not null unique,
  event_type text not null,
  event_created_at timestamptz,
  received_at timestamptz not null default now(),
  outcome text,
  detail jsonb not null default '{}'::jsonb
);

create table if not exists public.topup_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  pack_code text not null references public.topup_packs(code),
  provider_order_id text unique,
  amount_minor bigint not null,
  tax_minor bigint not null,
  credits bigint not null,
  status text not null default 'created' check (status in ('created', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.company_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('provider', 'hosting', 'database', 'domain', 'email', 'monitoring', 'payments', 'support', 'tax', 'other')),
  vendor text not null,
  description text,
  amount_minor bigint not null check (amount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  currency text not null default 'INR',
  incurred_on date not null,
  period_start date,
  period_end date,
  recorded_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.provider_balance_snapshots (
  id bigint generated always as identity primary key,
  provider text not null,
  balance_amount numeric,
  balance_currency text,
  usage_amount numeric,
  quota jsonb,
  source text not null check (source in ('api', 'manual')),
  as_of timestamptz not null default now(),
  entered_by uuid,
  note text
);

do $$ declare t text; begin
  foreach t in array array['plans','topup_packs','subscriptions','payments','refunds','payment_events','topup_orders','company_expenses','provider_balance_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
end $$;
grant insert, update on public.subscriptions, public.topup_orders, public.provider_balance_snapshots to service_role;
grant select on public.plans, public.topup_packs, public.subscriptions, public.payments, public.refunds to authenticated;
create policy plans_public_read on public.plans for select to authenticated using ((public and retired_at is null) or private.has_staff_cap('billing.read'));
create policy topup_packs_read on public.topup_packs for select to authenticated using (active or private.has_staff_cap('billing.read'));
create policy subscriptions_own on public.subscriptions for select to authenticated using (user_id = auth.uid() or private.has_staff_cap('billing.read'));
create policy payments_own on public.payments for select to authenticated using (user_id = auth.uid() or private.has_staff_cap('billing.read'));
create policy refunds_own on public.refunds for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id and p.user_id = auth.uid()) or private.has_staff_cap('billing.read'));

-- Entitlements --------------------------------------------------------------------
create or replace function public.current_entitlements(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with sub as (
    select s.*, p.code, p.name, p.max_concurrent_builds, p.max_projects, p.features from public.subscriptions s join public.plans p on p.id = s.plan_id
    where s.user_id = p_user and (
      s.status = 'active'
      or (s.status = 'pending' and s.grace_until > now())
      or (s.status in ('cancelled', 'authenticated') and s.current_period_end > now())
    )
    order by s.current_period_end desc nulls last limit 1
  ), free as (select * from public.plans where code = 'free' and retired_at is null limit 1)
  select case when exists (select 1 from sub) then
    (select jsonb_build_object('plan_code', code, 'plan_name', name, 'subscription_status', status, 'max_concurrent_builds', max_concurrent_builds,
      'max_projects', max_projects, 'features', features, 'current_period_end', current_period_end, 'cancel_at_period_end', cancel_at_period_end,
      'grace_until', grace_until) from sub)
  else
    (select jsonb_build_object('plan_code', 'free', 'plan_name', coalesce(name, 'Free'), 'subscription_status', null,
      'max_concurrent_builds', coalesce(max_concurrent_builds, 1), 'max_projects', coalesce(max_projects, 3), 'features', coalesce(features, '[]'::jsonb)) from (select 1) one left join free on true)
  end;
$$;
create or replace function public.my_entitlements() returns jsonb language sql stable security definer set search_path = '' as $$ select public.current_entitlements(auth.uid()); $$;

-- Split a tax-inclusive charge into tax and revenue using the plan's rate.
create or replace function private.split_tax(p_amount bigint, p_rate_bps integer) returns table(net bigint, tax bigint)
language sql immutable set search_path = '' as $$
  select round(p_amount * 10000.0 / (10000 + p_rate_bps))::bigint, p_amount - round(p_amount * 10000.0 / (10000 + p_rate_bps))::bigint;
$$;

create or replace function public.create_pending_subscription(p_user uuid, p_plan_code text, p_provider_subscription_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_plan uuid; v_id uuid;
begin
  select id into v_plan from public.plans where code = p_plan_code and retired_at is null and price_minor > 0;
  if v_plan is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  -- Abandoned checkouts (still "created") are superseded.
  update public.subscriptions set status = 'expired', updated_at = now() where user_id = p_user and status = 'created';
  insert into public.subscriptions(user_id, plan_id, provider_subscription_id) values (p_user, v_plan, p_provider_subscription_id) returning id into v_id;
  return v_id;
end; $$;

-- Applies one verified subscription webhook. Idempotent by event id; status
-- changes are ordered by the provider's event time so late deliveries cannot
-- move a subscription backwards. Payments and period credits are keyed by
-- provider ids, so they are applied exactly once regardless of order.
create or replace function public.apply_subscription_event(p_event_id text, p_event_type text, p_event_created_at timestamptz, p_subscription jsonb, p_payment jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions; pl public.plans; v_status text; v_start timestamptz; v_end timestamptz; v_payment uuid; v_split record; v_new_plan uuid; v_outcome text;
begin
  insert into public.payment_events(event_id, event_type, event_created_at) values (p_event_id, p_event_type, p_event_created_at) on conflict (event_id) do nothing;
  if not found then return 'duplicate'; end if;
  select * into s from public.subscriptions where provider_subscription_id = p_subscription->>'id' for update;
  if not found then
    update public.payment_events set outcome = 'unknown_subscription' where event_id = p_event_id;
    return 'unknown_subscription';
  end if;
  v_start := to_timestamp(nullif(p_subscription->>'current_start', '')::double precision);
  v_end := to_timestamp(nullif(p_subscription->>'current_end', '')::double precision);
  select * into pl from public.plans where id = s.plan_id;

  -- Plan changes take effect when the provider reports them.
  if p_subscription ? 'plan_id' then
    select id into v_new_plan from public.plans where provider_plan_id = p_subscription->>'plan_id' order by version desc limit 1;
    if v_new_plan is not null and v_new_plan <> s.plan_id then
      update public.subscriptions set plan_id = v_new_plan, scheduled_plan_id = null where id = s.id;
      select * into pl from public.plans where id = v_new_plan;
    end if;
  end if;

  if p_payment is not null and p_payment ? 'id' then
    select * into v_split from private.split_tax((p_payment->>'amount')::bigint, pl.tax_rate_bps);
    insert into public.payments(user_id, subscription_id, provider_payment_id, provider_order_id, provider_invoice_id, kind, amount_minor, tax_minor, net_minor, fee_minor, status, method, captured_at)
    values (s.user_id, s.id, p_payment->>'id', p_payment->>'order_id', p_payment->>'invoice_id', 'subscription', (p_payment->>'amount')::bigint, v_split.tax, v_split.net,
      nullif(p_payment->>'fee', '')::bigint, case when p_payment->>'status' = 'captured' then 'captured' when p_payment->>'status' = 'failed' then 'failed' else 'authorized' end,
      p_payment->>'method', case when p_payment->>'status' = 'captured' then to_timestamp((p_payment->>'created_at')::double precision) end)
    on conflict (provider_payment_id) do update set status = case when public.payments.status in ('refunded', 'partially_refunded') then public.payments.status else excluded.status end,
      captured_at = coalesce(public.payments.captured_at, excluded.captured_at)
    returning id into v_payment;
  end if;

  v_status := case p_event_type
    when 'subscription.authenticated' then 'authenticated' when 'subscription.activated' then 'active' when 'subscription.charged' then 'active'
    when 'subscription.resumed' then 'active' when 'subscription.pending' then 'pending' when 'subscription.halted' then 'halted'
    when 'subscription.cancelled' then 'cancelled' when 'subscription.completed' then 'completed' when 'subscription.paused' then 'paused'
    when 'subscription.expired' then 'expired' else null end;

  if v_status is not null and (s.last_event_at is null or p_event_created_at >= s.last_event_at) then
    update public.subscriptions set status = v_status, last_event_at = p_event_created_at, updated_at = now(),
      current_period_start = coalesce(v_start, current_period_start), current_period_end = coalesce(v_end, current_period_end),
      grace_until = case when v_status = 'pending' then coalesce(v_end, current_period_end, now()) + interval '3 days' when v_status = 'active' then null else grace_until end,
      cancel_at_period_end = case when v_status in ('cancelled', 'completed') then false else cancel_at_period_end end
    where id = s.id;
    v_outcome := 'applied';
  else
    -- Older event: keep newer state, but never lose a later billing period.
    update public.subscriptions set current_period_end = greatest(current_period_end, v_end), updated_at = now() where id = s.id and v_end is not null and p_event_type = 'subscription.charged';
    v_outcome := case when v_status is null then 'recorded' else 'stale_ignored' end;
  end if;

  -- One credit grant per paid billing period.
  if p_event_type = 'subscription.charged' and p_payment ->> 'status' = 'captured' and v_start is not null and pl.monthly_credits > 0 then
    perform public.grant_credits(s.user_id, 'plan_included', pl.monthly_credits, coalesce(v_end, v_start + interval '1 month'),
      pl.name || ' monthly allowance', null, 'sub:' || s.id || ':' || extract(epoch from v_start)::bigint, s.id, v_payment);
  end if;
  update public.payment_events set outcome = v_outcome, detail = jsonb_build_object('subscription', s.id, 'status', v_status) where event_id = p_event_id;
  perform private.audit(null, 'provider', 'billing.' || p_event_type, 'subscription', s.id::text, null, jsonb_build_object('status', s.status),
    jsonb_build_object('status', coalesce(v_status, s.status), 'outcome', v_outcome), jsonb_build_object('event_id', p_event_id));
  return v_outcome;
end; $$;

create or replace function public.create_topup_order(p_user uuid, p_pack text, p_provider_order_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare pk public.topup_packs; v_id uuid;
begin
  select * into pk from public.topup_packs where code = p_pack and active;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  insert into public.topup_orders(user_id, pack_code, provider_order_id, amount_minor, tax_minor, credits)
  values (p_user, p_pack, p_provider_order_id, pk.price_minor + round(pk.price_minor * pk.tax_rate_bps / 10000.0)::bigint, round(pk.price_minor * pk.tax_rate_bps / 10000.0)::bigint, pk.credits)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.apply_topup_payment(p_event_id text, p_event_type text, p_event_created_at timestamptz, p_payment jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare o public.topup_orders; pk public.topup_packs; v_payment uuid;
begin
  insert into public.payment_events(event_id, event_type, event_created_at) values (p_event_id, p_event_type, p_event_created_at) on conflict (event_id) do nothing;
  if not found then return 'duplicate'; end if;
  select * into o from public.topup_orders where provider_order_id = p_payment->>'order_id' for update;
  if not found then update public.payment_events set outcome = 'unknown_order' where event_id = p_event_id; return 'unknown_order'; end if;
  if (p_payment->>'amount')::bigint <> o.amount_minor then
    update public.payment_events set outcome = 'amount_mismatch' where event_id = p_event_id; return 'amount_mismatch';
  end if;
  insert into public.payments(user_id, topup_order_id, provider_payment_id, provider_order_id, kind, amount_minor, tax_minor, net_minor, fee_minor, status, method, captured_at)
  values (o.user_id, o.id, p_payment->>'id', o.provider_order_id, 'topup', o.amount_minor, o.tax_minor, o.amount_minor - o.tax_minor, nullif(p_payment->>'fee', '')::bigint,
    case when p_payment->>'status' = 'captured' then 'captured' when p_payment->>'status' = 'failed' then 'failed' else 'authorized' end, p_payment->>'method',
    case when p_payment->>'status' = 'captured' then now() end)
  on conflict (provider_payment_id) do update set status = case when public.payments.status in ('refunded', 'partially_refunded') then public.payments.status else excluded.status end
  returning id into v_payment;
  if p_payment->>'status' = 'captured' and o.status <> 'paid' then
    select * into pk from public.topup_packs where code = o.pack_code;
    update public.topup_orders set status = 'paid', paid_at = now() where id = o.id;
    perform public.grant_credits(o.user_id, 'purchased', o.credits, now() + make_interval(days => pk.credit_validity_days), 'Credit top-up', null, 'topup:' || o.id, null, v_payment);
  elsif p_payment->>'status' = 'failed' and o.status = 'created' then
    update public.topup_orders set status = 'failed' where id = o.id;
  end if;
  update public.payment_events set outcome = 'applied' where event_id = p_event_id;
  return 'applied';
end; $$;

create or replace function public.apply_refund_event(p_event_id text, p_event_created_at timestamptz, p_refund jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare p public.payments; r public.refunds;
begin
  insert into public.payment_events(event_id, event_type, event_created_at) values (p_event_id, 'refund.processed', p_event_created_at) on conflict (event_id) do nothing;
  if not found then return 'duplicate'; end if;
  select * into p from public.payments where provider_payment_id = p_refund->>'payment_id' for update;
  if not found then update public.payment_events set outcome = 'unknown_payment' where event_id = p_event_id; return 'unknown_payment'; end if;
  select * into r from public.refunds where provider_refund_id = p_refund->>'id' for update;
  if not found then
    insert into public.refunds(payment_id, provider_refund_id, amount_minor, status, reason, requested_by, processed_at)
    values (p.id, p_refund->>'id', (p_refund->>'amount')::bigint, 'processed', 'Refund issued at provider', '00000000-0000-0000-0000-000000000000', now())
    returning * into r;
  elsif r.status <> 'processed' then
    update public.refunds set status = 'processed', processed_at = now() where id = r.id;
  else
    update public.payment_events set outcome = 'already_processed' where event_id = p_event_id; return 'already_processed';
  end if;
  update public.payments set refunded_minor = least(amount_minor, refunded_minor + r.amount_minor),
    status = case when refunded_minor + r.amount_minor >= amount_minor then 'refunded' else 'partially_refunded' end where id = p.id;
  update public.payment_events set outcome = 'applied' where event_id = p_event_id;
  perform private.audit(null, 'provider', 'billing.refund.processed', 'payment', p.id::text, null, null, jsonb_build_object('amount_minor', r.amount_minor), jsonb_build_object('event_id', p_event_id));
  return 'applied';
end; $$;

-- Staff billing operations -----------------------------------------------------------
create or replace function public.admin_request_refund(p_payment uuid, p_amount bigint, p_reason text, p_reverse_credits boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; p public.payments; v_id uuid; v_pending bigint;
begin
  v_actor := private.assert_staff('billing.refund', 300);
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  select * into p from public.payments where id = p_payment for update;
  if not found or p.status not in ('captured', 'partially_refunded') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  select coalesce(sum(amount_minor), 0) into v_pending from public.refunds where payment_id = p.id and status in ('requested', 'processed');
  if p_amount <= 0 or p_amount + v_pending > p.amount_minor then raise exception 'LIMIT_EXCEEDED' using errcode = 'P0001'; end if;
  perform private.assert_not_protected_target(v_actor, p.user_id);
  insert into public.refunds(payment_id, amount_minor, reason, reverse_credits, requested_by) values (p.id, p_amount, left(p_reason, 500), coalesce(p_reverse_credits, false), v_actor) returning id into v_id;
  perform private.audit(v_actor, 'staff', 'billing.refund.requested', 'payment', p.id::text, p_reason, null, jsonb_build_object('amount_minor', p_amount, 'refund_id', v_id, 'reverse_credits', p_reverse_credits));
  return v_id;
end; $$;

-- Called by the server after the provider refund API responds.
create or replace function public.record_refund_submission(p_refund uuid, p_provider_refund_id text, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.refunds; v_left bigint; g record; v_take bigint; v_reversed bigint := 0; v_user uuid;
begin
  select * into r from public.refunds where id = p_refund for update;
  if not found or r.status <> 'requested' then return; end if;
  if not p_ok then
    update public.refunds set status = 'failed', error = left(p_error, 500) where id = r.id;
    perform private.audit(r.requested_by, 'staff', 'billing.refund.failed', 'refund', r.id::text, null, null, jsonb_build_object('error', left(p_error, 200)), '{}'::jsonb, 'failed');
    return;
  end if;
  update public.refunds set provider_refund_id = p_provider_refund_id where id = r.id;
  if r.reverse_credits then
    select user_id into v_user from public.payments where id = r.payment_id;
    perform private.lock_credit_account(v_user);
    v_left := (select coalesce(sum(remaining), 0) from public.credit_grants where payment_id = r.payment_id);
    for g in select id, remaining from public.credit_grants where payment_id = r.payment_id and remaining > 0 for update loop
      v_take := g.remaining;
      update public.credit_grants set remaining = 0 where id = g.id;
      v_reversed := v_reversed + v_take;
    end loop;
    if v_reversed > 0 then
      insert into public.credit_ledger(user_id, entry_type, amount, actor_id, reason, metadata)
      values (v_user, 'adjust_debit', -v_reversed, r.requested_by, 'Unused credits reversed with refund', jsonb_build_object('refund_id', r.id));
      update public.refunds set credits_reversed = v_reversed where id = r.id;
    end if;
  end if;
  perform private.audit(r.requested_by, 'staff', 'billing.refund.submitted', 'refund', r.id::text, null, null, jsonb_build_object('credits_reversed', v_reversed));
end; $$;

create or replace function public.admin_record_expense(p_category text, p_vendor text, p_description text, p_amount bigint, p_tax bigint, p_incurred_on date, p_period_start date, p_period_end date, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_id uuid;
begin
  v_actor := private.assert_staff('expenses.manage', 900);
  insert into public.company_expenses(category, vendor, description, amount_minor, tax_minor, incurred_on, period_start, period_end, recorded_by)
  values (p_category, left(p_vendor, 120), left(p_description, 500), p_amount, coalesce(p_tax, 0), p_incurred_on, p_period_start, p_period_end, v_actor) returning id into v_id;
  perform private.audit(v_actor, 'staff', 'expense.recorded', 'expense', v_id::text, p_reason, null, jsonb_build_object('category', p_category, 'vendor', p_vendor, 'amount_minor', p_amount));
  return v_id;
end; $$;

create or replace function public.admin_record_provider_balance(p_provider text, p_balance numeric, p_currency text, p_as_of timestamptz, p_note text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_id bigint;
begin
  v_actor := private.assert_staff('expenses.manage', 900);
  if p_as_of > now() + interval '1 hour' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  insert into public.provider_balance_snapshots(provider, balance_amount, balance_currency, source, as_of, entered_by, note)
  values (left(p_provider, 40), p_balance, upper(left(p_currency, 3)), 'manual', p_as_of, v_actor, left(p_note, 500)) returning id into v_id;
  perform private.audit(v_actor, 'staff', 'provider_balance.recorded', 'provider', p_provider, p_note, null, jsonb_build_object('balance', p_balance, 'currency', p_currency, 'as_of', p_as_of));
  return v_id;
end; $$;

-- New plan versions never rewrite an existing version's price.
create or replace function public.admin_save_plan(p_code text, p_name text, p_description text, p_price_minor bigint, p_tax_rate_bps integer, p_monthly_credits bigint,
  p_max_concurrent integer, p_max_projects integer, p_features jsonb, p_public boolean, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; old public.plans; v_id uuid;
begin
  v_actor := private.assert_staff('plans.manage', 300);
  select * into old from public.plans where code = p_code and retired_at is null for update;
  update public.plans set retired_at = now() where id = old.id;
  insert into public.plans(code, version, name, description, price_minor, tax_rate_bps, monthly_credits, max_concurrent_builds, max_projects, features, public, provider_plan_id, created_by)
  values (p_code, coalesce(old.version, 0) + 1, p_name, p_description, p_price_minor, p_tax_rate_bps, p_monthly_credits, p_max_concurrent, p_max_projects, coalesce(p_features, '[]'::jsonb), p_public,
    case when old.price_minor = p_price_minor and old.tax_rate_bps = p_tax_rate_bps then old.provider_plan_id end, v_actor)
  returning id into v_id;
  perform private.audit(v_actor, 'staff', 'plan.version_created', 'plan', v_id::text, p_reason, to_jsonb(old), (select to_jsonb(p) from public.plans p where id = v_id));
  return v_id;
end; $$;

create or replace function public.admin_set_plan_provider_id(p_plan uuid, p_provider_plan_id text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := private.assert_staff('plans.manage', 300);
  if p_provider_plan_id !~ '^plan_[A-Za-z0-9]{14}$' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  update public.plans set provider_plan_id = p_provider_plan_id where id = p_plan and retired_at is null;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform private.audit(v_actor, 'staff', 'plan.provider_linked', 'plan', p_plan::text, p_reason, null, jsonb_build_object('provider_plan_id', p_provider_plan_id));
end; $$;

create or replace function public.admin_set_topup_pack(p_code text, p_name text, p_credits bigint, p_price_minor bigint, p_active boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_before jsonb;
begin
  v_actor := private.assert_staff('plans.manage', 300);
  select to_jsonb(t) into v_before from public.topup_packs t where code = p_code;
  insert into public.topup_packs(code, name, credits, price_minor, active) values (p_code, p_name, p_credits, p_price_minor, p_active)
  on conflict (code) do update set name = excluded.name, credits = excluded.credits, price_minor = excluded.price_minor, active = excluded.active;
  perform private.audit(v_actor, 'staff', 'topup_pack.saved', 'topup_pack', p_code, p_reason, v_before, (select to_jsonb(t) from public.topup_packs t where code = p_code));
end; $$;

do $$ declare f text; begin
  foreach f in array array[
    'current_entitlements(uuid)', 'create_pending_subscription(uuid,text,text)', 'apply_subscription_event(text,text,timestamptz,jsonb,jsonb)',
    'create_topup_order(uuid,text,text)', 'apply_topup_payment(text,text,timestamptz,jsonb)', 'apply_refund_event(text,timestamptz,jsonb)',
    'record_refund_submission(uuid,text,boolean,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['my_entitlements()', 'admin_request_refund(uuid,bigint,text,boolean)',
    'admin_record_expense(text,text,text,bigint,bigint,date,date,date,text)', 'admin_record_provider_balance(text,numeric,text,timestamptz,text)',
    'admin_save_plan(text,text,text,bigint,integer,bigint,integer,integer,jsonb,boolean,text)', 'admin_set_plan_provider_id(uuid,text,text)',
    'admin_set_topup_pack(text,text,bigint,bigint,boolean,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function private.split_tax(bigint, integer) from public;
