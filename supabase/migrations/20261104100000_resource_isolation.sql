-- NYNZ release 0.3, part 1: customer and resource isolation (audit SEC-01, SEC-05).
--
-- Customers previously had table-wide UPDATE on public.projects through RLS,
-- which let a project owner rewrite platform-managed fields such as
-- active_sandbox_id. Terminal and preview code trusted that field while using
-- NYNZ's E2B credential. This migration:
--   1. limits customer writes on projects to name/description (column grants);
--   2. removes direct customer writes to versions, version_files and
--      website_imports (the API performs them through checked functions);
--   3. adds a server-owned registry of platform resources bound to a project
--      and owner, and a trigger that refuses to point a project at a sandbox
--      that is not registered to that same project;
--   4. backfills the registry from existing projects, detaching any sandbox
--      that is referenced by more than one project rather than guessing which
--      project legitimately owns it;
--   5. adds single-use preview exchange nonces.
-- Additive: no customer data is deleted.

-- 1. Column-level grants on projects ----------------------------------------
revoke insert, update on public.projects from authenticated, anon;
grant insert (owner_id, name, description) on public.projects to authenticated;
grant update (name, description) on public.projects to authenticated;
-- Deletion goes through public.request_project_deletion so resources are cleaned.
revoke delete on public.projects from authenticated, anon;

-- 2. Platform-written history -------------------------------------------------
revoke insert, update, delete on public.versions from authenticated, anon;
revoke insert, update, delete on public.version_files from authenticated, anon;
revoke insert, update, delete on public.website_imports from authenticated, anon;
revoke all on public.build_jobs from anon;
revoke all on public.usage_events from anon;
revoke all on public.worker_heartbeats from anon;

-- 3. Resource registry -------------------------------------------------------
do $$ begin
  create type public.resource_kind as enum ('e2b_sandbox', 'storage_prefix', 'deployment_artifact');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.resource_state as enum ('provisioning', 'active', 'paused', 'terminating', 'terminated', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists public.platform_resources (
  id uuid primary key default gen_random_uuid(),
  kind public.resource_kind not null,
  provider_ref text not null check (char_length(provider_ref) between 1 and 300),
  -- Deliberately not foreign keys: the record must outlive a deleted project so
  -- cleanup can still find and terminate what belonged to it.
  project_id uuid,
  owner_id uuid,
  build_id uuid,
  purpose text not null default 'preview' check (purpose in ('preview', 'build', 'publish', 'storage')),
  state public.resource_state not null default 'provisioning',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  terminate_requested_at timestamptz,
  terminate_reason text,
  terminated_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  unique (kind, provider_ref)
);
create index if not exists platform_resources_project_idx on public.platform_resources(project_id, kind, state);
create index if not exists platform_resources_cleanup_idx on public.platform_resources(state, terminate_requested_at) where state in ('terminating', 'provisioning');
alter table public.platform_resources enable row level security;
revoke all on public.platform_resources from public, anon, authenticated;
grant select, insert, update on public.platform_resources to service_role;

create or replace function private.touch_resource() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists platform_resources_touch on public.platform_resources;
create trigger platform_resources_touch before update on public.platform_resources for each row execute function private.touch_resource();

-- 4. Backfill existing preview sandboxes ------------------------------------
with refs as (
  select active_sandbox_id as ref, count(*) as n from public.projects where active_sandbox_id is not null group by active_sandbox_id
)
update public.projects p set active_sandbox_id = null, status = case when p.status = 'ready' then 'draft'::public.project_status else p.status end,
  last_error = 'The preview was detached during a security update. Restart the preview to continue.'
from refs where refs.ref = p.active_sandbox_id and refs.n > 1;

insert into public.platform_resources(kind, provider_ref, project_id, owner_id, purpose, state, metadata)
select 'e2b_sandbox', p.active_sandbox_id, p.id, p.owner_id, 'preview', 'active', jsonb_build_object('backfilled', true)
from public.projects p where p.active_sandbox_id is not null
on conflict (kind, provider_ref) do nothing;

-- Every project's asset prefix is a resource that must be removed on deletion.
insert into public.platform_resources(kind, provider_ref, project_id, owner_id, purpose, state)
select 'storage_prefix', 'project-assets/' || p.id::text, p.id, p.owner_id, 'storage', 'active' from public.projects p
on conflict (kind, provider_ref) do nothing;

create or replace function private.register_project_storage() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.platform_resources(kind, provider_ref, project_id, owner_id, purpose, state)
  values ('storage_prefix', 'project-assets/' || new.id::text, new.id, new.owner_id, 'storage', 'active')
  on conflict (kind, provider_ref) do nothing;
  return new;
end; $$;
drop trigger if exists projects_register_storage on public.projects;
create trigger projects_register_storage after insert on public.projects for each row execute function private.register_project_storage();

-- A project may only reference a sandbox registered to that same project and
-- owner. This holds even for service-role writers, so a worker bug cannot
-- cross-wire projects either.
create or replace function private.enforce_sandbox_binding() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.active_sandbox_id is not null and new.active_sandbox_id is distinct from old.active_sandbox_id then
    if not exists (
      select 1 from public.platform_resources r
      where r.kind = 'e2b_sandbox' and r.provider_ref = new.active_sandbox_id
        and r.project_id = new.id and r.owner_id = new.owner_id
        and r.state in ('provisioning', 'active', 'paused')
    ) then
      raise exception 'SANDBOX_NOT_BOUND' using errcode = 'P0001', detail = 'The sandbox is not registered to this project.';
    end if;
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'PROJECT_OWNER_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop trigger if exists projects_sandbox_binding on public.projects;
create trigger projects_sandbox_binding before update on public.projects for each row execute function private.enforce_sandbox_binding();

-- Registration is service-role only and refuses to rebind an existing sandbox
-- to a different project.
create or replace function public.register_sandbox(p_sandbox text, p_project uuid, p_build uuid, p_purpose text default 'preview')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_id uuid; v_existing record;
begin
  select owner_id into v_owner from public.projects where id = p_project;
  if v_owner is null then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into v_existing from public.platform_resources where kind = 'e2b_sandbox' and provider_ref = p_sandbox;
  if found then
    if v_existing.project_id is distinct from p_project then raise exception 'SANDBOX_BOUND_ELSEWHERE' using errcode = 'P0001'; end if;
    return v_existing.id;
  end if;
  insert into public.platform_resources(kind, provider_ref, project_id, owner_id, build_id, purpose, state)
  values ('e2b_sandbox', p_sandbox, p_project, v_owner, p_build, p_purpose, 'provisioning') returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.register_sandbox(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.register_sandbox(text, uuid, uuid, text) to service_role;

-- Mark a sandbox for idempotent termination by the reconciler.
create or replace function public.request_resource_termination(p_kind public.resource_kind, p_ref text, p_reason text)
returns void language sql security definer set search_path = '' as $$
  update public.platform_resources
  set state = 'terminating', terminate_requested_at = coalesce(terminate_requested_at, now()), terminate_reason = coalesce(terminate_reason, p_reason)
  where kind = p_kind and provider_ref = p_ref and state not in ('terminating', 'terminated');
$$;
revoke all on function public.request_resource_termination(public.resource_kind, text, text) from public, anon, authenticated;
grant execute on function public.request_resource_termination(public.resource_kind, text, text) to service_role;

-- Single authorisation point used by the terminal API and the preview proxy.
-- Returns the sandbox only when project, owner, active account and registered
-- resource all agree.
create or replace function public.authorize_sandbox_access(p_project uuid, p_user uuid)
returns table(sandbox_id text, resource_id uuid) language plpgsql security definer set search_path = '' as $$
begin
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
revoke all on function public.authorize_sandbox_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.authorize_sandbox_access(uuid, uuid) to service_role;

-- 5. Preview exchange nonces --------------------------------------------------
create table if not exists public.preview_exchange_nonces (
  jti text primary key check (char_length(jti) between 16 and 64),
  project_id uuid not null,
  used_at timestamptz not null default now()
);
alter table public.preview_exchange_nonces enable row level security;
revoke all on public.preview_exchange_nonces from public, anon, authenticated;
grant select, insert, delete on public.preview_exchange_nonces to service_role;
