-- NYNZ release 0.3, part 8: capability-checked admin reporting.
-- Reads of customer and financial data go through these functions, so the
-- database enforces staff permissions for reports as well as for mutations.

create or replace function public.admin_overview(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.assert_staff('overview.read');
  if p_to <= p_from or p_to - p_from > interval '400 days' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  select jsonb_build_object(
    'generated_at', now(), 'from', p_from, 'to', p_to,
    'users', jsonb_build_object(
      'registered', (select count(*) from auth.users where deleted_at is null),
      'registered_in_range', (select count(*) from auth.users where created_at >= p_from and created_at < p_to),
      'verified', (select count(*) from auth.users where email_confirmed_at is not null and deleted_at is null),
      'active_in_range', (select count(*) from public.user_activity where last_activity_at >= p_from and last_activity_at < p_to),
      'present_now_approx', (select count(*) from public.user_activity where last_presence_at > now() - interval '2 minutes'),
      'suspended', (select count(*) from public.account_status where status = 'suspended'),
      'paying', (select count(distinct user_id) from public.subscriptions where status = 'active' or (status = 'pending' and grace_until > now()))),
    'projects', jsonb_build_object('total', (select count(*) from public.projects), 'created_in_range', (select count(*) from public.projects where created_at >= p_from and created_at < p_to)),
    'builds', (select jsonb_build_object(
        'succeeded', count(*) filter (where status = 'succeeded'), 'failed', count(*) filter (where status = 'failed'),
        'cancelled', count(*) filter (where status = 'cancelled'), 'total', count(*))
      from public.build_jobs where created_at >= p_from and created_at < p_to),
    'queue', (select jsonb_build_object(
        'queued', count(*) filter (where status = 'queued'),
        'awaiting_approval', count(*) filter (where status = 'planning' and locked_by is null),
        'running', count(*) filter (where status in ('planning','generating','installing','running','validating') and locked_by is not null),
        'oldest_queued_at', min(created_at) filter (where status = 'queued'))
      from public.build_jobs where status in ('queued','planning','generating','installing','running','validating')),
    'money', jsonb_build_object(
      'currency', 'INR',
      'gross_collected_minor', (select coalesce(sum(amount_minor), 0) from public.payments where status in ('captured','refunded','partially_refunded') and captured_at >= p_from and captured_at < p_to),
      'tax_collected_minor', (select coalesce(sum(tax_minor), 0) from public.payments where status in ('captured','refunded','partially_refunded') and captured_at >= p_from and captured_at < p_to),
      'revenue_net_minor', (select coalesce(sum(net_minor), 0) from public.payments where status in ('captured','refunded','partially_refunded') and captured_at >= p_from and captured_at < p_to),
      'refunds_minor', (select coalesce(sum(amount_minor), 0) from public.refunds where status = 'processed' and processed_at >= p_from and processed_at < p_to),
      'recorded_expenses_minor', (select coalesce(sum(amount_minor), 0) from public.company_expenses where incurred_on >= p_from::date and incurred_on < p_to::date),
      'failed_payments', (select count(*) from public.payments where status = 'failed' and created_at >= p_from and created_at < p_to)),
    'provider_spend', (select coalesce(jsonb_agg(x order by x->>'provider'), '[]'::jsonb) from (
      select jsonb_build_object('provider', provider,
        'actual_minor', coalesce(sum(actual_paise) filter (where status = 'settled' and cost_source = 'provider_reported'), 0),
        'estimated_minor', coalesce(sum(coalesce(actual_paise, estimated_paise)) filter (where status <> 'voided' and coalesce(cost_source, 'estimate') <> 'provider_reported'), 0),
        'calls', count(*)) x
      from public.provider_spend where created_at >= p_from and created_at < p_to group by provider) s),
    'historical_usage', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select jsonb_build_object('provider', provider, 'kind', kind, 'quantity', sum(quantity), 'estimated_cost_minor', coalesce(sum(estimated_cost_minor), 0)) x
      from public.usage_events where created_at >= p_from and created_at < p_to group by provider, kind) u),
    'workers', (select coalesce(jsonb_agg(jsonb_build_object('worker_id', worker_id, 'status', status, 'last_seen_at', last_seen_at, 'capabilities', capabilities,
        'stale', last_seen_at < now() - interval '90 seconds')), '[]'::jsonb) from public.worker_heartbeats where last_seen_at > now() - interval '7 days'),
    'previews', jsonb_build_object(
      'live', (select count(*) from public.platform_resources where kind = 'e2b_sandbox' and state in ('active','paused')),
      'pending_cleanup', (select count(*) from public.platform_resources where state = 'terminating'),
      'cleanup_failed', (select count(*) from public.platform_resources where state = 'failed')),
    'last_maintenance', (select to_jsonb(m) from (select id, started_at, finished_at, summary, error from public.maintenance_runs order by id desc limit 1) m)
  ) into v;
  return v;
end; $$;

create or replace function public.admin_search_users(p_query text, p_filter text, p_limit integer, p_offset integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := '%' || lower(coalesce(trim(p_query), '')) || '%'; v jsonb;
begin
  perform private.assert_staff('users.read');
  with base as (
    select u.id, u.email, u.created_at, u.email_confirmed_at, u.last_sign_in_at,
      coalesce(a.status, 'active') as account_status, ua.last_activity_at, ua.last_presence_at,
      (select p.code from public.subscriptions s join public.plans p on p.id = s.plan_id where s.user_id = u.id and s.status in ('active','pending','authenticated','cancelled') order by s.created_at desc limit 1) as plan_code,
      (select count(*) from public.projects pr where pr.owner_id = u.id) as projects,
      sm.role as staff_role
    from auth.users u
    left join public.account_status a on a.user_id = u.id
    left join public.user_activity ua on ua.user_id = u.id
    left join public.staff_members sm on sm.user_id = u.id and sm.status = 'active'
    where u.deleted_at is null and (lower(u.email) like v_q or u.id::text like v_q)
  ), filtered as (
    select * from base where case coalesce(p_filter, 'all')
      when 'suspended' then account_status = 'suspended'
      when 'unverified' then email_confirmed_at is null
      when 'paying' then plan_code is not null and plan_code <> 'free'
      when 'staff' then staff_role is not null
      when 'active_7d' then last_activity_at > now() - interval '7 days'
      else true end
  )
  select jsonb_build_object('total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from (select * from filtered order by created_at desc limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)) f), '[]'::jsonb))
  into v;
  return v;
end; $$;

create or replace function public.admin_user_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; caps text[];
begin
  perform private.assert_staff('users.read');
  caps := private.staff_capabilities(auth.uid());
  select jsonb_build_object(
    'user', (select jsonb_build_object('id', id, 'email', email, 'created_at', created_at, 'email_confirmed_at', email_confirmed_at, 'last_sign_in_at', last_sign_in_at, 'banned_until', banned_until) from auth.users where id = p_user),
    'account', (select to_jsonb(a) from public.account_status a where user_id = p_user),
    'activity', (select to_jsonb(ua) from public.user_activity ua where user_id = p_user),
    'sessions', (select count(*) from auth.sessions where user_id = p_user),
    'mfa_factors', (select count(*) from auth.mfa_factors where user_id = p_user and status = 'verified'),
    'staff', (select jsonb_build_object('role', role, 'status', status) from public.staff_members where user_id = p_user),
    'entitlements', public.current_entitlements(p_user),
    'credits', case when 'credits.read' = any (caps) then public.credit_balance(p_user) end,
    'credit_history', case when 'credits.read' = any (caps) then (select coalesce(jsonb_agg(to_jsonb(l) order by l.id desc), '[]'::jsonb) from (select id, entry_type, amount, reason, provider, model, cost_paise, cost_source, actor_id, created_at from public.credit_ledger where user_id = p_user order by id desc limit 50) l) end,
    'subscriptions', case when 'billing.read' = any (caps) then (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'plan', p.code, 'status', s.status, 'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end, 'provider_subscription_id', s.provider_subscription_id) order by s.created_at desc), '[]'::jsonb) from public.subscriptions s join public.plans p on p.id = s.plan_id where s.user_id = p_user) end,
    'payments', case when 'billing.read' = any (caps) then (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) from (select id, kind, amount_minor, tax_minor, net_minor, status, refunded_minor, provider_payment_id, captured_at, created_at from public.payments where user_id = p_user order by created_at desc limit 50) x) end,
    'projects', case when 'projects.read' = any (caps) then (select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb) from (select id, name, status, updated_at, created_at from public.projects where owner_id = p_user order by updated_at desc limit 50) x) end,
    'usage_30d', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select jsonb_build_object('provider', provider, 'kind', kind, 'quantity', sum(quantity), 'estimated_cost_minor', coalesce(sum(estimated_cost_minor), 0)) x from public.usage_events where owner_id = p_user and created_at > now() - interval '30 days' group by provider, kind) u)
  ) into v;
  return v;
end; $$;

create or replace function public.admin_search_projects(p_query text, p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := '%' || lower(coalesce(trim(p_query), '')) || '%';
begin
  perform private.assert_staff('projects.read');
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select p.id, p.name, p.status, p.updated_at, p.owner_id, u.email as owner_email, p.source_revision, p.preview_revision,
      (select status from public.build_jobs j where j.project_id = p.id order by created_at desc limit 1) as last_build_status
    from public.projects p join auth.users u on u.id = p.owner_id
    where lower(p.name) like v_q or p.id::text like v_q or lower(u.email) like v_q or p.owner_id::text like v_q
    order by p.updated_at desc limit least(greatest(p_limit, 1), 100)) x), '[]'::jsonb);
end; $$;

create or replace function public.admin_project_detail(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_staff('projects.read');
  return jsonb_build_object(
    'project', (select jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'owner_id', p.owner_id, 'owner_email', u.email, 'created_at', p.created_at, 'updated_at', p.updated_at,
       'source_revision', p.source_revision, 'preview_revision', p.preview_revision, 'active_version_id', p.active_version_id, 'has_preview', p.active_sandbox_id is not null, 'last_error', p.last_error,
       'file_count', (select count(*) from public.project_files f where f.project_id = p.id)) from public.projects p join auth.users u on u.id = p.owner_id where p.id = p_project),
    'builds', (select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc), '[]'::jsonb) from (select id, status, mode, error_code, error_message, attempt_count, locked_by, locked_at, created_at, finished_at, cancel_requested_at, generation_complete from public.build_jobs where project_id = p_project order by created_at desc limit 30) j),
    'versions', (select coalesce(jsonb_agg(to_jsonb(v) order by v.created_at desc), '[]'::jsonb) from (select id, label, kind, file_count, source_build_id, created_at from public.versions where project_id = p_project order by created_at desc limit 30) v),
    'resources', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'state', state, 'purpose', purpose, 'created_at', created_at, 'last_accessed_at', last_accessed_at, 'terminate_reason', terminate_reason)), '[]'::jsonb) from public.platform_resources where project_id = p_project),
    'usage', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select jsonb_build_object('provider', provider, 'kind', kind, 'quantity', sum(quantity), 'estimated_cost_minor', coalesce(sum(estimated_cost_minor), 0)) x from public.usage_events where project_id = p_project group by provider, kind) u)
  );
end; $$;

do $$ declare f text; begin
  foreach f in array array['admin_overview(timestamptz,timestamptz)', 'admin_search_users(text,text,integer,integer)', 'admin_user_detail(uuid)',
    'admin_search_projects(text,integer)', 'admin_project_detail(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Service-only lookup used when resending invitations (decides between an
-- activation email and in-app acceptance). Never exposed to clients.
create or replace function public.user_id_for_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) and deleted_at is null limit 1;
$$;
revoke all on function public.user_id_for_email(text) from public, anon, authenticated;
grant execute on function public.user_id_for_email(text) to service_role;
