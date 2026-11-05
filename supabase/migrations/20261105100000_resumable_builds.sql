-- NYNZ 0.4: resumable builds and a durable project brief.
--
-- Large builds are written in steps. Each finished step is recorded in one
-- transaction together with its files (public.record_build_step), so a worker
-- restart, a provider failure or a Stop never throws away work that was
-- already paid for. A build that fails or is stopped after finishing some
-- steps keeps those files and is marked resumable. public.resume_build starts
-- a new build that carries the same approved plan, moves the saved files
-- across and continues from the first unfinished step, at most once per
-- failed build. Replanning or regenerating everything is a separate,
-- explicit "Start over" request.
--
-- projects.brief keeps the customer's original brief, the approved plan and
-- every later approved change, so follow-up requests are planned and written
-- against the full requirements rather than only the latest message.

alter table public.build_jobs add column if not exists request text;
alter table public.build_jobs add column if not exists checkpoint jsonb;
alter table public.build_jobs add column if not exists resumable boolean not null default false;
alter table public.build_jobs add column if not exists resume_of uuid references public.build_jobs(id) on delete set null;
create unique index if not exists build_jobs_resume_once on public.build_jobs(resume_of) where resume_of is not null;
alter table public.projects add column if not exists brief jsonb;

-- The customer's own words for each request (the stored prompt also carries
-- the approved plan text appended at approval).
update public.build_jobs set request = split_part(prompt, E'\n\nUSER APPROVED PLAN', 1) where request is null;

create or replace function private.checkpoint_done_count(p jsonb) returns integer
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_array_length(case when jsonb_typeof(p->'done') = 'array' then p->'done' end), 0);
$$;

-- Worker: record a finished step and its files atomically.
create or replace function public.record_build_step(p_build uuid, p_lock_owner text, p_done text[], p_files jsonb, p_note jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.build_jobs; v_done jsonb; v_checkpoint jsonb;
begin
  select * into j from public.build_jobs where id = p_build for update;
  if not found or j.locked_by is distinct from p_lock_owner or j.status in ('succeeded','failed','cancelled','queued') then
    raise exception 'LEASE_LOST' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  insert into public.build_staged_files(build_id, path, content)
  select p_build, f->>'path', f->>'content' from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) f
  on conflict (build_id, path) do update set content = excluded.content;
  select coalesce(jsonb_agg(distinct x order by x), '[]'::jsonb) into v_done
  from (select jsonb_array_elements_text(case when jsonb_typeof(j.checkpoint->'done') = 'array' then j.checkpoint->'done' else '[]'::jsonb end) x
        union select unnest(coalesce(p_done, '{}'::text[]))) s;
  v_checkpoint := coalesce(j.checkpoint, '{}'::jsonb) - 'failed_step'
    || jsonb_build_object('done', v_done, 'updated_at', now())
    || case when p_note is null then '{}'::jsonb else jsonb_build_object('last_step', p_note) end
    -- An edit first stages the current project files as its base.
    || case when coalesce((p_note->>'base')::boolean, false) then jsonb_build_object('base_staged', true) else '{}'::jsonb end;
  update public.build_jobs set checkpoint = v_checkpoint, locked_at = now() where id = p_build;
  return v_checkpoint;
end; $$;

-- Worker: note which step failed (kept for the Resume card).
create or replace function public.note_build_failure_step(p_build uuid, p_lock_owner text, p_step jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.build_jobs set checkpoint = coalesce(checkpoint, '{}'::jsonb) || jsonb_build_object('failed_step', p_step)
  where id = p_build and locked_by = p_lock_owner;
end; $$;

-- Staged files are kept when the build already has recorded progress, so a
-- requeued or resumed build continues instead of starting from nothing.
create or replace function public.begin_build_generation(p_build uuid, p_lock_owner text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_rev bigint; j public.build_jobs;
begin
  select p.source_revision into v_rev from public.build_jobs b join public.projects p on p.id = b.project_id
  where b.id = p_build and b.locked_by = p_lock_owner;
  if v_rev is null then raise exception 'LEASE_LOST' using errcode = 'P0001'; end if;
  update public.build_jobs set base_revision = coalesce(base_revision, v_rev) where id = p_build returning * into j;
  if not j.generation_complete and private.checkpoint_done_count(j.checkpoint) = 0 and coalesce((j.checkpoint->>'base_staged')::boolean, false) = false then
    delete from public.build_staged_files where build_id = p_build;
  end if;
  return j.base_revision;
end; $$;

-- Ending a build unsuccessfully keeps recorded progress for Resume.
create or replace function public.finish_build_unsuccessfully(p_build uuid, p_lock_owner text, p_status public.build_status, p_code text, p_message text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.build_jobs; p public.projects; v_keep boolean;
begin
  if p_status not in ('failed', 'cancelled') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  select * into j from public.build_jobs where id = p_build for update;
  if not found or j.locked_by is distinct from p_lock_owner or j.status in ('succeeded','failed','cancelled') then return false; end if;
  v_keep := j.mode in ('create', 'edit') and coalesce(p_code, '') <> 'ACCOUNT_SUSPENDED'
    and (j.generation_complete or private.checkpoint_done_count(j.checkpoint) > 0)
    and exists (select 1 from public.build_staged_files where build_id = p_build);
  update public.build_jobs set status = p_status, error_code = p_code, error_message = left(p_message, 1000), finished_at = now(),
    locked_at = null, resumable = v_keep where id = p_build;
  if not v_keep then delete from public.build_staged_files where build_id = p_build; end if;
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

-- Server: continue a failed or stopped build from its first unfinished step.
-- The caller has already reserved credits for p_new. Idempotent per failed
-- build: a second call returns the build created by the first.
create or replace function public.resume_build(p_failed uuid, p_new uuid, p_user uuid, p_idempotency text)
returns public.build_jobs language plpgsql security definer set search_path = '' as $$
declare f public.build_jobs; p public.projects; n public.build_jobs;
begin
  select * into n from public.build_jobs where resume_of = p_failed;
  if found then return n; end if;
  select * into f from public.build_jobs where id = p_failed for update;
  if not found or f.requested_by <> p_user then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  select * into n from public.build_jobs where resume_of = p_failed;
  if found then return n; end if;
  if f.status not in ('failed', 'cancelled') or not f.resumable then raise exception 'NOT_RESUMABLE' using errcode = 'P0001'; end if;
  select * into p from public.projects where id = f.project_id for update;
  if not found or p.owner_id <> p_user then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not private.account_active(p_user) then raise exception 'ACCOUNT_SUSPENDED' using errcode = 'P0001'; end if;
  if exists (select 1 from public.build_jobs where project_id = p.id and status in ('queued','planning','generating','installing','running','validating')) then
    raise exception 'BUILD_ACTIVE' using errcode = 'P0001';
  end if;
  if f.base_revision is not null and f.base_revision <> p.source_revision then
    raise exception 'SOURCE_CHANGED' using errcode = 'P0001', detail = 'Project files changed after this build stopped.';
  end if;
  insert into public.build_jobs(id, project_id, requested_by, conversation_id, prompt, request, mode, idempotency_key, status, plan,
    checkpoint, base_revision, resume_of, generation_complete, progress)
  values (p_new, f.project_id, p_user, f.conversation_id, f.prompt, f.request, f.mode, p_idempotency, 'queued', f.plan,
    (coalesce(f.checkpoint, '{}'::jsonb) - 'failed_step') || jsonb_build_object('resumed_from', p_failed),
    f.base_revision, p_failed, f.generation_complete,
    jsonb_build_array(jsonb_build_object('at', now(), 'message',
      format('Resuming: %s finished step(s) kept, continuing from the first unfinished step', private.checkpoint_done_count(f.checkpoint)))))
  returning * into n;
  update public.build_staged_files set build_id = p_new where build_id = p_failed;
  update public.build_jobs set resumable = false where id = p_failed;
  update public.projects set status = 'queued', last_error = null where id = p.id;
  return n;
end; $$;

-- Server: remember the customer's brief and each approved change.
create or replace function public.record_approved_request(p_build uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.build_jobs; p public.projects; v jsonb; v_entry jsonb; v_changes jsonb;
begin
  select * into j from public.build_jobs where id = p_build;
  if not found or j.plan->>'approval' <> 'approved' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  select * into p from public.projects where id = j.project_id for update;
  v := coalesce(p.brief, '{}'::jsonb);
  if j.mode = 'create' and (v->>'original' is null or not exists (select 1 from public.project_files where project_id = p.id)) then
    v := jsonb_build_object('original', left(coalesce(j.request, j.prompt), 30000),
      'plan', jsonb_build_object('summary', j.plan->>'summary', 'steps', coalesce(j.plan->'steps', '[]'::jsonb)),
      'source_build', p_build, 'recorded_at', now(), 'changes', '[]'::jsonb);
  elsif j.mode = 'edit' then
    v_entry := jsonb_build_object('build_id', p_build, 'request', left(coalesce(j.request, j.prompt), 4000),
      'summary', left(coalesce(j.plan->>'summary', ''), 1000), 'status', 'approved', 'at', now());
    -- Replace any earlier entry for this build, append, keep the latest 40.
    select coalesce(jsonb_agg(c order by ord), '[]'::jsonb) into v_changes
    from jsonb_array_elements(coalesce(v->'changes', '[]'::jsonb)) with ordinality t(c, ord)
    where c->>'build_id' is distinct from p_build::text;
    v_changes := v_changes || jsonb_build_array(v_entry);
    if jsonb_array_length(v_changes) > 40 then
      select jsonb_agg(c order by ord) into v_changes
      from jsonb_array_elements(v_changes) with ordinality t(c, ord) where ord > jsonb_array_length(v_changes) - 40;
    end if;
    v := v || jsonb_build_object('changes', v_changes);
  end if;
  update public.projects set brief = v where id = p.id;
  return v;
end; $$;

-- After a build succeeds: other builds' leftover progress is no longer
-- resumable (the project moved on) and the brief marks the change applied.
create or replace function private.after_build_succeeded() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.build_jobs set resumable = false where project_id = new.project_id and id <> new.id and resumable;
  delete from public.build_staged_files s using public.build_jobs b
  where s.build_id = b.id and b.project_id = new.project_id and b.id <> new.id and b.status in ('failed','cancelled');
  update public.projects set brief = brief || jsonb_build_object('changes', (
      select coalesce(jsonb_agg(case when c->>'build_id' in (new.id::text, coalesce(new.resume_of::text, ''))
        then c || jsonb_build_object('status', 'applied', 'build_id', new.id) else c end order by ord), '[]'::jsonb)
      from jsonb_array_elements(coalesce(brief->'changes', '[]'::jsonb)) with ordinality t(c, ord)))
  where id = new.project_id and brief is not null;
  return null;
end; $$;
drop trigger if exists build_jobs_after_success on public.build_jobs;
create trigger build_jobs_after_success after update of status on public.build_jobs
-- Only builds that change source move the project on; a preview restart or a
-- publish leaves a resumable build's saved progress alone.
for each row when (new.status = 'succeeded' and old.status is distinct from 'succeeded' and new.mode in ('create', 'edit'))
execute function private.after_build_succeeded();

revoke all on function public.record_build_step(uuid, text, text[], jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.note_build_failure_step(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.resume_build(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_approved_request(uuid) from public, anon, authenticated;
revoke all on function private.after_build_succeeded() from public;
revoke all on function private.checkpoint_done_count(jsonb) from public;
grant execute on function public.record_build_step(uuid, text, text[], jsonb, jsonb) to service_role;
grant execute on function public.note_build_failure_step(uuid, text, jsonb) to service_role;
grant execute on function public.resume_build(uuid, uuid, uuid, text) to service_role;
grant execute on function public.record_approved_request(uuid) to service_role;
