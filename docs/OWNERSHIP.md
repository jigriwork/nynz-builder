# Ownership, transfer and recovery

## Initial owner (bootstrap)

The owner role is assigned only to one exact, pre-existing, email-verified
account by a privileged server-side script. It never creates an account, sets a
password, verifies an email or substitutes another account.

```
pnpm bootstrap:owner --user-id 41080a24-57a9-4686-8d53-c0a3a9e09588 --email adib@nynz.in --check   # read-only verification
pnpm bootstrap:owner --user-id 41080a24-57a9-4686-8d53-c0a3a9e09588 --email adib@nynz.in           # assign (idempotent)
```

The database function `public.bootstrap_owner` re-verifies the ID, email,
verification and ban state, records the run in `owner_bootstrap_log` and the
audit history, and reports `created_owner`, `promoted_existing_staff` or
`already_owner`. A mismatch is refused and logged.

## Transferring ownership (two deliberate steps)

1. Current owner: Admin → Team → Manage the successor (who must already be an
   active staff member) → Role "Owner" → reason → confirm your password.
2. Successor signs in and confirms they can open the console.
3. Former owner: Admin → Team → "Step down as owner" → choose a new role.

There can be several owners. NYNZ refuses any change that would leave no active
owner.

## Recovery when no owner can sign in

1. Restore access to an existing owner account first: password reset email,
   then remove or reset the authenticator through Supabase support if the
   device is lost. Do not create a new account to replace the owner.
2. If an owner account is permanently lost, an operator with the Supabase
   service-role key (from the Supabase dashboard, never shared in chat) runs
   `pnpm bootstrap:owner --user-id <designated id> --email <its email>` for a
   designated, verified account chosen in writing by the business owner. The run
   is recorded in `owner_bootstrap_log` and the audit history.
3. The new owner reviews Admin → Team and removes access the lost account no
   longer needs (its last-owner protection lifts once another owner exists).
