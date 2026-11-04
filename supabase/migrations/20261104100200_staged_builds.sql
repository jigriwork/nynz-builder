-- NYNZ release 0.3, part 3: last-known-good preservation (audit REL-01..03).
--
-- Generated and repaired files are written to build-scoped staging rows. The
-- canonical project source, version history and preview pointer change only in
-- public.promote_build, a single transaction that runs after the sandbox has
-- passed install, production build and preview checks. A failed, cancelled or
-- interrupted build leaves the previous source, export and preview untouched.
--
-- Projects carry a source_revision counter (bumped on any file change) used
-- for optimistic concurrency: manual saves, restores and build promotion all
-- refuse to overwrite changes they did not see.

alter table public.projects add column if not exists source_revision bigint not null default 0;
alter table public.projects add column if not exists preview_revision bigint;
alter table public.build_jobs add column if not exists base_revision bigint;
alter table public.build_jobs add column if not exists sandbox_id text;
-- True once the staged file set is complete, so a recovered job resumes at
-- install/validation without paying for generation again.
alter table public.build_jobs add column if not exists generation_complete boolean not null default false;
alter table public.versions add column if not exists file_count integer;
alter table public.versions add column if not exists kind text not null default 'build' check (kind in ('build', 'checkpoint', 'restore', 'import'));

-- Existing previews were built from the current files.
update public.projects set preview_revision = source_revision where active_sandbox_id is not null and preview_revision is null;

create table if not exists public.build_staged_files (
  build_id uuid not null references public.build_jobs(id) on delete cascade,
  path text not null check (path ~ '^[A-Za-z0-9._@/+-]+$' and path !~ '(^|/)\.\.(/|$)' and path !~ '^/'),
  content text not null,
  content_hash text generated always as (encode(extensions.digest(content, 'sha256'), 'hex')) stored,
  primary key (build_id, path)
);
alter table public.build_staged_files enable row level security;
revoke all on public.build_staged_files from public, anon, authenticated;
grant select, insert, update, delete on public.build_staged_files to service_role;

-- Any change to project files bumps the revision, whoever makes it.
create or replace function private.bump_source_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.projects set source_revision = source_revision + 1
  where id = coalesce(new.project_id, old.project_id);
  return null;
end; $$;
drop trigger if exists project_files_bump_revision on public.project_files;
create trigger project_files_bump_revision after insert or update or delete on public.project_files
for each row execute function private.bump_source_revision();

create or replace function private.require_owner(p_project uuid) returns public.projects
language plpgsql security definer set search_path = '' as $$
declare v public.projects;
begin
  if auth.uid() is null then raise exception 'NOT_PROJECT_OWNER' using errcode = 'P0001'; end if;
  if not private.account_active(auth.uid()) then raise exception 'ACCOUNT_SUSPENDED' using errcode = 'P0001'; end if;
  select * into v from public.projects where id = p_project and owner_id = auth.uid() for update;
  if not found then raise exception 'NOT_PROJECT_OWNER' using errcode = 'P0001'; end if;
  return v;
end; $$;
revoke all on function private.require_owner(uuid) from public;

create or replace function private.snapshot_version(p_project uuid, p_actor uuid, p_label text, p_kind text, p_build uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_count integer;
begin
  insert into public.versions(project_id, created_by, label, source_build_id, kind)
  values (p_project, p_actor, left(p_label, 100), p_build, p_kind) returning id into v_id;
  insert into public.version_files(version_id, path, content, content_hash)
  select v_id, path, content, content_hash from public.project_files where project_id = p_project;
  get diagnostics v_count = row_count;
  update public.versions set file_count = v_count where id = v_id;
  return v_id;
end; $$;
revoke all on function private.snapshot_version(uuid, uuid, text, text, uuid) from public;

-- Manual checkpoint (customer).
create or replace function public.create_checkpoint(p_project uuid, p_label text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.projects;
begin
  v := private.require_owner(p_project);
  if not exists (select 1 from public.project_files where project_id = p_project) then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'No files to save'; end if;
  if char_length(trim(coalesce(p_label, ''))) = 0 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  return private.snapshot_version(p_project, auth.uid(), trim(p_label), 'checkpoint', null);
end; $$;
revoke all on function public.create_checkpoint(uuid, text) from public, anon;
grant execute on function public.create_checkpoint(uuid, text) to authenticated;

-- Transactional restore (customer). Locks the project, refuses while a build
-- is writing, checks the caller's expected revision and replaces files in one
-- transaction. A "Before restore" checkpoint is taken first so the restore is
-- itself reversible. The running preview is left alone and reported stale.
create or replace function public.restore_version(p_project uuid, p_version uuid, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.projects; v_files integer; v_backup uuid;
begin
  v := private.require_owner(p_project);
  if exists (select 1 from public.build_jobs where project_id = p_project and status in ('queued','generating','installing','running','validating')) then
    raise exception 'BUILD_ACTIVE' using errcode = 'P0001';
  end if;
  if p_expected_revision is not null and p_expected_revision <> v.source_revision then raise exception 'REVISION_CONFLICT' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.versions where id = p_version and project_id = p_project) then raise exception 'VERSION_NOT_FOUND' using errcode = 'P0001'; end if;
  select count(*) into v_files from public.version_files where version_id = p_version;
  if v_files = 0 then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'Version has no files'; end if;
  if exists (select 1 from public.project_files where project_id = p_project) then
    v_backup := private.snapshot_version(p_project, auth.uid(), 'Before restore', 'checkpoint', null);
  end if;
  delete from public.project_files where project_id = p_project
    and path not in (select path from public.version_files where version_id = p_version);
  insert into public.project_files(project_id, path, content)
  select p_project, path, content from public.version_files where version_id = p_version
  on conflict (project_id, path) do update set content = excluded.content, updated_at = now()
  where public.project_files.content is distinct from excluded.content;
  if exists (
    select path, content_hash from public.version_files where version_id = p_version
    except select path, content_hash from public.project_files where project_id = p_project
  ) or (select count(*) from public.project_files where project_id = p_project) <> v_files then
    raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'Restore integrity check failed';
  end if;
  return jsonb_build_object('restored', v_files, 'backup_version_id', v_backup,
    'source_revision', (select source_revision from public.projects where id = p_project));
end; $$;
revoke all on function public.restore_version(uuid, uuid, bigint) from public, anon;
grant execute on function public.restore_version(uuid, uuid, bigint) to authenticated;

-- Conflict-checked manual save (customer). Each file carries the hash the
-- editor loaded (null for a new file). A mismatch rejects the whole save.
create or replace function public.save_project_files(p_project uuid, p_files jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.projects; f jsonb; v_current text;
begin
  v := private.require_owner(p_project);
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 or jsonb_array_length(p_files) > 120 then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if exists (select 1 from public.build_jobs where project_id = p_project and status in ('generating','installing','running','validating')) then
    raise exception 'BUILD_ACTIVE' using errcode = 'P0001';
  end if;
  for f in select * from jsonb_array_elements(p_files) loop
    select content_hash into v_current from public.project_files where project_id = p_project and path = f->>'path';
    if (f ? 'base_hash') and (f->>'base_hash') is distinct from v_current then
      raise exception 'FILE_CONFLICT' using errcode = 'P0001', detail = f->>'path';
    end if;
    insert into public.project_files(project_id, path, content) values (p_project, f->>'path', f->>'content')
    on conflict (project_id, path) do update set content = excluded.content, updated_at = now()
    where public.project_files.content is distinct from excluded.content;
  end loop;
  return jsonb_build_object(
    'source_revision', (select source_revision from public.projects where id = p_project),
    'files', (select jsonb_agg(jsonb_build_object('path', path, 'content_hash', content_hash)) from public.project_files
              where project_id = p_project and path in (select x->>'path' from jsonb_array_elements(p_files) x)));
end; $$;
revoke all on function public.save_project_files(uuid, jsonb) from public, anon;
grant execute on function public.save_project_files(uuid, jsonb) to authenticated;

-- Worker: record the source revision a generation run starts from.
create or replace function public.begin_build_generation(p_build uuid, p_lock_owner text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_rev bigint;
begin
  select p.source_revision into v_rev from public.build_jobs j join public.projects p on p.id = j.project_id
  where j.id = p_build and j.locked_by = p_lock_owner;
  if v_rev is null then raise exception 'LEASE_LOST' using errcode = 'P0001'; end if;
  update public.build_jobs set base_revision = coalesce(base_revision, v_rev) where id = p_build;
  if not (select generation_complete from public.build_jobs where id = p_build) then
    delete from public.build_staged_files where build_id = p_build;
  end if;
  return (select base_revision from public.build_jobs where id = p_build);
end; $$;

-- Worker: atomically promote a validated build.
create or replace function public.promote_build(p_build uuid, p_lock_owner text, p_sandbox text, p_preview_url text, p_label text, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.build_jobs; p public.projects; v_version uuid; v_previous text; v_staged integer;
begin
  select * into j from public.build_jobs where id = p_build for update;
  if not found or j.locked_by is distinct from p_lock_owner or j.status in ('succeeded','failed','cancelled','queued') then
    raise exception 'LEASE_LOST' using errcode = 'P0001';
  end if;
  if j.cancel_requested_at is not null then raise exception 'CANCELLED' using errcode = 'P0001'; end if;
  select * into p from public.projects where id = j.project_id for update;
  if not found then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001'; end if;
  if not private.account_active(p.owner_id) then raise exception 'ACCOUNT_SUSPENDED' using errcode = 'P0001'; end if;
  select count(*) into v_staged from public.build_staged_files where build_id = p_build;
  if j.mode <> 'restart' or v_staged > 0 then
    if j.base_revision is not null and j.base_revision <> p.source_revision then
      raise exception 'SOURCE_CHANGED' using errcode = 'P0001', detail = 'Project files changed while this build was running.';
    end if;
    if v_staged = 0 then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'No staged files'; end if;
    delete from public.project_files where project_id = p.id and path not in (select path from public.build_staged_files where build_id = p_build);
    insert into public.project_files(project_id, path, content)
    select p.id, path, content from public.build_staged_files where build_id = p_build
    on conflict (project_id, path) do update set content = excluded.content, updated_at = now()
    where public.project_files.content is distinct from excluded.content;
  end if;
  v_version := private.snapshot_version(p.id, j.requested_by, p_label, 'build', p_build);
  update public.platform_resources set state = 'active', build_id = p_build
  where kind = 'e2b_sandbox' and provider_ref = p_sandbox and project_id = p.id;
  v_previous := p.active_sandbox_id;
  update public.projects set status = 'ready', active_sandbox_id = p_sandbox, preview_url = p_preview_url,
    active_version_id = v_version, last_error = null,
    preview_revision = case when v_staged > 0 then source_revision else coalesce(j.base_revision, source_revision) end
  where id = p.id;
  if v_previous is not null and v_previous <> p_sandbox then
    perform public.request_resource_termination('e2b_sandbox', v_previous, 'replaced');
  end if;
  update public.build_jobs set status = 'succeeded', locked_at = null, finished_at = now(), sandbox_id = p_sandbox,
    progress = progress || jsonb_build_array(jsonb_build_object('at', now(), 'message', 'Build complete', 'percent', 100))
  where id = p_build;
  delete from public.build_staged_files where build_id = p_build;
  return jsonb_build_object('version_id', v_version, 'previous_sandbox', v_previous);
end; $$;

-- Worker: end a build without promoting. The previous working preview is
-- kept; the project is "ready" again when it still has one.
create or replace function public.finish_build_unsuccessfully(p_build uuid, p_lock_owner text, p_status public.build_status, p_code text, p_message text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.build_jobs; p public.projects;
begin
  if p_status not in ('failed', 'cancelled') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  select * into j from public.build_jobs where id = p_build for update;
  if not found or j.locked_by is distinct from p_lock_owner or j.status in ('succeeded','failed','cancelled') then return false; end if;
  update public.build_jobs set status = p_status, error_code = p_code, error_message = left(p_message, 1000), finished_at = now(), locked_at = null where id = p_build;
  delete from public.build_staged_files where build_id = p_build;
  if j.sandbox_id is not null then perform public.request_resource_termination('e2b_sandbox', j.sandbox_id, 'build ' || p_status::text); end if;
  select * into p from public.projects where id = j.project_id for update;
  if found then
    update public.projects set
      status = case when p.active_sandbox_id is not null then 'ready'::public.project_status
                    when p_status = 'cancelled' then 'draft'::public.project_status else 'failed'::public.project_status end,
      last_error = case when p_status = 'failed' then left(p_message, 1000) else null end
    where id = p.id;
  end if;
  return true;
end; $$;

revoke all on function public.begin_build_generation(uuid, text) from public, anon, authenticated;
revoke all on function public.promote_build(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.finish_build_unsuccessfully(uuid, text, public.build_status, text, text) from public, anon, authenticated;
grant execute on function public.begin_build_generation(uuid, text) to service_role;
grant execute on function public.promote_build(uuid, text, text, text, text, text) to service_role;
grant execute on function public.finish_build_unsuccessfully(uuid, text, public.build_status, text, text) to service_role;

-- Customer project deletion: cancels work, queues sandbox and storage cleanup,
-- then deletes the project rows in one transaction.
create or replace function public.request_project_deletion(p_project uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.projects;
begin
  v := private.require_owner(p_project);
  update public.build_jobs set cancel_requested_at = coalesce(cancel_requested_at, now())
  where project_id = p_project and status in ('planning','generating','installing','running','validating');
  update public.platform_resources set state = 'terminating', terminate_requested_at = coalesce(terminate_requested_at, now()), terminate_reason = 'project deleted'
  where project_id = p_project and state not in ('terminating', 'terminated');
  delete from public.projects where id = p_project;
end; $$;
revoke all on function public.request_project_deletion(uuid) from public, anon;
grant execute on function public.request_project_deletion(uuid) to authenticated;

-- Stale-job recovery now ends interrupted builds through the same path, so
-- the project keeps its previous preview instead of showing "failed".
create or replace function public.recover_stale_build_jobs(stale_after_seconds integer default 120)
returns table(requeued integer, failed integer) language plpgsql security definer set search_path = '' as $$
declare candidate record; requeued_count integer := 0; failed_count integer := 0;
begin
  if stale_after_seconds < 60 or stale_after_seconds > 3600 then raise exception 'stale_after_seconds must be between 60 and 3600'; end if;
  for candidate in
    select id, project_id, status, attempt_count, locked_by, sandbox_id from public.build_jobs
    where status in ('planning','generating','installing','running','validating') and locked_at < now() - make_interval(secs => stale_after_seconds)
    order by locked_at for update skip locked
  loop
    if candidate.sandbox_id is not null then perform public.request_resource_termination('e2b_sandbox', candidate.sandbox_id, 'worker interrupted'); end if;
    if candidate.attempt_count >= 3 then
      perform public.finish_build_unsuccessfully(candidate.id, candidate.locked_by, 'failed', 'WORKER_INTERRUPTED', 'The build was interrupted more than once. Please try again.');
      failed_count := failed_count + 1;
    else
      -- Staged files are kept so a recovered generation can resume from them.
      update public.build_jobs set status = 'queued', locked_by = null, locked_at = null, sandbox_id = null,
        error_code = null, error_message = null, finished_at = null,
        progress = progress || jsonb_build_array(jsonb_build_object('at', now(), 'message', 'Build recovered after a worker restart'))
      where id = candidate.id;
      requeued_count := requeued_count + 1;
    end if;
  end loop;
  return query select requeued_count, failed_count;
end; $$;
revoke all on function public.recover_stale_build_jobs(integer) from public, anon, authenticated;
grant execute on function public.recover_stale_build_jobs(integer) to service_role;
