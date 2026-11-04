-- NYNZ release 0.3, part 6: worker readiness, resource reconciliation and
-- staff-triggered maintenance.

-- The worker advertises what it can actually do; the build API refuses work
-- (before reserving credits) unless a fresh, ready worker exists.
alter table public.worker_heartbeats add column if not exists capabilities jsonb not null default '{}'::jsonb;

create or replace function public.generation_ready(p_max_age_seconds integer default 90) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.worker_heartbeats
    where status in ('idle', 'working') and last_seen_at > now() - make_interval(secs => p_max_age_seconds)
      and coalesce((capabilities->>'generation')::boolean, false) and coalesce((capabilities->>'sandbox')::boolean, false)
  );
$$;
revoke all on function public.generation_ready(integer) from public, anon, authenticated;
grant execute on function public.generation_ready(integer) to service_role;

create table if not exists public.maintenance_runs (
  id bigint generated always as identity primary key,
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  error text,
  requested_by uuid
);
create table if not exists public.maintenance_requests (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('reconcile')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  picked_at timestamptz,
  run_id bigint
);
alter table public.maintenance_runs enable row level security;
alter table public.maintenance_requests enable row level security;
revoke all on public.maintenance_runs, public.maintenance_requests from public, anon, authenticated;
grant select, insert, update on public.maintenance_runs, public.maintenance_requests to service_role;

create or replace function public.admin_request_maintenance(p_kind text, p_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_id bigint;
begin
  v_actor := private.assert_staff('operations.cleanup');
  insert into public.maintenance_requests(kind, requested_by) values (p_kind, v_actor) returning id into v_id;
  perform private.audit(v_actor, 'staff', 'maintenance.requested', 'maintenance', v_id::text, p_reason, null, jsonb_build_object('kind', p_kind));
  return v_id;
end; $$;
revoke all on function public.admin_request_maintenance(text, text) from public, anon;
grant execute on function public.admin_request_maintenance(text, text) to authenticated;

-- Detach previews nobody has opened for p_days and queue their sandboxes for
-- termination. Source and versions are untouched; the owner restarts the
-- preview when they return.
create or replace function public.retire_idle_previews(p_days integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_count integer := 0;
begin
  if p_days < 1 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  for r in
    select res.id, res.provider_ref, res.project_id from public.platform_resources res
    where res.kind = 'e2b_sandbox' and res.state in ('active', 'paused')
      and coalesce(res.last_accessed_at, res.created_at) < now() - make_interval(days => p_days)
      and not exists (select 1 from public.build_jobs j where j.project_id = res.project_id and j.status in ('queued','planning','generating','installing','running','validating'))
    for update of res skip locked
  loop
    update public.projects set active_sandbox_id = null, status = 'draft', preview_revision = null,
      last_error = 'The preview was paused after a period of inactivity. Restart the preview to continue.'
    where id = r.project_id and active_sandbox_id = r.provider_ref;
    update public.platform_resources set state = 'terminating', terminate_requested_at = now(), terminate_reason = 'inactive' where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;

-- Provisioning records whose build has ended (or that never progressed) are
-- queued for termination.
create or replace function public.retire_stale_provisioning(p_minutes integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.platform_resources res set state = 'terminating', terminate_requested_at = now(), terminate_reason = 'stale provisioning'
  where res.kind = 'e2b_sandbox' and res.state = 'provisioning' and res.created_at < now() - make_interval(mins => p_minutes)
    and not exists (select 1 from public.projects p where p.active_sandbox_id = res.provider_ref)
    and not exists (select 1 from public.build_jobs j where j.id = res.build_id and j.status in ('planning','generating','installing','running','validating') and j.locked_at > now() - interval '5 minutes');
  get diagnostics v_count = row_count;
  delete from public.preview_exchange_nonces where used_at < now() - interval '1 day';
  return v_count;
end; $$;

revoke all on function public.retire_idle_previews(integer) from public, anon, authenticated;
revoke all on function public.retire_stale_provisioning(integer) from public, anon, authenticated;
grant execute on function public.retire_idle_previews(integer) to service_role;
grant execute on function public.retire_stale_provisioning(integer) to service_role;
