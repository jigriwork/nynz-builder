-- NYNZ 0.3.6: accounts with credit history can be deleted.
-- Deleting an auth user cascaded into the append-only credit ledger and was
-- refused (LEDGER_IS_APPEND_ONLY), so no account that had ever received
-- credits could be deleted. Ledger rows are financial history: they are now
-- kept and detached from the deleted account (user_id set to NULL). The
-- ledger stays append-only for every other change.
alter table public.credit_ledger alter column user_id drop not null;
alter table public.credit_ledger drop constraint if exists credit_ledger_user_id_fkey;
alter table public.credit_ledger add constraint credit_ledger_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

create or replace function private.ledger_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  -- Only the account-deletion cascade may change a row, and only by clearing user_id.
  -- This function also guards provider_spend_reconciliations, which has no
  -- user_id, so the exemption is limited to the credit ledger.
  if tg_op = 'UPDATE' and tg_table_name = 'credit_ledger'
     and (to_jsonb(old) ->> 'user_id') is not null and (to_jsonb(new) ->> 'user_id') is null
     and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  raise exception 'LEDGER_IS_APPEND_ONLY' using errcode = 'P0001';
end; $$;
