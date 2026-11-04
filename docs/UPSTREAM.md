# Upstream provenance

NYNZ began from `firecrawl/open-lovable` at commit
`806b8072f28afea11fa2b028cac1449eff74c511` (2026-10-09). The upstream is MIT
licensed; its `LICENSE` file and Git history are retained. NYNZ does not claim
the inherited codebase was written from scratch.

Originally retained: the Next.js UI shell, file parsing/context helpers, the
Firecrawl SDK integration and E2B provider groundwork.

Release 0.3 (November 2026) removed the parts that no live NYNZ route used,
after import tracing from every page, route, script and test:

- the inherited landing page, marketing hero/header, Firecrawl logo components
  and public logo files (`/firecrawl.svg`, `/firecrawl-logo`);
- the residual `create-open-lovable` CLI package;
- the legacy single-process API handlers (`/api/generate-ai-code-stream`,
  `/api/scrape-*`, `/api/search`, sandbox helpers and similar), which
  middleware had already disabled;
- the unused parsing/context helpers, legacy sandbox providers and 57 unused
  dependencies.

Still derived from upstream: the base style layers in `styles/base.css` and
`styles/design-system/` (renamed and comment-cleaned, rules unchanged because
live pages depend on them), and the operational website-import integration
built on the MIT-licensed `@mendable/firecrawl-js` SDK. The MIT notice in
`LICENSE` covers these portions.

Open Lovable is an example application, not the proprietary Lovable service and
not a production platform. NYNZ does not use WebContainers.
