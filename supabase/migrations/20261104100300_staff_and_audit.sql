-- NYNZ release 0.3, part 4: staff membership, permissions and audit history.
--
-- Staff access is separate from customer plans and from profiles.role. Every
-- privileged mutation is a SECURITY DEFINER function that:
--   * identifies the caller from the verified JWT (auth.uid()), requires that
--     the session still exists (so revocation applies to existing sessions),
--     re-reads the caller's staff record on every call (so suspension and
--     permission changes apply to the next request), enforces MFA when the
--     account has a verified factor or MFA is required, and can require recent
--     authentication;
--   * checks the specific capability;
--   * writes its audit event in the same transaction, so the mutation cannot
--     commit without its audit record.
-- The audit table is append-only (trigger + privileges) and hash-chained.

-- Capabilities and roles ------------------------------------------------------
do $$ begin
  create type public.staff_role as enum ('owner', 'operations', 'support', 'billing', 'readonly');
exception when duplicate_object then null; end $$;

create table if not exists public.staff_capabilities (
  code text primary key,
  description text not null,
  owner_level boolean not null default false
);
insert into public.staff_capabilities(code, description, owner_level) values
  ('admin.access', 'Open the admin console', false),
  ('overview.read', 'View platform overview reports', false),
  ('users.read', 'Search and view customer accounts', false),
  ('users.suspend', 'Suspend or reactivate customer accounts', false),
  ('users.invite', 'Invite new customers', false),
  ('users.reset_password', 'Send password-reset links', false),
  ('users.revoke_sessions', 'Sign customers out of all sessions', false),
  ('projects.read', 'View project and build metadata', false),
  ('projects.read_content', 'Open private project source (audited)', false),
  ('builds.operate', 'Cancel, recover and restart builds', false),
  ('credits.read', 'View credit balances and history', false),
  ('credits.grant', 'Grant credits within role limits', false),
  ('credits.adjust_large', 'Large grants and credit deductions', false),
  ('billing.read', 'View subscriptions, payments and expenses', false),
  ('billing.refund', 'Issue authorised refunds', false),
  ('expenses.manage', 'Record company expenses and provider balances', false),
  ('providers.read', 'View provider usage, balances and health', false),
  ('operations.cleanup', 'Run resource cleanup and reconciliation', false),
  ('team.read', 'View staff and invitations', false),
  ('audit.read', 'Read the audit history', false),
  ('plans.manage', 'Create and change customer plans', true),
  ('providers.manage', 'Change spending limits and alerts', true),
  ('team.manage', 'Invite staff and change staff access', true),
  ('owner.manage', 'Appoint owners and transfer ownership', true)
on conflict (code) do update set description = excluded.description, owner_level = excluded.owner_level;

create table if not exists public.staff_role_capabilities (
  role public.staff_role not null,
  capability text not null references public.staff_capabilities(code),
  primary key (role, capability)
);
insert into public.staff_role_capabilities(role, capability)
select 'owner'::public.staff_role, code from public.staff_capabilities
union all select 'operations', unnest(array['admin.access','overview.read','users.read','users.suspend','projects.read','projects.read_content','builds.operate','credits.read','providers.read','operations.cleanup','team.read','audit.read'])
union all select 'support', unnest(array['admin.access','overview.read','users.read','users.invite','users.reset_password','users.revoke_sessions','projects.read','credits.read','credits.grant'])
union all select 'billing', unnest(array['admin.access','overview.read','users.read','credits.read','credits.grant','credits.adjust_large','billing.read','billing.refund','providers.read','expenses.manage'])
union all select 'readonly', unnest(array['admin.access','overview.read','users.read','projects.read','credits.read','billing.read','providers.read','team.read','audit.read'])
on conflict do nothing;

create table if not exists public.staff_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  email text not null,
  display_name text,
  role public.staff_role not null,
  extra_capabilities text[] not null default '{}',
  revoked_capabilities text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'suspended', 'removed')),
  status_reason text,
  require_mfa boolean not null default false,
  invited_by uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text,
  role public.staff_role not null,
  extra_capabilities text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  send_count integer not null default 0,
  last_sent_at timestamptz,
  last_delivery text,
  accepted_by uuid,
  accepted_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason text
);
create unique index if not exists staff_invitations_one_pending on public.staff_invitations(email) where status = 'pending';

create table if not exists public.owner_bootstrap_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  email text not null,
  result text not null,
  ran_at timestamptz not null default now()
);

-- Audit history ---------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  actor_kind text not null check (actor_kind in ('staff', 'customer', 'system', 'bootstrap', 'provider')),
  action text not null,
  target_type text,
  target_id text,
  reason text,
  before jsonb,
  after jsonb,
  metadata jsonb not null default '{}'::jsonb,
  outcome text not null default 'succeeded' check (outcome in ('succeeded', 'failed', 'requested', 'noop')),
  related_id bigint,
  prev_hash text,
  hash text not null
);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log(target_type, target_id, occurred_at desc);
create index if not exists admin_audit_log_actor_idx on public.admin_audit_log(actor_id, occurred_at desc);

-- Remove secret-looking values and unnecessary personal data from audit JSON.
create or replace function private.redact_json(p jsonb) returns jsonb language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; out jsonb;
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) = 'array' then
    select coalesce(jsonb_agg(private.redact_json(e)), '[]'::jsonb) into out from jsonb_array_elements(p) e; return out;
  end if;
  if jsonb_typeof(p) <> 'object' then return p; end if;
  out := '{}'::jsonb;
  for k, v in select * from jsonb_each(p) loop
    if k ~* '(password|secret|token|api_?key|service_role|signature|authorization|cookie|card|cvv|otp|private_key|publishable_key|phone)' then
      out := out || jsonb_build_object(k, '[redacted]');
    else
      out := out || jsonb_build_object(k, private.redact_json(v));
    end if;
  end loop;
  return out;
end; $$;

create or replace function private.audit_before_insert() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(7364201);
  new.before := private.redact_json(new.before);
  new.after := private.redact_json(new.after);
  new.metadata := coalesce(private.redact_json(new.metadata), '{}'::jsonb);
  new.reason := left(new.reason, 1000);
  select hash into new.prev_hash from public.admin_audit_log order by id desc limit 1;
  new.hash := encode(extensions.digest(coalesce(new.prev_hash, '') || jsonb_build_object(
    'at', new.occurred_at, 'actor', new.actor_id, 'kind', new.actor_kind, 'action', new.action, 'target_type', new.target_type,
    'target_id', new.target_id, 'reason', new.reason, 'before', new.before, 'after', new.after, 'metadata', new.metadata,
    'outcome', new.outcome, 'related', new.related_id)::text, 'sha256'), 'hex');
  return new;
end; $$;
drop trigger if exists admin_audit_log_chain on public.admin_audit_log;
create trigger admin_audit_log_chain before insert on public.admin_audit_log for each row execute function private.audit_before_insert();

create or replace function private.audit_immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'AUDIT_LOG_IS_APPEND_ONLY' using errcode = 'P0001'; end; $$;
drop trigger if exists admin_audit_log_no_update on public.admin_audit_log;
create trigger admin_audit_log_no_update before update or delete on public.admin_audit_log for each row execute function private.audit_immutable();
drop trigger if exists admin_audit_log_no_truncate on public.admin_audit_log;
create trigger admin_audit_log_no_truncate before truncate on public.admin_audit_log for each statement execute function private.audit_immutable();

create or replace function private.audit(p_actor uuid, p_kind text, p_action text, p_target_type text, p_target_id text, p_reason text,
  p_before jsonb default null, p_after jsonb default null, p_metadata jsonb default '{}'::jsonb, p_outcome text default 'succeeded', p_related bigint default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.admin_audit_log(actor_id, actor_email, actor_kind, action, target_type, target_id, reason, before, after, metadata, outcome, related_id)
  values (p_actor, (select email from auth.users where id = p_actor), p_kind, p_action, p_target_type, p_target_id, p_reason, p_before, p_after,
          coalesce(p_metadata, '{}'::jsonb), p_outcome, p_related)
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function private.audit(uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text, bigint) from public;

-- Permission helpers ----------------------------------------------------------
create or replace function private.staff_capabilities(p_user uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select case
    when s.user_id is null or s.status <> 'active' then '{}'::text[]
    when s.role = 'owner' then (select array_agg(code order by code) from public.staff_capabilities)
    else (
      select coalesce(array_agg(distinct c order by c), '{}'::text[]) from (
        select capability as c from public.staff_role_capabilities where role = s.role
        union select unnest(s.extra_capabilities)
      ) caps where c <> all (s.revoked_capabilities) and c in (select code from public.staff_capabilities)
    )
  end
  from (select 1) one left join public.staff_members s on s.user_id = p_user;
$$;

create or replace function private.session_valid() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (auth.jwt()->>'session_id') is not null and exists (
    select 1 from auth.sessions s
    where s.id = nullif(auth.jwt()->>'session_id', '')::uuid and s.user_id = auth.uid() and (s.not_after is null or s.not_after > now())
  );
$$;

create or replace function private.mfa_satisfied(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from auth.mfa_factors where user_id = p_user and status = 'verified')
      or coalesce((select require_mfa from public.staff_members where user_id = p_user), false)
    then coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
    else true end;
$$;

create or replace function private.recently_authenticated(p_seconds integer) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select max((e->>'timestamp')::bigint) from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) e), 0)
         >= extract(epoch from now())::bigint - p_seconds;
$$;

create or replace function private.has_staff_cap(p_cap text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.session_valid() and private.mfa_satisfied(auth.uid()) and p_cap = any (private.staff_capabilities(auth.uid()));
$$;

-- Raises a stable code the API maps to a safe response; returns the actor.
create or replace function private.assert_staff(p_cap text, p_recent_seconds integer default null) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.session_valid() then raise exception 'PERMISSION_DENIED' using errcode = 'P0001'; end if;
  if not (p_cap = any (private.staff_capabilities(auth.uid()))) then raise exception 'PERMISSION_DENIED' using errcode = 'P0001'; end if;
  if not private.mfa_satisfied(auth.uid()) then raise exception 'MFA_REQUIRED' using errcode = 'P0001'; end if;
  if p_recent_seconds is not null and not private.recently_authenticated(p_recent_seconds) then raise exception 'REAUTH_REQUIRED' using errcode = 'P0001'; end if;
  return auth.uid();
end; $$;

create or replace function private.is_owner(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_members where user_id = p_user and role = 'owner' and status = 'active');
$$;

-- Legacy admin read policies now follow the staff model; profiles.role no
-- longer grants anything.
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select private.has_staff_cap('projects.read'); $$;

revoke all on function private.staff_capabilities(uuid) from public;
revoke all on function private.session_valid() from public;
revoke all on function private.mfa_satisfied(uuid) from public;
revoke all on function private.recently_authenticated(integer) from public;
revoke all on function private.has_staff_cap(text) from public;
revoke all on function private.assert_staff(text, integer) from public;
revoke all on function private.is_owner(uuid) from public;
revoke all on function private.redact_json(jsonb) from public;
grant execute on function private.has_staff_cap(text) to authenticated, service_role;
grant execute on function private.is_admin() to authenticated, service_role;

-- Last active owner protection (applies to every writer, including service role).
create or replace function private.protect_last_owner() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and old.status = 'active' and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active') then
    if not exists (select 1 from public.staff_members where role = 'owner' and status = 'active' and user_id <> old.user_id) then
      raise exception 'LAST_OWNER' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); return new; end if;
  return old;
end; $$;
drop trigger if exists staff_members_last_owner on public.staff_members;
create trigger staff_members_last_owner before update or delete on public.staff_members for each row execute function private.protect_last_owner();

-- Privileges --------------------------------------------------------------------
alter table public.staff_capabilities enable row level security;
alter table public.staff_role_capabilities enable row level security;
alter table public.staff_members enable row level security;
alter table public.staff_invitations enable row level security;
alter table public.owner_bootstrap_log enable row level security;
alter table public.admin_audit_log enable row level security;
revoke all on public.staff_capabilities, public.staff_role_capabilities, public.staff_members, public.staff_invitations,
  public.owner_bootstrap_log, public.admin_audit_log from public, anon, authenticated;
revoke insert, update, delete, truncate on public.admin_audit_log from service_role;
revoke insert, update, delete, truncate on public.owner_bootstrap_log from service_role;
revoke insert, update, delete, truncate on public.staff_members, public.staff_invitations from service_role;
grant select on public.staff_capabilities, public.staff_role_capabilities, public.staff_members, public.staff_invitations,
  public.owner_bootstrap_log, public.admin_audit_log to service_role;
grant select on public.staff_capabilities, public.staff_role_capabilities to authenticated;
create policy staff_capabilities_read on public.staff_capabilities for select to authenticated using (true);
create policy staff_role_capabilities_read on public.staff_role_capabilities for select to authenticated using (true);
grant select on public.staff_members, public.staff_invitations, public.admin_audit_log to authenticated;
create policy staff_members_read on public.staff_members for select to authenticated using (user_id = auth.uid() or private.has_staff_cap('team.read'));
create policy staff_invitations_read on public.staff_invitations for select to authenticated using (private.has_staff_cap('team.read'));
create policy admin_audit_log_read on public.admin_audit_log for select to authenticated using (private.has_staff_cap('audit.read'));

-- Caller's own access summary (for UI and server checks).
create or replace function public.my_staff_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'is_staff', s.user_id is not null and s.status = 'active',
    'role', s.role, 'status', s.status, 'require_mfa', coalesce(s.require_mfa, false),
    'capabilities', to_jsonb(private.staff_capabilities(auth.uid())),
    'session_valid', private.session_valid(),
    'mfa_satisfied', private.mfa_satisfied(auth.uid()),
    'mfa_enrolled', exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified'),
    'recent_auth', private.recently_authenticated(900)
  ) from (select 1) one left join public.staff_members s on s.user_id = auth.uid();
$$;
revoke all on function public.my_staff_access() from public, anon;
grant execute on function public.my_staff_access() to authenticated;

-- Owner bootstrap (service role only, idempotent) -----------------------------
create or replace function public.bootstrap_owner(p_user uuid, p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare u record; s public.staff_members; v_result text;
begin
  select id, email, email_confirmed_at, banned_until into u from auth.users where id = p_user;
  if not found then
    insert into public.owner_bootstrap_log(user_id, email, result) values (p_user, lower(p_email), 'user_not_found');
    raise exception 'OWNER_BOOTSTRAP_USER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if lower(coalesce(u.email, '')) <> lower(trim(p_email)) then
    insert into public.owner_bootstrap_log(user_id, email, result) values (p_user, lower(p_email), 'email_mismatch');
    raise exception 'OWNER_BOOTSTRAP_EMAIL_MISMATCH' using errcode = 'P0001';
  end if;
  if u.email_confirmed_at is null then
    insert into public.owner_bootstrap_log(user_id, email, result) values (p_user, lower(p_email), 'email_not_verified');
    raise exception 'EMAIL_NOT_VERIFIED' using errcode = 'P0001';
  end if;
  if u.banned_until is not null and u.banned_until > now() then
    insert into public.owner_bootstrap_log(user_id, email, result) values (p_user, lower(p_email), 'user_banned');
    raise exception 'OWNER_BOOTSTRAP_USER_BANNED' using errcode = 'P0001';
  end if;
  select * into s from public.staff_members where user_id = p_user;
  if found and s.role = 'owner' and s.status = 'active' then
    v_result := 'already_owner';
  elsif found then
    update public.staff_members set role = 'owner', status = 'active', status_reason = null, email = lower(u.email), version = version + 1 where user_id = p_user;
    v_result := 'promoted_existing_staff';
  else
    insert into public.staff_members(user_id, email, role, status) values (p_user, lower(u.email), 'owner', 'active');
    v_result := 'created_owner';
  end if;
  insert into public.owner_bootstrap_log(user_id, email, result) values (p_user, lower(u.email), v_result);
  perform private.audit(null, 'bootstrap', 'owner.bootstrap', 'user', p_user::text, 'Verified owner bootstrap (exact user id and email)',
    case when s.user_id is null then null else jsonb_build_object('role', s.role, 'status', s.status) end,
    jsonb_build_object('role', 'owner', 'status', 'active'), jsonb_build_object('result', v_result),
    case when v_result = 'already_owner' then 'noop' else 'succeeded' end);
  return v_result;
end; $$;
revoke all on function public.bootstrap_owner(uuid, text) from public, anon, authenticated;
grant execute on function public.bootstrap_owner(uuid, text) to service_role;

-- Staff administration ------------------------------------------------------
create or replace function private.validate_caps(p_actor uuid, p_role public.staff_role, p_caps text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_unknown text; v_owner_level boolean;
begin
  select c into v_unknown from unnest(coalesce(p_caps, '{}')) c where c not in (select code from public.staff_capabilities) limit 1;
  if v_unknown is not null then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'Unknown capability'; end if;
  select exists (select 1 from public.staff_capabilities where owner_level and code = any (coalesce(p_caps, '{}'))) into v_owner_level;
  if (p_role = 'owner' or v_owner_level) and not private.is_owner(p_actor) then raise exception 'OWNER_ONLY' using errcode = 'P0001'; end if;
  -- Non-owners can never grant more than they hold themselves.
  if not private.is_owner(p_actor) and exists (
    select 1 from (select unnest(coalesce(p_caps, '{}')) c union select capability from public.staff_role_capabilities where role = p_role) wanted
    where c <> all (private.staff_capabilities(p_actor))
  ) then raise exception 'PERMISSION_DENIED' using errcode = 'P0001', detail = 'Cannot grant capabilities you do not hold'; end if;
end; $$;
revoke all on function private.validate_caps(uuid, public.staff_role, text[]) from public;

create or replace function public.admin_invite_staff(p_email text, p_name text, p_role public.staff_role, p_caps text[], p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_email text := lower(trim(p_email)); v_inv uuid; v_user record; v_old uuid;
begin
  v_actor := private.assert_staff('team.manage', 900);
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'Invalid email'; end if;
  perform private.validate_caps(v_actor, p_role, p_caps);
  select id, email_confirmed_at into v_user from auth.users where lower(email) = v_email and deleted_at is null limit 1;
  if v_user.id is not null and exists (select 1 from public.staff_members where user_id = v_user.id and status in ('active', 'suspended')) then
    raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'Already a staff member';
  end if;
  update public.staff_invitations set status = 'revoked', revoked_by = v_actor, revoked_at = now(), revoke_reason = 'superseded'
  where email = v_email and status = 'pending' returning id into v_old;
  insert into public.staff_invitations(email, display_name, role, extra_capabilities, invited_by, expires_at, send_count, last_sent_at)
  values (v_email, nullif(left(trim(p_name), 120), ''), p_role, coalesce(p_caps, '{}'), v_actor, now() + interval '7 days', 1, now())
  returning id into v_inv;
  perform private.audit(v_actor, 'staff', 'staff.invitation.created', 'staff_invitation', v_inv::text, p_reason, null,
    jsonb_build_object('email_domain', split_part(v_email, '@', 2), 'role', p_role, 'capabilities', coalesce(p_caps, '{}'), 'existing_user', v_user.id is not null),
    jsonb_build_object('superseded', v_old));
  return jsonb_build_object('invitation_id', v_inv, 'existing_user_id', v_user.id, 'existing_user_verified', v_user.email_confirmed_at is not null);
end; $$;

create or replace function public.admin_resend_staff_invitation(p_invitation uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; i public.staff_invitations;
begin
  v_actor := private.assert_staff('team.manage', 900);
  select * into i from public.staff_invitations where id = p_invitation for update;
  if not found or i.status <> 'pending' then raise exception 'INVITATION_INVALID' using errcode = 'P0001'; end if;
  perform private.validate_caps(v_actor, i.role, i.extra_capabilities);
  update public.staff_invitations set expires_at = now() + interval '7 days', send_count = send_count + 1, last_sent_at = now() where id = p_invitation;
  perform private.audit(v_actor, 'staff', 'staff.invitation.resent', 'staff_invitation', p_invitation::text, p_reason, jsonb_build_object('expires_at', i.expires_at), jsonb_build_object('send_count', i.send_count + 1));
end; $$;

create or replace function public.admin_revoke_staff_invitation(p_invitation uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; i public.staff_invitations;
begin
  v_actor := private.assert_staff('team.manage', 900);
  select * into i from public.staff_invitations where id = p_invitation for update;
  if not found or i.status <> 'pending' then raise exception 'INVITATION_INVALID' using errcode = 'P0001'; end if;
  if i.role = 'owner' and not private.is_owner(v_actor) then raise exception 'OWNER_ONLY' using errcode = 'P0001'; end if;
  update public.staff_invitations set status = 'revoked', revoked_by = v_actor, revoked_at = now(), revoke_reason = left(p_reason, 500) where id = p_invitation;
  perform private.audit(v_actor, 'staff', 'staff.invitation.revoked', 'staff_invitation', p_invitation::text, p_reason, jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'revoked'));
end; $$;

create or replace function public.admin_record_invitation_delivery(p_invitation uuid, p_delivery text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := private.assert_staff('team.manage');
  if p_delivery not in ('email_sent', 'in_app_only', 'email_failed') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  update public.staff_invitations set last_delivery = p_delivery where id = p_invitation and status = 'pending';
  perform private.audit(v_actor, 'staff', 'staff.invitation.delivery', 'staff_invitation', p_invitation::text, null, null, jsonb_build_object('delivery', p_delivery),
    '{}'::jsonb, case when p_delivery = 'email_failed' then 'failed' else 'succeeded' end);
end; $$;

-- Pending invitations addressed to the caller's verified email.
create or replace function public.my_staff_invitations() returns table(id uuid, role public.staff_role, expires_at timestamptz, invited_by_email text)
language sql stable security definer set search_path = '' as $$
  select i.id, i.role, i.expires_at, (select email from auth.users where id = i.invited_by)
  from public.staff_invitations i join auth.users u on u.id = auth.uid()
  where i.status = 'pending' and i.expires_at > now() and i.email = lower(u.email) and u.email_confirmed_at is not null and private.session_valid();
$$;

create or replace function public.accept_staff_invitation(p_invitation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.staff_invitations; u record; s public.staff_members;
begin
  if auth.uid() is null or not private.session_valid() then raise exception 'PERMISSION_DENIED' using errcode = 'P0001'; end if;
  select * into i from public.staff_invitations where id = p_invitation for update;
  if not found or i.status <> 'pending' or i.expires_at <= now() then raise exception 'INVITATION_INVALID' using errcode = 'P0001'; end if;
  select id, email, email_confirmed_at into u from auth.users where id = auth.uid();
  if lower(u.email) <> i.email then raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = 'P0001'; end if;
  if u.email_confirmed_at is null then raise exception 'EMAIL_NOT_VERIFIED' using errcode = 'P0001'; end if;
  -- The inviter must still be allowed to grant this access at acceptance time.
  if not ('team.manage' = any (private.staff_capabilities(i.invited_by))) or ((i.role = 'owner' or exists (
      select 1 from public.staff_capabilities where owner_level and code = any (i.extra_capabilities))) and not private.is_owner(i.invited_by)) then
    raise exception 'INVITATION_INVALID' using errcode = 'P0001';
  end if;
  select * into s from public.staff_members where user_id = u.id for update;
  if found and s.status in ('active', 'suspended') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if found then
    update public.staff_members set role = i.role, extra_capabilities = i.extra_capabilities, revoked_capabilities = '{}', status = 'active',
      status_reason = null, display_name = coalesce(i.display_name, display_name), invited_by = i.invited_by, email = lower(u.email), version = version + 1
    where user_id = u.id;
  else
    insert into public.staff_members(user_id, email, display_name, role, extra_capabilities, invited_by)
    values (u.id, lower(u.email), i.display_name, i.role, i.extra_capabilities, i.invited_by);
  end if;
  update public.staff_invitations set status = 'accepted', accepted_by = u.id, accepted_at = now() where id = i.id;
  perform private.audit(u.id, 'staff', 'staff.invitation.accepted', 'staff_invitation', i.id::text, null, null,
    jsonb_build_object('role', i.role, 'capabilities', i.extra_capabilities, 'relinked_existing_staff_record', found));
  return jsonb_build_object('role', i.role);
end; $$;

create or replace function public.admin_update_staff(p_user uuid, p_role public.staff_role, p_extra text[], p_revoked text[], p_require_mfa boolean, p_expected_version integer, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; s public.staff_members;
begin
  v_actor := private.assert_staff('team.manage', 900);
  if p_user = v_actor then raise exception 'SELF_MODIFICATION' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'A reason is required'; end if;
  select * into s from public.staff_members where user_id = p_user for update;
  if not found or s.status = 'removed' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if s.version <> p_expected_version then raise exception 'STALE_VERSION' using errcode = 'P0001'; end if;
  if s.role = 'owner' and not private.is_owner(v_actor) then raise exception 'OWNER_ONLY' using errcode = 'P0001'; end if;
  perform private.validate_caps(v_actor, p_role, p_extra);
  if p_role = 'owner' and not private.recently_authenticated(300) then raise exception 'REAUTH_REQUIRED' using errcode = 'P0001'; end if;
  update public.staff_members set role = p_role, extra_capabilities = coalesce(p_extra, '{}'), revoked_capabilities = coalesce(p_revoked, '{}'),
    require_mfa = coalesce(p_require_mfa, require_mfa), version = version + 1
  where user_id = p_user;
  perform private.audit(v_actor, 'staff', case when p_role = 'owner' and s.role <> 'owner' then 'owner.appointed' else 'staff.access.updated' end,
    'staff_member', p_user::text, p_reason,
    jsonb_build_object('role', s.role, 'extra', s.extra_capabilities, 'revoked', s.revoked_capabilities, 'require_mfa', s.require_mfa),
    jsonb_build_object('role', p_role, 'extra', coalesce(p_extra, '{}'), 'revoked', coalesce(p_revoked, '{}'), 'require_mfa', coalesce(p_require_mfa, s.require_mfa)));
end; $$;

create or replace function public.admin_set_staff_status(p_user uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; s public.staff_members;
begin
  v_actor := private.assert_staff('team.manage', 900);
  if p_user = v_actor then raise exception 'SELF_MODIFICATION' using errcode = 'P0001'; end if;
  if p_status not in ('active', 'suspended', 'removed') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'A reason is required'; end if;
  select * into s from public.staff_members where user_id = p_user for update;
  if not found then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if s.role = 'owner' and not private.is_owner(v_actor) then raise exception 'OWNER_ONLY' using errcode = 'P0001'; end if;
  if p_status = 'active' and s.status = 'removed' then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'Re-invite removed staff'; end if;
  -- Only staff access changes. The person's customer account, projects and
  -- sign-in are untouched.
  update public.staff_members set status = p_status, status_reason = left(p_reason, 500), version = version + 1 where user_id = p_user;
  perform private.audit(v_actor, 'staff', 'staff.status.' || p_status, 'staff_member', p_user::text, p_reason,
    jsonb_build_object('status', s.status), jsonb_build_object('status', p_status));
end; $$;

-- Ownership transfer step 2: an owner may step down once another active
-- owner exists (step 1 is appointing the new owner with admin_update_staff).
create or replace function public.admin_step_down_owner(p_new_role public.staff_role, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := private.assert_staff('owner.manage', 300);
  if p_new_role = 'owner' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  update public.staff_members set role = p_new_role, extra_capabilities = '{}', revoked_capabilities = '{}', version = version + 1 where user_id = v_actor;
  perform private.audit(v_actor, 'staff', 'owner.stepped_down', 'staff_member', v_actor::text, p_reason, jsonb_build_object('role', 'owner'), jsonb_build_object('role', p_new_role));
end; $$;

-- Customer account administration -------------------------------------------
create or replace function private.assert_not_protected_target(p_actor uuid, p_target uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor = p_target then raise exception 'SELF_MODIFICATION' using errcode = 'P0001'; end if;
  if private.is_owner(p_target) and not private.is_owner(p_actor) then raise exception 'OWNER_ONLY' using errcode = 'P0001'; end if;
end; $$;

create or replace function public.admin_set_account_status(p_user uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_before text;
begin
  v_actor := private.assert_staff('users.suspend', 900);
  perform private.assert_not_protected_target(v_actor, p_user);
  if p_status not in ('active', 'suspended') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'A reason is required'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  select status into v_before from public.account_status where user_id = p_user;
  insert into public.account_status(user_id, status, reason, changed_by, changed_at) values (p_user, p_status, left(p_reason, 1000), v_actor, now())
  on conflict (user_id) do update set status = excluded.status, reason = excluded.reason, changed_by = excluded.changed_by, changed_at = now();
  if p_status = 'suspended' then
    update public.build_jobs set status = 'cancelled', finished_at = now(), error_code = 'ACCOUNT_SUSPENDED', error_message = 'Cancelled because the account was suspended.'
    where requested_by = p_user and status = 'queued';
    update public.build_jobs set cancel_requested_at = coalesce(cancel_requested_at, now())
    where requested_by = p_user and status in ('planning','generating','installing','running','validating');
  end if;
  perform private.audit(v_actor, 'staff', 'account.' || case when p_status = 'active' then 'reactivated' else 'suspended' end, 'user', p_user::text, p_reason,
    jsonb_build_object('status', coalesce(v_before, 'active')), jsonb_build_object('status', p_status));
end; $$;

create or replace function public.admin_revoke_user_sessions(p_user uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_count integer;
begin
  v_actor := private.assert_staff('users.revoke_sessions', 900);
  perform private.assert_not_protected_target(v_actor, p_user);
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  perform private.audit(v_actor, 'staff', 'account.sessions_revoked', 'user', p_user::text, p_reason, null, jsonb_build_object('sessions', v_count));
  return v_count;
end; $$;

-- Generic audited record for actions performed through provider APIs (for
-- example a password-reset email). The server records the request first and
-- performs the action only if this succeeds, then records the result.
create or replace function public.admin_log_action(p_cap text, p_action text, p_target_type text, p_target_id text, p_reason text, p_metadata jsonb, p_recent_seconds integer default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := private.assert_staff(p_cap, p_recent_seconds);
  if p_target_type = 'user' then perform private.assert_not_protected_target(v_actor, p_target_id::uuid); end if;
  if p_action !~ '^[a-z_.]{3,80}$' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
  return private.audit(v_actor, 'staff', p_action, p_target_type, p_target_id, p_reason, null, null, p_metadata, 'requested');
end; $$;

create or replace function public.admin_log_action_result(p_request bigint, p_succeeded boolean, p_metadata jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare r public.admin_audit_log;
begin
  select * into r from public.admin_audit_log where id = p_request;
  if not found or r.actor_id is distinct from auth.uid() or r.outcome <> 'requested' or not private.session_valid() then raise exception 'PERMISSION_DENIED' using errcode = 'P0001'; end if;
  return private.audit(auth.uid(), 'staff', r.action || '.result', r.target_type, r.target_id, null, null, null, p_metadata,
    case when p_succeeded then 'succeeded' else 'failed' end, p_request);
end; $$;

create or replace function public.admin_open_project_content(p_project uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := private.assert_staff('projects.read_content');
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'A reason is required'; end if;
  if not exists (select 1 from public.projects where id = p_project) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform private.audit(v_actor, 'staff', 'project.content.viewed', 'project', p_project::text, p_reason);
end; $$;

create or replace function public.admin_build_action(p_build uuid, p_action text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; j public.build_jobs; v_new uuid;
begin
  v_actor := private.assert_staff('builds.operate');
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'INVALID_STATE' using errcode = 'P0001', detail = 'A reason is required'; end if;
  select * into j from public.build_jobs where id = p_build for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if p_action = 'cancel' then
    if j.status not in ('queued','planning','generating','installing','running','validating') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
    if j.status = 'queued' or (j.status = 'planning' and j.locked_by is null) then
      update public.build_jobs set status = 'cancelled', finished_at = now(), cancel_requested_at = now() where id = p_build;
      update public.projects set status = case when active_sandbox_id is not null then 'ready'::public.project_status else 'draft'::public.project_status end where id = j.project_id;
    else
      update public.build_jobs set cancel_requested_at = coalesce(cancel_requested_at, now()) where id = p_build;
    end if;
  elsif p_action = 'recover' then
    -- Only for builds whose worker has stopped heartbeating.
    if j.status not in ('planning','generating','installing','running','validating') or j.locked_at > now() - interval '10 minutes' then
      raise exception 'INVALID_STATE' using errcode = 'P0001';
    end if;
    perform public.finish_build_unsuccessfully(p_build, j.locked_by, 'failed', 'RECOVERED_BY_STAFF', 'This build was stopped by NYNZ support. Your previous working version is unchanged.');
  elsif p_action = 'restart_preview' then
    if exists (select 1 from public.build_jobs where project_id = j.project_id and status in ('queued','planning','generating','installing','running','validating')) then
      raise exception 'BUILD_ACTIVE' using errcode = 'P0001';
    end if;
    insert into public.build_jobs(project_id, requested_by, prompt, mode, idempotency_key)
    values (j.project_id, j.requested_by, 'Restart the current application without changing its files.', 'restart', 'staff-restart-' || gen_random_uuid())
    returning id into v_new;
  else
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  perform private.audit(v_actor, 'staff', 'build.' || p_action, 'build', p_build::text, p_reason,
    jsonb_build_object('status', j.status), jsonb_build_object('new_build', v_new), jsonb_build_object('project_id', j.project_id));
  return jsonb_build_object('new_build_id', v_new);
end; $$;

do $$ declare f text; begin
  foreach f in array array[
    'admin_invite_staff(text,text,public.staff_role,text[],text)', 'admin_resend_staff_invitation(uuid,text)', 'admin_revoke_staff_invitation(uuid,text)',
    'admin_record_invitation_delivery(uuid,text)', 'my_staff_invitations()', 'accept_staff_invitation(uuid)',
    'admin_update_staff(uuid,public.staff_role,text[],text[],boolean,integer,text)', 'admin_set_staff_status(uuid,text,text)',
    'admin_step_down_owner(public.staff_role,text)', 'admin_set_account_status(uuid,text,text)', 'admin_revoke_user_sessions(uuid,text)',
    'admin_log_action(text,text,text,text,text,jsonb,integer)', 'admin_log_action_result(bigint,boolean,jsonb)',
    'admin_open_project_content(uuid,text)', 'admin_build_action(uuid,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function private.assert_not_protected_target(uuid, uuid) from public;
