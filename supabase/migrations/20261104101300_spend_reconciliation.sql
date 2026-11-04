-- Track preview certificates in the existing durable deletion queue.
alter type public.resource_kind add value if not exists 'preview_domain';
create or replace function public.register_preview_domain(p_project uuid,p_user uuid,p_host text,p_ready boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.platform_resources;
begin
  perform 1 from public.projects where id=p_project and owner_id=p_user and status<>'archived' for update;
  if not found or not private.account_active(p_user) or p_host not like p_project::text||'.%' then
    raise exception 'NOT_PROJECT_OWNER' using errcode='P0001';
  end if;
  select * into r from public.platform_resources where kind::text='preview_domain' and provider_ref=p_host for update;
  if found and (r.project_id<>p_project or r.owner_id<>p_user or r.state in ('terminating','terminated','failed')) then
    raise exception 'INVALID_STATE' using errcode='P0001';
  end if;
  insert into public.platform_resources(kind,provider_ref,project_id,owner_id,purpose,state)
    values('preview_domain',p_host,p_project,p_user,'preview',case when p_ready then 'active'::public.resource_state else 'provisioning'::public.resource_state end)
    on conflict(kind,provider_ref) do update set state=case when p_ready then 'active'::public.resource_state else public.platform_resources.state end;
end; $$;
revoke all on function public.register_preview_domain(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.register_preview_domain(uuid,uuid,text,boolean) to service_role;

-- Estimates retain their budget hold and never become measured actual usage.
-- Additive correction for both new events and earlier conservatively settled
-- rows. Original credit entries remain immutable and explicitly provisional.
update public.provider_spend set estimated_paise = greatest(estimated_paise,coalesce(actual_paise,0)),
  actual_paise=null,status='authorized',settled_at=null
where status='settled' and (cost_source is null or cost_source not in ('provider_reported','provider_invoice'));

create or replace function public.settle_provider_spend(p_id bigint, p_actual bigint, p_source text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_actual < 0 then raise exception 'INVALID_STATE' using errcode='P0001'; end if;
  if p_source in ('provider_reported','provider_invoice') then
    update public.provider_spend set actual_paise=p_actual,cost_source=p_source,status='settled',settled_at=now()
    where id=p_id and status='authorized';
  else
    update public.provider_spend set estimated_paise=greatest(estimated_paise,p_actual),actual_paise=null,
      cost_source=p_source,status='authorized',settled_at=null where id=p_id and status='authorized';
  end if;
end; $$;

create or replace function public.record_provider_spend(p_provider text,p_kind text,p_model text,p_actual bigint,p_source text,p_build uuid,p_user uuid,p_event_key text)
returns void language sql security definer set search_path = '' as $$
  insert into public.provider_spend(provider,kind,model,build_id,user_id,estimated_paise,actual_paise,cost_source,status,event_key,settled_at)
  values(p_provider,p_kind,p_model,p_build,p_user,p_actual,
    case when p_source in ('provider_reported','provider_invoice') then p_actual end,p_source,
    case when p_source in ('provider_reported','provider_invoice') then 'settled' else 'authorized' end,p_event_key,
    case when p_source in ('provider_reported','provider_invoice') then now() end)
  on conflict(event_key) do nothing;
$$;

create table public.provider_spend_reconciliations (
  spend_id bigint primary key references public.provider_spend(id),
  actual_paise bigint not null check(actual_paise>=0),
  evidence text not null check(char_length(evidence) between 10 and 1000),
  actor_id uuid not null,
  refunded_credits bigint not null default 0,
  additional_credits bigint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.provider_spend_reconciliations enable row level security;
revoke all on public.provider_spend_reconciliations from public,anon,authenticated,service_role;
grant select on public.provider_spend_reconciliations to service_role,authenticated;
create policy spend_reconciliation_read on public.provider_spend_reconciliations for select to authenticated using(private.has_staff_cap('providers.read'));
create trigger spend_reconciliation_immutable before update or delete on public.provider_spend_reconciliations
for each row execute function private.ledger_immutable();

-- Invoice reconciliation uses the signed-in owner and recent authentication.
-- It atomically corrects the spend and provisional customer debit, exactly
-- once. Refunds retain the original grants' expiry, including expired grants.
-- Service-role callers cannot impersonate the owner to fabricate evidence.
create or replace function public.admin_reconcile_provider_spend(p_id bigint,p_actual bigint,p_evidence text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; s public.provider_spend; l public.credit_ledger; r public.credit_reservations;
  prior public.provider_spend_reconciliations; v_count integer; v_rate bigint; v_target bigint;
  v_refund bigint:=0; v_left bigint; v_take bigint; v_extra bigint:=0; a record; g public.credit_grants;
begin
  v_actor:=private.assert_staff('owner.manage',900);
  if p_actual<0 or p_actual is null or char_length(trim(coalesce(p_evidence,''))) not between 10 and 1000 then
    raise exception 'INVALID_STATE' using errcode='P0001';
  end if;
  perform pg_advisory_xact_lock(7364202);
  select * into s from public.provider_spend where id=p_id for update;
  if not found or s.status='voided' then raise exception 'INVALID_STATE' using errcode='P0001'; end if;
  select * into prior from public.provider_spend_reconciliations where spend_id=p_id;
  if found then
    if prior.actual_paise<>p_actual or prior.evidence<>trim(p_evidence) then raise exception 'DUPLICATE' using errcode='P0001'; end if;
    return jsonb_build_object('duplicate',true,'refunded_credits',prior.refunded_credits,'additional_credits',prior.additional_credits);
  end if;
  if s.status='settled' then raise exception 'INVALID_STATE' using errcode='P0001',detail='Already provider-reported'; end if;
  if s.user_id is not null then perform private.lock_credit_account(s.user_id); end if;
  select count(*) into v_count from public.credit_ledger where entry_type='consume' and
    (metadata->>'provider_spend_id'=p_id::text or event_key=s.event_key);
  if v_count>1 then raise exception 'INVALID_STATE' using errcode='P0001',detail='Ambiguous debit'; end if;
  select * into l from public.credit_ledger where entry_type='consume' and
    (metadata->>'provider_spend_id'=p_id::text or event_key=s.event_key);
  if found then
    if l.user_id is distinct from s.user_id then raise exception 'INVALID_STATE' using errcode='P0001'; end if;
    select * into r from public.credit_reservations where id=l.reservation_id;
    if r.status='active' then raise exception 'INVALID_STATE' using errcode='P0001',detail='Build must finish first'; end if;
    v_rate:=(l.metadata->>'paise_per_credit')::bigint;
    if coalesce(v_rate,0)<1 then raise exception 'INVALID_STATE' using errcode='P0001',detail='Missing historical credit rate'; end if;
    v_target:=ceil(p_actual::numeric/v_rate)::bigint;
    v_refund:=greatest(0,-l.amount-v_target); v_left:=v_refund;
    for a in select value from jsonb_array_elements(l.metadata->'allocations') with ordinality order by ordinality desc loop
      exit when v_left<=0;
      select * into g from public.credit_grants where id=(a.value->>'grant')::uuid and user_id=l.user_id;
      if not found then raise exception 'INVALID_STATE' using errcode='P0001'; end if;
      v_take:=least(v_left,(a.value->>'amount')::bigint);
      perform public.grant_credits(l.user_id,'refund_restore',v_take,g.expires_at,'Provider invoice reconciliation',v_actor,'spend-refund:'||p_id||':'||g.id);
      v_left:=v_left-v_take;
    end loop;
    if v_left<>0 then raise exception 'INVALID_STATE' using errcode='P0001',detail='Missing original allocations'; end if;
    if v_target>-l.amount then
      v_extra:=v_target+l.amount;
      select (public.consume_credits(r.build_id,v_extra,'spend-correction:'||p_id,s.provider,s.model,p_actual,'provider_invoice',jsonb_build_object('provider_spend_id',p_id,'evidence',trim(p_evidence)))->>'charged')::bigint into v_extra;
    end if;
  elsif s.user_id is not null then
    raise exception 'INVALID_STATE' using errcode='P0001',detail='No linked debit; review historical event manually';
  end if;
  update public.provider_spend set actual_paise=p_actual,cost_source='provider_invoice',status='settled',settled_at=now() where id=p_id;
  insert into public.provider_spend_reconciliations(spend_id,actual_paise,evidence,actor_id,refunded_credits,additional_credits)
    values(p_id,p_actual,trim(p_evidence),v_actor,v_refund,v_extra);
  perform private.audit(v_actor,'staff','provider_spend.reconciled','provider_spend',p_id::text,trim(p_evidence),
    jsonb_build_object('estimated_paise',s.estimated_paise),jsonb_build_object('actual_paise',p_actual,'refunded_credits',v_refund,'additional_credits',v_extra));
  return jsonb_build_object('duplicate',false,'refunded_credits',v_refund,'additional_credits',v_extra);
end; $$;
revoke all on function public.admin_reconcile_provider_spend(bigint,bigint,text) from public,anon,service_role;
grant execute on function public.admin_reconcile_provider_spend(bigint,bigint,text) to authenticated;
