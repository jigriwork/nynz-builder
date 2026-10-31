-- Keep RLS and trigger helpers outside the API-exposed public schema.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create function private.is_project_owner(target_project_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.projects where id=target_project_id and owner_id=auth.uid());
$$;
create function private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin');
$$;
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,display_name)
  values(new.id,coalesce(new.raw_user_meta_data->>'name',split_part(new.email,'@',1)));
  return new;
end;
$$;

revoke all on function private.is_project_owner(uuid) from public;
revoke all on function private.is_admin() from public;
revoke all on function private.handle_new_user() from public;
grant execute on function private.is_project_owner(uuid) to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;

drop trigger on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure private.handle_new_user();

alter policy profiles_self_read on public.profiles
  using(id=auth.uid() or private.is_admin());
alter policy projects_owner_all on public.projects
  using(owner_id=auth.uid()) with check(owner_id=auth.uid());
alter policy projects_admin_read on public.projects
  using(private.is_admin());
alter policy project_files_owner_all on public.project_files
  using(private.is_project_owner(project_id)) with check(private.is_project_owner(project_id));
alter policy conversations_owner_all on public.conversations
  using(private.is_project_owner(project_id)) with check(private.is_project_owner(project_id));
alter policy messages_owner_all on public.messages
  using(exists(select 1 from public.conversations c where c.id=conversation_id and private.is_project_owner(c.project_id)))
  with check(exists(select 1 from public.conversations c where c.id=conversation_id and private.is_project_owner(c.project_id)));
alter policy versions_owner_all on public.versions
  using(private.is_project_owner(project_id)) with check(private.is_project_owner(project_id) and created_by=auth.uid());
alter policy version_files_owner_all on public.version_files
  using(exists(select 1 from public.versions v where v.id=version_id and private.is_project_owner(v.project_id)))
  with check(exists(select 1 from public.versions v where v.id=version_id and private.is_project_owner(v.project_id)));
alter policy build_jobs_owner_all on public.build_jobs
  using(private.is_project_owner(project_id)) with check(private.is_project_owner(project_id) and requested_by=auth.uid());
alter policy build_jobs_admin_read on public.build_jobs
  using(private.is_admin());
alter policy website_imports_owner_all on public.website_imports
  using(private.is_project_owner(project_id)) with check(private.is_project_owner(project_id) and requested_by=auth.uid());
alter policy usage_owner_read on public.usage_events
  using(owner_id=auth.uid() or private.is_admin());
alter policy backend_owner_all on public.generated_backend_connections
  using(private.is_project_owner(project_id)) with check(private.is_project_owner(project_id));
alter policy project_assets_owner_read on storage.objects
  using(bucket_id='project-assets' and private.is_project_owner(((storage.foldername(name))[1])::uuid));
alter policy project_assets_owner_write on storage.objects
  with check(bucket_id='project-assets' and private.is_project_owner(((storage.foldername(name))[1])::uuid));
alter policy project_assets_owner_delete on storage.objects
  using(bucket_id='project-assets' and private.is_project_owner(((storage.foldername(name))[1])::uuid));

drop function public.handle_new_user();
drop function public.is_admin();
drop function public.is_project_owner(uuid);
