-- Operational state for long-running NYNZ build workers. This table is
-- service-role only and contains no provider credentials or user content.
create table if not exists public.worker_heartbeats (
  worker_id text primary key,
  status text not null check (status in ('starting','idle','working','stopping','stopped','error')),
  current_build_id uuid references public.build_jobs(id) on delete set null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  stopped_at timestamptz
);

alter table public.worker_heartbeats enable row level security;
revoke all on public.worker_heartbeats from public, anon, authenticated;
grant select, insert, update, delete on public.worker_heartbeats to service_role;

-- Requeue jobs whose worker lease has expired. Jobs interrupted during preview
-- preparation reuse their persisted files instead of spending model tokens
-- again. After three claims, fail safely rather than retrying forever.
create or replace function public.recover_stale_build_jobs(stale_after_seconds integer default 120)
returns table(requeued integer, failed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  requeued_count integer := 0;
  failed_count integer := 0;
begin
  if stale_after_seconds < 60 or stale_after_seconds > 3600 then
    raise exception 'stale_after_seconds must be between 60 and 3600';
  end if;

  for candidate in
    select id, project_id, status, attempt_count
    from public.build_jobs
    where status in ('planning','generating','installing','running','validating')
      and locked_at < now() - make_interval(secs => stale_after_seconds)
    order by locked_at
    for update skip locked
  loop
    if candidate.attempt_count >= 3 then
      update public.build_jobs
      set status = 'failed', locked_by = null, locked_at = null,
          error_code = 'WORKER_INTERRUPTED',
          error_message = 'The build was interrupted more than once. Please try again.',
          finished_at = now()
      where id = candidate.id;
      update public.projects
      set status = 'failed', last_error = 'The build was interrupted more than once. Please try again.'
      where id = candidate.project_id;
      failed_count := failed_count + 1;
    else
      update public.build_jobs
      set status = 'queued',
          mode = case when candidate.status in ('installing','running','validating') then 'restart' else mode end,
          locked_by = null, locked_at = null,
          error_code = null, error_message = null, finished_at = null,
          progress = progress || jsonb_build_array(jsonb_build_object(
            'at', now(), 'message', 'Build recovered after a worker restart'
          ))
      where id = candidate.id;
      update public.projects set status = 'queued', last_error = null where id = candidate.project_id;
      requeued_count := requeued_count + 1;
    end if;
  end loop;

  return query select requeued_count, failed_count;
end;
$$;

revoke all on function public.recover_stale_build_jobs(integer) from public, anon, authenticated;
grant execute on function public.recover_stale_build_jobs(integer) to service_role;

-- At most one active build per project. The API checks this before inserting,
-- but only a database constraint prevents concurrent requests (for example two
-- preview restarts after a sandbox expires) from both queueing a job.
create unique index if not exists build_jobs_one_active_per_project
  on public.build_jobs(project_id)
  where status in ('queued','planning','generating','installing','running','validating');
