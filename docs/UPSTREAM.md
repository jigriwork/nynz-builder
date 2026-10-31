# Upstream provenance

NYNZ began from `firecrawl/open-lovable` at commit
`806b8072f28afea11fa2b028cac1449eff74c511` (2026-10-09). The upstream is MIT
licensed; its `LICENSE` file and Git history are retained.

Useful parts retained include the Next.js UI, file parsing/context helpers,
Firecrawl SDK integration, and E2B provider groundwork. NYNZ replaces the
single-process global sandbox/conversation state with Supabase-owned records and
durable build jobs. Global memory cannot isolate users, survive restarts, or
work reliably across serverless instances.

Open Lovable is an example application, not the proprietary Lovable service and
not a production platform. NYNZ does not use WebContainers.
