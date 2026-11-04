/**
 * Owner-scoped table template for customer-owned Supabase projects. NYNZ
 * proposes this SQL for review; the customer applies it in their own project
 * (SQL editor or `supabase db push`). It is tested in NYNZ's suite against a
 * two-user fixture so the isolation it promises is verified.
 */
export function CUSTOMER_RLS_TEMPLATE(table: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(table)) throw new Error("Invalid table name");
  return `create table if not exists public.${table} (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.${table} enable row level security;
revoke all on public.${table} from anon;
grant select, insert, update, delete on public.${table} to authenticated;
create policy "${table}_select_own" on public.${table} for select to authenticated using (owner_id = auth.uid());
create policy "${table}_insert_own" on public.${table} for insert to authenticated with check (owner_id = auth.uid());
create policy "${table}_update_own" on public.${table} for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "${table}_delete_own" on public.${table} for delete to authenticated using (owner_id = auth.uid());
`;
}
