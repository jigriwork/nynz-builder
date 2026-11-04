-- NYNZ release 0.3.1: staff workspaces must be as private as customer workspaces.
--
-- Earlier "admin read" policies (and the staff clauses added in 0.3) let any
-- staff member with a read capability see every customer's projects, builds,
-- usage, credits and payments through ordinary Data API queries. Because the
-- normal builder uses those same queries, the owner's own workspace listed
-- other customers' projects. Customer data is now readable only by its owner
-- through RLS. Staff read customer data only inside the admin console, through
-- capability-checked SECURITY DEFINER functions or the server after its own
-- capability check.

drop policy if exists projects_admin_read on public.projects;
drop policy if exists build_jobs_admin_read on public.build_jobs;

alter policy profiles_self_read on public.profiles using (id = auth.uid());
alter policy usage_owner_read on public.usage_events using (owner_id = auth.uid());
alter policy credit_grants_own on public.credit_grants using (user_id = auth.uid());
alter policy credit_ledger_own on public.credit_ledger using (user_id = auth.uid());
alter policy credit_reservations_own on public.credit_reservations using (user_id = auth.uid());
alter policy subscriptions_own on public.subscriptions using (user_id = auth.uid());
alter policy payments_own on public.payments using (user_id = auth.uid());
alter policy refunds_own on public.refunds using (exists (select 1 from public.payments p where p.id = payment_id and p.user_id = auth.uid()));
alter policy published_sites_own on public.published_sites using (private.is_project_owner(project_id));
alter policy deployments_own on public.deployments using (private.is_project_owner(project_id));
alter policy custom_domains_own on public.custom_domains using (private.is_project_owner(project_id));
