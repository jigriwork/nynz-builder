-- Additive runtime admission: shared provider caps cover preview/terminal
-- resume, and an invalid preview setup never accepts paid generation.
create or replace function public.generation_ready(p_max_age_seconds integer default 90) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.worker_heartbeats
    where status in ('idle', 'working') and last_seen_at > now() - make_interval(secs => p_max_age_seconds)
      and coalesce((capabilities->>'generation')::boolean, false)
      and coalesce((capabilities->>'sandbox')::boolean, false)
      and coalesce((capabilities->>'preview_origin')::boolean, false)
  );
$$;

-- Called only by the web/preview servers, never directly by a browser.
-- A deterministic window deduplicates warm/cold proxy instances. Reserving
-- twice the timeout covers connections made at either end of the window.
-- These are conservative runtime estimates, not provider invoices.
create or replace function public.authorize_sandbox_runtime(
  p_project uuid, p_user uuid, p_sandbox text, p_seconds integer,
  p_estimate bigint, p_credits bigint, p_paise_per_credit bigint default 100
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_key text; v_id bigint; v_operation uuid := gen_random_uuid();
begin
  if p_seconds < 60 or p_seconds > 3600 or p_estimate < 1 or p_credits < 1 or p_paise_per_credit < 1 or p_credits <> ceil(p_estimate::numeric/p_paise_per_credit) then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.authorize_sandbox_access(p_project, p_user) a where a.sandbox_id = p_sandbox) then
    raise exception 'NOT_PROJECT_OWNER' using errcode = 'P0001';
  end if;
  perform private.lock_credit_account(p_user);
  v_key := 'runtime:' || p_sandbox || ':' || p_seconds || ':' || floor(extract(epoch from now()) / p_seconds)::text;
  select id into v_id from public.provider_spend where event_key = v_key;
  if found then return v_id; end if;
  -- The operation reservation is created and settled within this transaction;
  -- it never occupies a customer's build concurrency slot after the call.
  perform public.reserve_credits(p_user, p_project, v_operation, p_credits, 2147483647);
  v_id := public.authorize_provider_spend('e2b','sandbox',null,p_estimate,null,p_user,v_key);
  perform public.consume_credits(v_operation,p_credits,v_key,'e2b',null,p_estimate,'allocated_runtime_estimate',jsonb_build_object('project_id',p_project,'seconds',2*p_seconds,'provider_spend_id',v_id,'paise_per_credit',p_paise_per_credit,'provisional',true));
  perform public.settle_reservation(v_operation,'runtime allocation');
  perform public.settle_provider_spend(v_id,p_estimate,'allocated_runtime_estimate');
  return v_id;
end; $$;
revoke all on function public.authorize_sandbox_runtime(uuid,uuid,text,integer,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.authorize_sandbox_runtime(uuid,uuid,text,integer,bigint,bigint,bigint) to service_role;

-- New connections cannot inject NYNZ's own database into customer bundles.
-- The runtime host is supplied by the server; callers still require ownership.
create or replace function private.reject_platform_backend() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.project_url ~* '^https://rgrlilmfjurdchcnxolt[.]supabase[.]co/?$' then
    raise exception 'PLATFORM_BACKEND_FORBIDDEN' using errcode = 'P0001';
  end if;
  return new;
end; $$;
create trigger generated_backend_platform_guard before insert or update on public.generated_backend_connections
for each row execute function private.reject_platform_backend();

-- Publishing uses one source snapshot and atomically commits the deployment
-- together with the build outcome. Cancellation cannot race activation.
create or replace function public.stage_publish_source(p_build uuid, p_lock_owner text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare j public.build_jobs; p public.projects;
begin
  select * into j from public.build_jobs where id=p_build for update;
  if not found or j.locked_by is distinct from p_lock_owner or j.mode <> 'publish' or j.status in ('succeeded','failed','cancelled','queued') then raise exception 'LEASE_LOST' using errcode='P0001'; end if;
  if j.cancel_requested_at is not null then raise exception 'CANCELLED' using errcode='P0001'; end if;
  select * into p from public.projects where id=j.project_id for update;
  if not found or not private.account_active(p.owner_id) then raise exception 'ACCOUNT_SUSPENDED' using errcode='P0001'; end if;
  delete from public.build_staged_files where build_id=j.id;
  insert into public.build_staged_files(build_id,path,content) select j.id,path,content from public.project_files where project_id=p.id;
  update public.build_jobs set base_revision=p.source_revision where id=j.id;
  return p.source_revision;
end; $$;

create or replace function public.complete_publish(p_build uuid, p_lock_owner text, p_deployment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare j public.build_jobs; p public.projects; d public.deployments;
begin
  select * into j from public.build_jobs where id=p_build for update;
  if not found or j.locked_by is distinct from p_lock_owner or j.mode <> 'publish' or j.status in ('succeeded','failed','cancelled','queued') then raise exception 'LEASE_LOST' using errcode='P0001'; end if;
  if j.cancel_requested_at is not null then raise exception 'CANCELLED' using errcode='P0001'; end if;
  select * into p from public.projects where id=j.project_id for update;
  if not found or not private.account_active(p.owner_id) then raise exception 'ACCOUNT_SUSPENDED' using errcode='P0001'; end if;
  if j.base_revision is null or j.base_revision <> p.source_revision then raise exception 'SOURCE_CHANGED' using errcode='P0001'; end if;
  select * into d from public.deployments where id=p_deployment and build_id=j.id and project_id=p.id for update;
  if not found or d.source_revision is distinct from j.base_revision then raise exception 'INVALID_STATE' using errcode='P0001'; end if;
  perform public.activate_deployment(d.id);
  update public.build_jobs set status='succeeded',finished_at=now(),locked_at=null,
    progress=progress || jsonb_build_array(jsonb_build_object('at',now(),'message','Published','percent',100)) where id=j.id;
  delete from public.build_staged_files where build_id=j.id;
end; $$;
revoke all on function public.stage_publish_source(uuid,text), public.complete_publish(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.stage_publish_source(uuid,text), public.complete_publish(uuid,text,uuid) to service_role;
