-- NYNZ 0.3.4: deleting a sign-in account also deletes its staff record.
-- Previously staff_members restricted deletion of the auth user, so even a
-- removed staff member's account (or a disposable verification fixture) could
-- not be deleted. The last-active-owner trigger still fires on the cascaded
-- delete, so the last owner's account cannot be deleted.
alter table public.staff_members drop constraint if exists staff_members_user_id_fkey;
alter table public.staff_members add constraint staff_members_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
