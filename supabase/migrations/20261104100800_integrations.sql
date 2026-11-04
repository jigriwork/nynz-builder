-- NYNZ release 0.3, part 9: customer backends, publishing and GitHub.
-- NYNZ's platform database never stores customer application data; it stores
-- only connection metadata, deployment records and integration links.

-- Customer-owned Supabase connection: validation and rotation metadata.
alter table public.generated_backend_connections add column if not exists validated_at timestamptz;
alter table public.generated_backend_connections add column if not exists validation jsonb not null default '{}'::jsonb;
alter table public.generated_backend_connections add column if not exists rotated_at timestamptz;

-- Builds can now produce production artifacts.
alter table public.build_jobs drop constraint if exists build_jobs_mode_check;
alter table public.build_jobs add constraint build_jobs_mode_check check (mode in ('create', 'edit', 'restart', 'publish'));

-- Publishing -------------------------------------------------------------------------
create table if not exists public.published_sites (
  project_id uuid primary key references public.projects(id) on delete cascade,
  owner_id uuid not null,
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  status text not null default 'unpublished' check (status in ('unpublished', 'publishing', 'live', 'failed')),
  active_deployment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  owner_id uuid not null,
  build_id uuid,
  version_id uuid,
  source_revision bigint,
  status text not null default 'building' check (status in ('building', 'ready', 'failed', 'retired')),
  artifact_prefix text,
  file_count integer,
  total_bytes bigint,
  manifest jsonb,
  error text,
  created_at timestamptz not null default now(),
  ready_at timestamptz
);
create index if not exists deployments_project_idx on public.deployments(project_id, created_at desc);

create table if not exists public.custom_domains (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  hostname text not null unique check (hostname ~ '^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  verification_token text not null,
  status text not null default 'pending_verification' check (status in ('pending_verification', 'verified', 'active', 'failed')),
  verified_at timestamptz,
  last_checked_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

-- GitHub ----------------------------------------------------------------------------
create table if not exists public.github_installations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id bigint not null,
  account_login text,
  created_at timestamptz not null default now(),
  unique (user_id, installation_id)
);
create table if not exists public.github_links (
  project_id uuid primary key references public.projects(id) on delete cascade,
  installation_id bigint not null,
  repository text not null check (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  branch text not null default 'main' check (branch ~ '^[A-Za-z0-9._/-]{1,200}$'),
  last_synced_sha text,
  last_exported_paths text[] not null default '{}',
  last_synced_at timestamptz,
  last_direction text check (last_direction in ('export', 'import'))
);

do $$ declare t text; begin
  foreach t in array array['published_sites','deployments','custom_domains','github_installations','github_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy published_sites_own on public.published_sites for select to authenticated using (private.is_project_owner(project_id) or private.has_staff_cap('projects.read'));
create policy deployments_own on public.deployments for select to authenticated using (private.is_project_owner(project_id) or private.has_staff_cap('projects.read'));
create policy custom_domains_own on public.custom_domains for select to authenticated using (private.is_project_owner(project_id) or private.has_staff_cap('projects.read'));
create policy github_installations_own on public.github_installations for select to authenticated using (user_id = auth.uid());
create policy github_links_own on public.github_links for select to authenticated using (private.is_project_owner(project_id));

-- Activate a validated deployment atomically; keep the 5 most recent ready
-- deployments for rollback and queue older artifacts for deletion.
create or replace function public.activate_deployment(p_deployment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.deployments; old record;
begin
  select * into d from public.deployments where id = p_deployment for update;
  if not found or d.status not in ('building', 'ready', 'retired') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.platform_resources where kind = 'deployment_artifact' and provider_ref = d.artifact_prefix and state = 'active') then
    raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'Artifact missing';
  end if;
  update public.deployments set status = 'ready', ready_at = coalesce(ready_at, now()) where id = d.id;
  update public.published_sites set active_deployment_id = d.id, status = 'live', updated_at = now() where project_id = d.project_id;
  for old in select id, artifact_prefix from public.deployments where project_id = d.project_id and status in ('ready', 'retired') and id <> d.id
             order by created_at desc offset 4 loop
    update public.deployments set status = 'retired' where id = old.id;
    perform public.request_resource_termination('deployment_artifact', old.artifact_prefix, 'deployment retention');
  end loop;
end; $$;

create or replace function public.rollback_deployment(p_project uuid, p_deployment uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner(p_project);
  if not exists (select 1 from public.deployments where id = p_deployment and project_id = p_project and status in ('ready', 'retired')) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform public.activate_deployment(p_deployment);
end; $$;

create or replace function public.unpublish_site(p_project uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner(p_project);
  update public.published_sites set status = 'unpublished', active_deployment_id = null, updated_at = now() where project_id = p_project;
end; $$;

-- Hosting lookup for the shared site host (service role only). Returns the
-- active deployment for a NYNZ subdomain slug or a verified custom domain.
create or replace function public.resolve_site(p_host text, p_suffix text) returns table(deployment_id uuid, artifact_prefix text, manifest jsonb)
language sql stable security definer set search_path = '' as $$
  select d.id, d.artifact_prefix, d.manifest
  from public.published_sites s join public.deployments d on d.id = s.active_deployment_id
  where s.status = 'live' and private.account_active(s.owner_id) and (
    (p_suffix <> '' and lower(p_host) = s.slug || '.' || lower(p_suffix))
    or exists (select 1 from public.custom_domains c where c.project_id = s.project_id and c.hostname = lower(p_host) and c.status = 'active')
  ) limit 1;
$$;

revoke all on function public.activate_deployment(uuid) from public, anon, authenticated;
grant execute on function public.activate_deployment(uuid) to service_role;
revoke all on function public.resolve_site(text, text) from public, anon, authenticated;
grant execute on function public.resolve_site(text, text) to service_role;
revoke all on function public.rollback_deployment(uuid, uuid) from public, anon;
revoke all on function public.unpublish_site(uuid) from public, anon;
grant execute on function public.rollback_deployment(uuid, uuid) to authenticated;
grant execute on function public.unpublish_site(uuid) to authenticated;

-- Transactional import of external source (GitHub) as a new version, with the
-- same revision check as other writers. Service role only; the API verifies
-- ownership before calling it.
create or replace function public.import_project_files(p_project uuid, p_actor uuid, p_expected_revision bigint, p_files jsonb, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.projects; v_backup uuid; v_version uuid;
begin
  select * into p from public.projects where id = p_project and owner_id = p_actor for update;
  if not found then raise exception 'NOT_PROJECT_OWNER' using errcode = 'P0001'; end if;
  if p_expected_revision is not null and p.source_revision <> p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode = 'P0001'; end if;
  if exists (select 1 from public.build_jobs where project_id = p_project and status in ('queued','generating','installing','running','validating')) then raise exception 'BUILD_ACTIVE' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_files) = 0 or jsonb_array_length(p_files) > 400 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.project_files where project_id = p_project) then
    v_backup := private.snapshot_version(p_project, p_actor, 'Before import', 'checkpoint', null);
  end if;
  delete from public.project_files where project_id = p_project and path not in (select x->>'path' from jsonb_array_elements(p_files) x);
  insert into public.project_files(project_id, path, content)
  select p_project, x->>'path', x->>'content' from jsonb_array_elements(p_files) x
  on conflict (project_id, path) do update set content = excluded.content, updated_at = now() where public.project_files.content is distinct from excluded.content;
  v_version := private.snapshot_version(p_project, p_actor, p_label, 'import', null);
  return jsonb_build_object('version_id', v_version, 'backup_version_id', v_backup, 'source_revision', (select source_revision from public.projects where id = p_project));
end; $$;
revoke all on function public.import_project_files(uuid, uuid, bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.import_project_files(uuid, uuid, bigint, jsonb, text) to service_role;

insert into storage.buckets(id, name, public, file_size_limit) values ('published-sites', 'published-sites', false, 26214400) on conflict (id) do nothing;
