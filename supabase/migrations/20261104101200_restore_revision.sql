-- Every successful restore is an optimistic-concurrency boundary, including a
-- no-op restore. Otherwise another tab can reuse its pre-restore revision.
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
  update public.projects set source_revision = source_revision + 1 where id = p_project;
  return jsonb_build_object('restored', v_files, 'backup_version_id', v_backup,
    'source_revision', (select source_revision from public.projects where id = p_project));
end; $$;
revoke all on function public.restore_version(uuid, uuid, bigint) from public, anon;
grant execute on function public.restore_version(uuid, uuid, bigint) to authenticated;
