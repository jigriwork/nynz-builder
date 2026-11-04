# Staff roles and permissions

Staff access is separate from customer plans. Every person uses their own NYNZ
account; a staff member keeps their normal customer workspace. Permissions are
enforced in three places: the admin page gate, the admin API, and the database
function that performs each action (which also writes the audit record in the
same transaction). Hiding a menu is never the control.

Source of truth: `public.staff_capabilities` and `public.staff_role_capabilities`
(migration `20261104100300_staff_and_audit.sql`). The admin console's Team page
renders this matrix from the database.

| Capability | Owner | Operations | Support | Billing | Read-only |
|---|:-:|:-:|:-:|:-:|:-:|
| `admin.access` open the console | ✓ | ✓ | ✓ | ✓ | ✓ |
| `overview.read` platform overview | ✓ | ✓ | ✓ | ✓ | ✓ |
| `users.read` search and view customers | ✓ | ✓ | ✓ | ✓ | ✓ |
| `users.suspend` suspend/reactivate customers | ✓ | ✓ | | | |
| `users.invite` invite customers | ✓ | | ✓ | | |
| `users.reset_password` send reset links | ✓ | | ✓ | | |
| `users.revoke_sessions` sign customers out everywhere | ✓ | | ✓ | | |
| `projects.read` project and build metadata | ✓ | ✓ | ✓ | | ✓ |
| `projects.read_content` open private source (audited, reason required) | ✓ | ✓ | | | |
| `builds.operate` cancel, recover, restart previews | ✓ | ✓ | | | |
| `credits.read` balances and history | ✓ | ✓ | ✓ | ✓ | ✓ |
| `credits.grant` grants within role limits | ✓ | | ✓ | ✓ | |
| `credits.adjust_large` large grants and deductions | ✓ | | | ✓ | |
| `billing.read` subscriptions, payments, expenses | ✓ | | | ✓ | ✓ |
| `billing.refund` authorised refunds | ✓ | | | ✓ | |
| `expenses.manage` record expenses and provider balances | ✓ | | | ✓ | |
| `providers.read` provider usage, balances, health | ✓ | ✓ | | ✓ | ✓ |
| `operations.cleanup` run reconciliation | ✓ | ✓ | | | |
| `team.read` view staff and invitations | ✓ | ✓ | | | ✓ |
| `audit.read` read audit history | ✓ | ✓ | | | ✓ |
| `plans.manage` (owner-level) plans and top-up prices | ✓ | | | | |
| `providers.manage` (owner-level) spending limits | ✓ | | | | |
| `team.manage` (owner-level) invite and change staff | ✓ | | | | |
| `owner.manage` (owner-level) appoint owners, step down | ✓ | | | | |

Credit grant limits (`public.staff_credit_limits`): Billing 5,000 per grant and
20,000 per day; Support 200 per grant and 1,000 per day; Operations and
Read-only none; Owner unlimited. Owner testing credits are owner-only, to the
owner's own account, must expire within 31 days and are capped at 500 credits
per 30 days (`public.owner_testing_budget`).

## Rules enforced by the database

- Only an owner can appoint an owner, invite an owner, grant owner-level
  capabilities, change an owner, or act on an owner's customer account.
- Nobody can change their own staff record (no self-promotion, no
  self-granted capabilities). Non-owners can never grant a capability they do
  not hold themselves.
- The last active owner cannot be demoted, suspended, removed or deleted by
  anyone, including the platform service role.
- Suspending, removing or signing a staff member out takes effect on their next
  admin request in any existing session: membership is re-read and the session
  must still exist on every request.
- Sensitive actions (staff changes, account suspension, session revocation,
  password resets, credit grants, refunds, plan and limit changes) require a
  password confirmation within the last 15 minutes (5 for owner appointment,
  refunds and plan changes). Accounts with a verified authenticator, or with
  "require two-factor" set, must present a two-factor session (AAL2).
- Removing staff access never deletes or changes the person's customer account,
  projects or sign-in.
