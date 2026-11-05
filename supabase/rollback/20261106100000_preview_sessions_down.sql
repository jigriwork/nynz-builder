-- Rollback for 20261106100000_preview_sessions_and_trial.sql (0.5.0), for use
-- only together with redeploying the 0.4.2 worker, web app and preview host.
-- Run in one transaction. Rehearsed in tests/rehearsal/preview-sessions-upgrade.ts.
--
-- 1. Settles every open preview session at the time it has run so far (never
--    beyond its recorded end), charging those seconds once and releasing the
--    rest of each hold.
-- 2. Restores the previous clock-window charge in authorize_sandbox_runtime,
--    which the 0.4.2 preview host and terminal call.
-- 3. Turns off the trial-only spending limit (0.4.2 has no trial budget).
-- The new tables and columns stay; 0.4.2 code does not read them.
begin;
select public.settle_sandbox_session(id, least(now(), runs_until), 'rollback')
from public.sandbox_sessions where status = 'open';

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

update public.spend_limits set active = false where scope = 'trial';
commit;
