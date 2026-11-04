# NYNZ product roadmap

Deferred product work after release 0.3. Delivered items are tracked in
[NYNZ_IMPLEMENTATION_STATUS.md](NYNZ_IMPLEMENTATION_STATUS.md).

## Security and reliability

- Stop generated `npm install` lifecycle scripts or run them under an egress
  policy; add a dependency allow/deny list and package scanning (SEC-02).
- Upload malware scanning and quarantine beyond the current signature checks (SEC-03).
- Propagate cancellation into in-flight provider requests and sandbox commands (REL-04).
- Structured logging, tracing, alerting and a tested backup/restore drill (OBS-01).
- Meter E2B time spent while previews are resumed and idle.

## Product

- Onboarding: terms and acceptable-use consent, welcome flow, account export
  and deletion, support tickets.
- Real file search and ZIP import in the builder.
- Managed backend provisioning through Supabase OAuth for partners (requires
  partner registration), with migration apply and rollback.
- Server functions for generated apps (only on isolated customer
  infrastructure, never on the NYNZ platform host).
- GST tax invoices once registration details are configured.
- Team workspaces and shared projects for customers.
