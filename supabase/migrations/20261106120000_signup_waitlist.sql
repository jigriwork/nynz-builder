-- NYNZ 0.5.1: invite-only signups. New accounts are created only by
-- invitation while NYNZ is in testing; people who want to join leave their
-- email on the signup screen. Additive: one table and one function.
create table if not exists public.signup_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254),
  email_normalized text generated always as (lower(btrim(email))) stored,
  source text not null default 'signup' check (char_length(source) <= 40),
  requests integer not null default 1,
  created_at timestamptz not null default now(),
  last_requested_at timestamptz not null default now(),
  invited_at timestamptz
);
create unique index if not exists signup_waitlist_email_idx on public.signup_waitlist(email_normalized);
alter table public.signup_waitlist enable row level security;
revoke all on public.signup_waitlist from public, anon, authenticated;
grant select, insert, update on public.signup_waitlist to service_role;

-- Records a request to join; repeated requests only update the count.
create or replace function public.join_waitlist(p_email text, p_source text default 'signup')
returns void language sql security definer set search_path = '' as $$
  insert into public.signup_waitlist(email, source) values (btrim(p_email), coalesce(nullif(btrim(p_source), ''), 'signup'))
  on conflict (email_normalized) do update set requests = public.signup_waitlist.requests + 1, last_requested_at = now();
$$;
revoke all on function public.join_waitlist(text, text) from public, anon, authenticated;
grant execute on function public.join_waitlist(text, text) to service_role;
