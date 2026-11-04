-- NYNZ release 0.3, part 2: account state, suspension, rate limits, activity.
-- Suspension is enforced in the database (RLS helper, sandbox authorisation,
-- queue claiming), not only by hiding UI.

create table if not exists public.account_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  reason text check (reason is null or char_length(reason) <= 1000),
  changed_by uuid,
  changed_at timestamptz not null default now()
);
alter table public.account_status enable row level security;
revoke all on public.account_status from public, anon, authenticated;
grant select, insert, update on public.account_status to service_role;
create policy account_status_self_read on public.account_status for select to authenticated using (user_id = auth.uid());
grant select on public.account_status to authenticated;

create or replace function private.account_active(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.account_status where user_id = p_user and status = 'suspended');
$$;
revoke all on function private.account_active(uuid) from public;
grant execute on function private.account_active(uuid) to authenticated, service_role;

-- Every owner policy goes through this helper, so suspension blocks customer
-- reads and writes of projects, files, conversations, versions, jobs,
-- imports, backend connections and storage objects at once.
create or replace function private.is_project_owner(target_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects where id = target_project_id and owner_id = auth.uid())
     and private.account_active(auth.uid());
$$;
alter policy projects_owner_all on public.projects
  using (owner_id = auth.uid() and private.account_active(auth.uid()))
  with check (owner_id = auth.uid() and private.account_active(auth.uid()));

create or replace function public.authorize_sandbox_access(p_project uuid, p_user uuid)
returns table(sandbox_id text, resource_id uuid) language plpgsql security definer set search_path = '' as $$
begin
  if not private.account_active(p_user) then return; end if;
  return query
  update public.platform_resources r set last_accessed_at = now()
  from public.projects p
  where p.id = p_project and p.owner_id = p_user and p.status <> 'archived'
    and p.active_sandbox_id is not null
    and r.kind = 'e2b_sandbox' and r.provider_ref = p.active_sandbox_id
    and r.project_id = p.id and r.owner_id = p.owner_id
    and r.state in ('active', 'paused')
  returning r.provider_ref, r.id;
end; $$;

-- Queued work for suspended accounts is cancelled instead of claimed.
create or replace function public.claim_build_job(worker_name text) returns setof public.build_jobs
language plpgsql security definer set search_path = '' as $$
begin
  update public.build_jobs j set status = 'cancelled', finished_at = now(), error_code = 'ACCOUNT_SUSPENDED',
    error_message = 'This request was cancelled because the account is suspended.'
  where j.status = 'queued' and not private.account_active(j.requested_by);
  return query update public.build_jobs j set status = 'planning', locked_at = now(), locked_by = worker_name,
    started_at = coalesce(started_at, now()), attempt_count = attempt_count + 1
  where j.id = (
    select q.id from public.build_jobs q
    where q.status = 'queued' and q.cancel_requested_at is null and private.account_active(q.requested_by)
    order by q.created_at for update skip locked limit 1
  ) returning j.*;
end; $$;
revoke all on function public.claim_build_job(text) from public, anon, authenticated;
grant execute on function public.claim_build_job(text) to service_role;

-- Fixed-window rate limits, consumed atomically by the server.
create table if not exists public.rate_limit_buckets (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limit_buckets to service_role;

create or replace function public.consume_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns table(allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare v_start timestamptz; v_hits integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then raise exception 'INVALID_LIMIT' using errcode = 'P0001'; end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_buckets(bucket, window_start, hits) values (left(p_bucket, 200), v_start, 1)
  on conflict (bucket, window_start) do update set hits = public.rate_limit_buckets.hits + 1
  returning hits into v_hits;
  -- Opportunistic cleanup of old windows keeps the table small.
  if random() < 0.01 then delete from public.rate_limit_buckets where window_start < now() - interval '2 days'; end if;
  return query select v_hits <= p_limit, greatest(p_limit - v_hits, 0),
    case when v_hits <= p_limit then 0 else ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now())))::integer end;
end; $$;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- Last activity (meaningful actions) is kept separate from approximate
-- presence (a heartbeat while a NYNZ tab is visible). Neither is a guarantee
-- that a person is at the keyboard.
create table if not exists public.user_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_activity_at timestamptz,
  last_presence_at timestamptz,
  last_activity_kind text
);
alter table public.user_activity enable row level security;
revoke all on public.user_activity from public, anon, authenticated;
grant select, insert, update on public.user_activity to service_role;

create or replace function public.record_presence() returns void
language sql security definer set search_path = '' as $$
  insert into public.user_activity(user_id, last_presence_at) values (auth.uid(), now())
  on conflict (user_id) do update set last_presence_at = now()
  where public.user_activity.last_presence_at is null or public.user_activity.last_presence_at < now() - interval '30 seconds';
$$;
revoke all on function public.record_presence() from public, anon;
grant execute on function public.record_presence() to authenticated;

create or replace function public.record_activity(p_user uuid, p_kind text) returns void
language sql security definer set search_path = '' as $$
  insert into public.user_activity(user_id, last_activity_at, last_activity_kind) values (p_user, now(), left(p_kind, 60))
  on conflict (user_id) do update set last_activity_at = now(), last_activity_kind = left(p_kind, 60);
$$;
revoke all on function public.record_activity(uuid, text) from public, anon, authenticated;
grant execute on function public.record_activity(uuid, text) to service_role;

-- What the signed-in customer may know about their own account state.
create or replace function public.my_account_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', coalesce((select status from public.account_status where user_id = auth.uid()), 'active'),
    'reason', (select reason from public.account_status where user_id = auth.uid() and status = 'suspended')
  );
$$;
revoke all on function public.my_account_state() from public, anon;
grant execute on function public.my_account_state() to authenticated;
