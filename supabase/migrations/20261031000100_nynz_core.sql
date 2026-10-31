-- NYNZ platform data. Generated applications must use a separate backend.
create extension if not exists pgcrypto;
create type public.project_status as enum ('draft','planning','queued','building','ready','failed','archived');
create type public.build_status as enum ('queued','planning','generating','installing','running','validating','succeeded','failed','cancelled');
create type public.usage_kind as enum ('model_input_tokens','model_output_tokens','firecrawl_pages','sandbox_seconds');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'member' check (role in ('member','admin')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100), description text not null default '',
  status public.project_status not null default 'draft', active_version_id uuid, active_sandbox_id text,
  preview_url text, sandbox_expires_at timestamptz, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index projects_owner_updated_idx on public.projects(owner_id,updated_at desc);
create table public.project_files (
  project_id uuid not null references public.projects(id) on delete cascade,
  path text not null check (path ~ '^[A-Za-z0-9._@/+-]+$' and path !~ '(^|/)\.\.(/|$)' and path !~ '^/'),
  content text not null default '', content_hash text generated always as (encode(digest(content,'sha256'),'hex')) stored,
  updated_at timestamptz not null default now(), primary key(project_id,path)
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default 'Build conversation', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')), content text not null check (char_length(content)<=200000),
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index messages_conversation_created_idx on public.messages(conversation_id,created_at);
create table public.versions (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade, label text not null, source_build_id uuid,
  created_at timestamptz not null default now()
);
create table public.version_files (
  version_id uuid not null references public.versions(id) on delete cascade, path text not null,
  content text not null, content_hash text not null, primary key(version_id,path)
);
alter table public.projects add constraint projects_active_version_fk foreign key(active_version_id) references public.versions(id) on delete set null;
create table public.build_jobs (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade, conversation_id uuid references public.conversations(id) on delete set null,
  prompt text not null check (char_length(prompt) between 1 and 30000), mode text not null default 'create' check (mode in ('create','edit','restart')),
  idempotency_key text not null, status public.build_status not null default 'queued', plan jsonb,
  progress jsonb not null default '[]'::jsonb, attempt_count int not null default 0 check (attempt_count between 0 and 3),
  cancel_requested_at timestamptz, locked_at timestamptz, locked_by text, error_code text, error_message text,
  started_at timestamptz, finished_at timestamptz, created_at timestamptz not null default now(), unique(requested_by,idempotency_key)
);
create index build_jobs_queue_idx on public.build_jobs(status,created_at) where status='queued';
create table public.website_imports (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade, source_url text not null, title text, markdown text,
  status text not null default 'pending' check (status in ('pending','complete','failed')), page_count int not null default 0,
  error_message text, created_at timestamptz not null default now()
);
create table public.usage_events (
  id bigint generated always as identity primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade, build_id uuid references public.build_jobs(id) on delete set null,
  kind public.usage_kind not null, quantity bigint not null check(quantity>=0), provider text not null, model text,
  provider_request_id text, estimated_cost_minor bigint, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index usage_events_owner_created_idx on public.usage_events(owner_id,created_at desc);
create table public.generated_backend_connections (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade unique,
  provider text not null default 'supabase' check(provider='supabase'), project_url text not null,
  publishable_key text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create or replace function public.is_project_owner(target_project_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.projects where id=target_project_id and owner_id=auth.uid()); $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'name',split_part(new.email,'@',1))); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end; $$;
create trigger projects_touch before update on public.projects for each row execute procedure public.touch_updated_at();
create trigger conversations_touch before update on public.conversations for each row execute procedure public.touch_updated_at();
create or replace function public.claim_build_job(worker_name text) returns setof public.build_jobs language plpgsql security definer set search_path='' as $$
begin return query update public.build_jobs j set status='planning',locked_at=now(),locked_by=worker_name,
 started_at=coalesce(started_at,now()),attempt_count=attempt_count+1 where j.id=(select id from public.build_jobs where status='queued' order by created_at for update skip locked limit 1) returning j.*; end; $$;
revoke all on function public.claim_build_job(text) from public,anon,authenticated;
grant execute on function public.claim_build_job(text) to service_role;

alter table public.profiles enable row level security; alter table public.projects enable row level security;
alter table public.project_files enable row level security; alter table public.conversations enable row level security;
alter table public.messages enable row level security; alter table public.versions enable row level security;
alter table public.version_files enable row level security; alter table public.build_jobs enable row level security;
alter table public.website_imports enable row level security; alter table public.usage_events enable row level security;
alter table public.generated_backend_connections enable row level security;
create policy profiles_self_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy projects_owner_all on public.projects for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy projects_admin_read on public.projects for select to authenticated using(public.is_admin());
create policy project_files_owner_all on public.project_files for all to authenticated using(public.is_project_owner(project_id)) with check(public.is_project_owner(project_id));
create policy conversations_owner_all on public.conversations for all to authenticated using(public.is_project_owner(project_id)) with check(public.is_project_owner(project_id));
create policy messages_owner_all on public.messages for all to authenticated using(exists(select 1 from public.conversations c where c.id=conversation_id and public.is_project_owner(c.project_id))) with check(exists(select 1 from public.conversations c where c.id=conversation_id and public.is_project_owner(c.project_id)));
create policy versions_owner_all on public.versions for all to authenticated using(public.is_project_owner(project_id)) with check(public.is_project_owner(project_id) and created_by=auth.uid());
create policy version_files_owner_all on public.version_files for all to authenticated using(exists(select 1 from public.versions v where v.id=version_id and public.is_project_owner(v.project_id))) with check(exists(select 1 from public.versions v where v.id=version_id and public.is_project_owner(v.project_id)));
create policy build_jobs_owner_all on public.build_jobs for all to authenticated using(public.is_project_owner(project_id)) with check(public.is_project_owner(project_id) and requested_by=auth.uid());
create policy build_jobs_admin_read on public.build_jobs for select to authenticated using(public.is_admin());
create policy website_imports_owner_all on public.website_imports for all to authenticated using(public.is_project_owner(project_id)) with check(public.is_project_owner(project_id) and requested_by=auth.uid());
create policy usage_owner_read on public.usage_events for select to authenticated using(owner_id=auth.uid() or public.is_admin());
create policy backend_owner_all on public.generated_backend_connections for all to authenticated using(public.is_project_owner(project_id)) with check(public.is_project_owner(project_id));
grant select,insert,update,delete on all tables in schema public to authenticated; grant usage,select on all sequences in schema public to authenticated;
revoke insert,update,delete on public.build_jobs from authenticated;
revoke insert,update,delete on public.usage_events from authenticated;
revoke insert,update on public.generated_backend_connections from authenticated;

insert into storage.buckets(id,name,public,file_size_limit) values('project-assets','project-assets',false,10485760) on conflict(id) do nothing;
create policy project_assets_owner_read on storage.objects for select to authenticated using(bucket_id='project-assets' and public.is_project_owner(((storage.foldername(name))[1])::uuid));
create policy project_assets_owner_write on storage.objects for insert to authenticated with check(bucket_id='project-assets' and public.is_project_owner(((storage.foldername(name))[1])::uuid));
create policy project_assets_owner_delete on storage.objects for delete to authenticated using(bucket_id='project-assets' and public.is_project_owner(((storage.foldername(name))[1])::uuid));
