-- Explicit, revocable bearer links for showing a private preview to a reviewer.
-- Raw tokens are never stored; creating a new link revokes the old one.
create table if not exists public.preview_share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint preview_share_expiry check (expires_at > created_at)
);

create index if not exists preview_share_links_project_active
  on public.preview_share_links(project_id, expires_at desc)
  where revoked_at is null;

alter table public.preview_share_links enable row level security;
revoke all on public.preview_share_links from public, anon, authenticated;
grant select, insert, update, delete on public.preview_share_links to service_role;

