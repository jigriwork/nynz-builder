# NYNZ Branding, Provenance, and Information-Exposure Audit

**Audit date:** 2026-11-04 (Asia/Kolkata)  
**Branch:** `feat/nynz-platform`  
**Audited commit:** `e24612b9c7d4267525e8e263c9f5a9cd71501cc8`  
**Repository state at audit start:** one pre-existing untracked file, `docs/NYNZ_CURRENT_STATE_AUDIT.md`  
**Audit mode:** read-only except for creation of this report; no application code, assets, Git history, commits, deployments, or external records were changed.

## Executive answers

### Does the current product visibly show Open Lovable or another inherited identity?

**Not on the ordinary live customer pages inspected.** The production homepage, login page, and 404 page at `https://www.nynz.in` consistently displayed the NYNZ wordmark/icon and NYNZ copy. Their rendered HTML and downloaded public JavaScript contained no inspected match for `Open Lovable`, `Lovable`, `Firecrawl`, or an upstream repository URL. No inherited-brand console message was observed.

This is not the same as saying the deployment has no inherited traces:

- Two unused Firecrawl logo assets remain directly downloadable from public URLs: `/firecrawl.svg` and `/firecrawl-logo`.
- A supported authenticated website-import API can return the provider-specific message `Firecrawl is not configured`.
- A substantial unused Firecrawl/Open Lovable marketing tree and a complete `create-open-lovable` CLI remain in tracked source.
- Legacy API code containing Firecrawl-specific messages is present in the server build, although middleware returns `410` or `401` before those unsupported handlers are reached.

The ordinary product therefore has an independent visual identity, but the repository and deployment are not yet cleanly separated from inherited identity.

### Do generated apps or exports contain inherited branding?

**No inherited Open Lovable or Firecrawl branding was found in the existing generated-app sample or current export implementation.** A read-only scan covered 7 authorised existing projects and 106 stored project files. It found no `Open Lovable`, `Lovable`, `Firecrawl`, `Mendable`, `made with`, `powered by`, `built with`, or local workstation-path match. Existing application titles were product-specific. One older app retained the generic package name `react-ts-vite`; that is starter residue, not upstream branding.

The current prompts tell the model it is a NYNZ engineer and require replacement of starter/demo content. The fallback starter identifies itself as `nynz-app`/`NYNZ preview`. The export route excludes `.env*`, uses a project-derived ZIP filename, and adds a README containing `Exported from NYNZ.` It does not add an Open Lovable link or badge.

This conclusion is bounded: no paid generation was run, no fresh ZIP was downloaded through an authenticated browser, and the stored-project scan cannot prove what every future prompt or third-party package will generate. The export route will faithfully include branding that a project owner or future generation places in project files.

### Which notices must remain, and where?

- The repository's MIT licence notice must remain with copies or substantial portions of the inherited MIT-licensed software. The current root `LICENSE` is the appropriate source-distribution location unless legal counsel chooses a clearer third-party-notices structure.
- Required notices for distributed dependencies must accompany the relevant source/binary distribution according to each dependency's licence. The inspected core dependencies use MIT or ISC licences; JSZip offers an MIT-or-GPL choice and can be distributed under the MIT option. These obligations do **not** require visible website badges or provider logos.
- `docs/UPSTREAM.md` and Git history are legitimate provenance records and should be retained. They need not appear in customer navigation or generated-app chrome.
- Firecrawl's SDK licence does not require Firecrawl trademark assets in NYNZ's public directory. Unused logos may be removed from a future build while the operational SDK and its required licence notice remain.
- Generated-app exports need an upstream notice only if they actually contain a copy or substantial portion of upstream-licensed code. The inspected export composition and existing files did not establish that they do. If shared upstream templates are later placed into exports, include their MIT notice in the export, normally in `LICENSE` or `THIRD_PARTY_NOTICES` rather than a visible badge.

This is a technical licence inventory, not legal advice. Before distributing a closed-source NYNZ package, counsel should confirm which NYNZ-authored files are proprietary and which inherited/dependency notices belong in a consolidated `THIRD_PARTY_NOTICES` file.

## Classification key

| Code | Meaning |
|---|---|
| A | Customer-facing branding that should be NYNZ |
| B | Unused or unsupported inherited asset/component/code |
| C | Legitimate operational provider or dependency reference |
| D | Licence/copyright/third-party notice that must be preserved as required |
| E | Internal provenance documentation or Git history |

## Inspection scope and method

- Searched tracked source case-insensitively for Open Lovable variants, Lovable, upstream URLs, Firecrawl/Mendable, badges, generator/package names, demo identities, emails, domains, paths, and branding assets. Installed dependencies, `.next`, and other generated output were excluded from the first pass.
- Traced entry points and imports for the live homepage, login, dashboard, builder, admin/design screens, 404, shared brand component, API routes, starters, prompts, preview path, and export path.
- Inspected local `.next` output separately: public static assets, server route bundles, and source maps.
- Fetched the production homepage, login page, and a nonexistent route in a browser; inspected metadata, icons, links, rendered text, console messages, errors, and downloaded JavaScript.
- Probed the deployed inherited asset URLs and adjacent public JavaScript source-map URLs.
- Performed a read-only scan of 7 authorised existing projects and 106 stored files. Values matching credentials or sessions were not printed.
- Inspected root and installed-package licence metadata for the core branding-relevant stack.
- Did not run paid AI generation or alter an authorised project.

## Detailed findings

| ID | File/line or URL | Surface | Exact non-sensitive text/evidence | Reachability | Class | Priority | Proposed correction |
|---|---|---|---|---|---|---|---|
| 1 | `app/layout.tsx:28-31` | Browser title/description | `NYNZ Build Real Applications With the Prompt`; NYNZ description | Shipped and visible on inspected routes | A | Medium | Replace the awkward global title with an approved NYNZ title template and route-specific titles. Keep the NYNZ description or refine it with brand review. |
| 2 | `app/layout.tsx:28-31`; no manifest/metadata files found | Social preview, install identity, search metadata | No canonical URL, `metadataBase`, Open Graph image, Twitter card, web manifest, theme colour, sitemap, or route-specific metadata was found | Shipped omission; production HTML had no Open Graph/Twitter tags | A | High | Add an explicit NYNZ metadata system, canonical production origin, social image, manifest, theme colours, and route-specific titles/descriptions. Validate generated markup and link previews. |
| 3 | `components/nynz-brand.tsx:3-8`; `app/favicon.ico`; `app/icon.png`; `public/brand/*` | Navigation and browser icons | `NYNZ` alt text; NYNZ wordmark and lime-on-dark N icon | Shipped and visible | A | Pass | Retain. Normalise the icon crops/source artwork so favicon, app icon, and public brand icon are deliberately derived from one approved master. |
| 4 | Production `/`, `/login`, and nonexistent route | Homepage, footer, authentication, error page | NYNZ wordmark, NYNZ product copy, NYNZ icon; no inspected inherited product text or link | Publicly reachable | A | Pass | Retain and add these routes to automated brand smoke tests. A runtime 500/global error page was not forced and still needs confirmation. |
| 5 | `public/firecrawl.svg`; `public/firecrawl-logo` | Public downloadable assets | Firecrawl flame/wordmark artwork | Not linked by inspected active UI, but both production URLs returned HTTP 200 | B | Medium | Remove the unused files from the public deployment after confirming no external consumer depends on them. Add a release check that forbidden inherited asset names return 404. No Git-history rewrite is needed. |
| 6 | `app/landing.tsx:22-60` | Dormant landing page | Firecrawl logo components; `https://github.com/mendableai/open-lovable`; `Use this Template` | Tracked and buildable, but not the active `/` entry and no active import was found | B | Medium | Delete or quarantine this legacy entry and its marketing dependency tree in a future change. If retained as reference, keep it outside the production compilation path and label it internal. |
| 7 | `components/app/(home)/sections/hero/Title/Title.tsx:257-262`; `components/app/(home)/sections/hero/Hero.tsx:32-42` | Dormant marketing hero | `Open Lovable v3`; Firecrawl data-crawling copy; Firecrawl GitHub link | Unreferenced by active page; reachable only if reintroduced by code | B | Medium | Remove with the dormant marketing tree or replace before any reuse. Add a forbidden-string check to prevent accidental reactivation. |
| 8 | `components/shared/header/**`; `components/shared/firecrawl-icon/**`; `components/FirecrawlIcon.tsx`; `components/FirecrawlLogo.tsx`; `styles/fire.css`; `styles/design-system/**` | Dormant navigation, logos, stories, design-system comments | Firecrawl docs, GitHub, status and marketing references | Tracked; predominantly reached from the dormant landing/header tree, not inspected live UI | B | Low | Map imports, then remove unused components/styles/assets as one bounded cleanup. Preserve licence notices, not obsolete product chrome. |
| 9 | `packages/create-open-lovable/package.json:2-34`; `packages/create-open-lovable/index.js:18-35`; templates under that package | Residual CLI/product generator | `create-open-lovable`; `Welcome to Open Lovable Setup!`; default `my-open-lovable`; Open Lovable READMEs/env headings | Complete tracked subpackage with public publish configuration; not referenced by the root app/workspace found in this audit | B | High | Decide explicitly whether NYNZ owns a CLI. If no, remove the residual subpackage from future source distributions. If yes, rename package/bin/defaults/templates to NYNZ, confirm registry-name availability, and retain applicable MIT notice. Do not publish it in its present identity by accident. |
| 10 | `lib/build-validator.ts:20` | Internal outbound HTTP header | `OpenLovable-Validator` | Tracked; no active import or client/server build match was found | B | Low | Remove the unused validator or rename its user agent to a stable NYNZ operational identifier before activation. |
| 11 | `app/api/projects/[id]/import/route.ts:2,13-28`; root `.env.example`; `README.md` | Supported website import and operations | `Firecrawl is not configured`; provider `firecrawl` in usage accounting | Authenticated supported API; SDK is operational | C, with A-facing error text | Medium | Keep the operational provider integration and internal accounting. Change customer errors to vendor-neutral language such as `Website import is temporarily unavailable`; log a stable internal error code without provider response bodies. |
| 12 | `app/api/extract-brand-styles`, `scrape-*`, `search`, and `generate-ai-code-stream`; `middleware.ts:21-23` | Unsupported legacy APIs and server bundles | Firecrawl-specific success/errors, provider URLs, debug logs, and mock response text | Middleware blocks unsupported APIs with 401/410, but their handlers are compiled into 8 matching server bundle/chunk files | B/C | High | Remove unsupported handlers from the production source/build after verifying no supported caller. Until then, ensure middleware remains fail-closed and test direct requests. Eliminate full provider-response logging and raw provider error forwarding. |
| 13 | `components/shared/preview/live-preview-frame.tsx:163` | Dormant preview implementation | `wss://api.firecrawl.dev/agent-livecast?...` | Source match; no active import/build evidence found | B | Medium | Remove the legacy preview component or replace it with NYNZ's current private preview implementation. Never place session identifiers in third-party URLs without an explicit data-flow review. |
| 14 | `lib/platform/sarvam.ts:74-90`; `lib/platform/openrouter.ts`; `lib/platform/starter.ts`; `lib/platform/e2b.ts:6-17` | Generation prompts and fallback starter | NYNZ engineer instructions; `nynz-app`; `NYNZ preview`; requirement to replace starter demo | Active generation/build path | A | Pass, with improvement | Retain the NYNZ instructions. Add explicit requirements for a product-specific description, favicon/app icon, and reserved example domains; prohibit unrequested real brands/persons and inherited platform badges. |
| 15 | Existing authorised projects (7 projects, 106 files) | Generated applications | No inspected Open Lovable/Lovable/Firecrawl/Mendable/badge/local-workstation match; product-specific titles; one `react-ts-vite` package name | Stored customer projects; read-only inspection | A | Low | Migrate or regenerate generic package metadata only when safe. Add a post-generation validation that rejects generic starter names and checks title, description, icon, and footer provenance. |
| 16 | `app/api/projects/[id]/export/route.ts:3` | Downloadable ZIP | README text `Exported from NYNZ.`; project-derived ZIP name; excludes `.env*` | Supported authenticated route; implementation inspected, fresh archive not downloaded | A/D | Medium | Keep NYNZ export provenance. Avoid overwriting a project-authored README silently; merge or use `NYNZ_EXPORT.md`. Add licence/third-party notices only when exported contents require them. Test an actual archive before release. |
| 17 | Active project/files/versions/backend API routes, including `app/api/projects/route.ts:9-15`, `app/api/projects/[id]/files/route.ts:6-7`, and `app/api/projects/[id]/versions/route.ts:5` | Authenticated API errors | Database/provider `error.message` returned directly | Reachable to authenticated project users when an operation fails | Information exposure | High | Return stable customer-safe messages and correlation IDs. Keep detailed database errors in access-controlled logs after redaction. Test constraint, outage, and malformed-state failures for absence of schema/internal details. |
| 18 | `app/api/projects/[id]/preview-session/route.ts:13-18`; preview proxy | Preview URL/session handoff | A signed `ny_session` value is placed in a short-lived URL; response is `private, no-store` with `no-referrer` | Intentionally delivered to an authenticated browser; token value was not recorded in this report | Sensitive-by-design | Medium | Prefer immediate token-to-HttpOnly-cookie exchange with URL cleanup where architecture permits. Ensure analytics, reverse proxies, client logs, and error reporting redact the query parameter; retain no-store/no-referrer protections. |
| 19 | Local `.next/server/**` | Server build metadata | 113 server files contained the local build prefix `/Users/.../NYNZ.IN`; two server-only source maps were present | Not found in public client assets or deployed client JavaScript; could leak through server stack/error/log mishandling | Information exposure | Medium | Build releases in a standard CI path, disable unnecessary server source-map publication, and keep stacks out of HTTP responses. Treat server artifacts/logs as internal. |
| 20 | Production JavaScript and source-map probes | Public client bundle | 10 production JS assets inspected; no target brand/provider, local-path, or email match; no adjacent public `.map` found | Publicly reachable JS; maps not found | Information exposure | Pass | Retest after each production build. Do not infer server cleanliness from this client-only result. |
| 21 | Git commit metadata | Public provenance and personal data | 14 distinct author names across 15 name/email pairs; history includes GitHub no-reply, personal-mail, and a local-host-style address | Visible to anyone receiving repository history | E / information exposure | Medium | Do not rewrite history merely to hide provenance. Confirm contributors expected these identities to be public; use verified no-reply/work addresses for future commits and consider a `.mailmap` for display normalisation. Seek consent/legal guidance before any exceptional historical redaction. |
| 22 | `docs/UPSTREAM.md:3-13`; root `LICENSE` | Provenance/licensing | NYNZ origin from `firecrawl/open-lovable` and MIT permission notice | Internal/source-distribution documentation, not customer UI | D/E | Required | Preserve accurate provenance and the applicable licence notice. It is appropriate for repository readers and does not require a customer-facing badge. Never claim the inherited codebase was built entirely from scratch. |

## Browser and artifact evidence

| Evidence | Result |
|---|---|
| Production homepage, `https://www.nynz.in/` | HTTP 200; NYNZ title, description, wordmark, icon, navigation, content, and footer. No inspected inherited text/link, console error, or warning. Screenshot captured at `/tmp/nynz-brand-home.png` (temporary audit artifact, not committed). |
| Production login, `https://www.nynz.in/login` | HTTP 200; NYNZ Builder identity and NYNZ icons. No inspected inherited text/link or console error. Screenshot: `/tmp/nynz-brand-login.png`. |
| Production nonexistent route | HTTP 404; branded NYNZ not-found screen and NYNZ metadata/icons. The console showed only the expected missing-resource 404. Screenshot: `/tmp/nynz-brand-not-found.png`. |
| Production public assets | `/firecrawl.svg` returned HTTP 200 (6,156 bytes); `/firecrawl-logo` returned HTTP 200 (2,024 bytes). Visual inspection confirmed Firecrawl wordmark/flame artwork. |
| Production client bundles | 10 JavaScript assets fetched and searched; no inspected Open Lovable/Lovable/Firecrawl/local-workstation/email match. Adjacent `.map` probes did not find a public source map. |
| Local build | Public static output had no target inherited-brand/local-path match. Server output retained Firecrawl legacy route strings and local absolute build paths; two source maps were server-side. |
| Generated projects | Read-only scan of 7 projects and 106 stored files found no target inherited-brand, platform-badge, or local-workstation-path match. Some apps contained ordinary fictional/sample contact data and third-party image/font URLs; those were not developer identity exposure. |

The `/tmp` screenshots are ephemeral local evidence and may disappear after restart. They were not copied into the repository because this was an audit-only request and the visible observations are recorded above.

## Unused inherited assets, components, and packages

### Public assets

- `public/firecrawl.svg`
- `public/firecrawl-logo`

Both are deployed and directly reachable even though no active UI reference was found.

### Source/UI tree

- `app/landing.tsx`
- `components/FirecrawlIcon.tsx`
- `components/FirecrawlLogo.tsx`
- `components/app/(home)/**` legacy marketing sections, including `Open Lovable v3`
- `components/shared/header/**` Firecrawl marketing navigation, stories, brand kit, GitHub, and status links
- `components/shared/firecrawl-icon/**`
- `components/shared/preview/live-preview-frame.tsx` legacy Firecrawl livecast implementation
- `styles/fire.css`
- `styles/design-system/**`, including Firecrawl-marketing comments/rules
- `lib/build-validator.ts` with the inherited user agent

These are “unused” based on active import/entry/build tracing performed for this audit; run TypeScript-aware dead-code analysis and the full test/build suite before deletion.

### Residual package

- `packages/create-open-lovable/**` is a self-contained inherited CLI with its own package metadata and dependencies (`chalk`, `commander`, `fs-extra`, `inquirer`, and `ora`). It was not found in the root application's workspace or runtime path. Treat it as a residual product, not as an active root dependency.

### Dependencies that are not branding defects

- `@mendable/firecrawl-js` is used by the supported website-import route and should not be labelled unused solely because Firecrawl logos should be removed.
- E2B, Supabase, Next.js, React, Framer Motion, Lucide, and JSZip are operational dependencies. Their names in package metadata, lockfiles, internal errors, or licence material are not customer branding by themselves.
- No complete dependency-usage or SBOM audit was performed. Therefore this report does not claim other root dependencies are unused.

## Licence inventory checked

| Component | Inspected version | Declared licence | Branding consequence |
|---|---:|---|---|
| Repository/upstream code | Current root notice | MIT | Preserve notice in copies/substantial portions; no visible website badge required. |
| `@mendable/firecrawl-js` | 4.3.4 | MIT | Preserve required distribution notice; no requirement to ship Firecrawl logo/trademark. |
| `@e2b/code-interpreter` | 2.9.0 | MIT | Notice obligation, not customer branding. |
| `e2b` | 2.62.0 | MIT | Notice obligation, not customer branding. |
| `next` | 15.5.27 | MIT | Notice obligation, not customer branding. |
| `react` | 19.1.0 | MIT | Notice obligation, not customer branding. |
| `@supabase/supabase-js` | 2.118.0 | MIT | Notice obligation, not customer branding. |
| `framer-motion` | 12.23.12 | MIT | Notice obligation, not customer branding. |
| `lucide-react` | 0.532.0 | ISC | Preserve copyright/permission notice in relevant distribution; no visible badge required. |
| `jszip` | 3.10.2 | MIT OR GPL-3.0-or-later | Use and document the MIT option unless intentionally choosing GPL; no visible badge required. |

This focused inventory did not enumerate every transitive dependency, font licence, generated-app dependency, or hosted-service term. A release-grade SBOM/licence scan remains necessary before broad binary/source distribution.

## Information-exposure assessment

### No sensitive value found in the inspected public client surface

- No credential or active session value is reproduced in this report.
- The production client JavaScript scan found no developer email or local workstation path in the 10 assets inspected.
- `.env*` files are excluded from the current ZIP export path.
- Public Supabase URLs and publishable/anonymous browser keys are not secrets by themselves; privileged service-role/provider keys must remain server-side. The source includes a guard against exporting privileged keys as public variables.

### Exposures or hardening opportunities

- Raw database errors are returned by several authenticated APIs and can disclose table, column, constraint, or provider details during failures.
- A signed preview session is carried once in a URL. Existing no-store/no-referrer controls are good, but URL-bearing secrets can still reach browser history, proxy access logs, analytics, or error collectors unless all layers scrub them.
- Server build artifacts record the developer workstation path. It was not observed in public client assets, but stack traces or accidentally published server maps could reveal it.
- Legacy handlers log provider response structure and errors more verbosely than necessary. Scraped page content and provider diagnostics should not be copied wholesale into production logs.
- Git history contains contributor names and personal/local-style author addresses. This is provenance metadata, not an application secret, but it is personal information in any public clone.
- `/home/user/app` shown in the builder terminal is a deliberate isolated sandbox path, not a developer workstation path. It is low-risk product information; retain only if it helps users.
- `you@company.com`, `hello@nynz.in`, and `.invalid` verification addresses are deliberate UI/demo/test values, not leaked developer emails. The design-only dashboard page should remain non-production or use clearly fictional data.

## Recommended implementation order

1. **Close active information leaks first.** Replace raw database/provider errors with stable customer-safe errors and correlation IDs; redact provider responses and preview-session query parameters across logs/analytics.
2. **Remove deployed inherited assets and unsupported handlers.** Delete the two public Firecrawl logos and remove legacy APIs from the compiled production application after caller verification. Confirm their URLs/routes return 404/410 as intended.
3. **Resolve the residual CLI deliberately.** Remove `packages/create-open-lovable` if NYNZ does not ship a CLI; otherwise complete a documented NYNZ rename before any publication.
4. **Prune dormant inherited UI/design code.** Remove the unused landing, marketing header/hero, Firecrawl icons/livecast component, and legacy styles in a single dependency-mapped change.
5. **Complete NYNZ metadata.** Add approved titles, canonical metadata, Open Graph/Twitter images, manifest, theme colours, icons, sitemap/robots policy, and an intentional global runtime-error page.
6. **Strengthen generation/export identity.** Require product-specific titles, descriptions, icons, package names, reserved example domains, and no unrequested badges/real brands. Preserve project-authored README content and attach licence notices only where required.
7. **Automate release checks.** Add source/build/browser/export forbidden-string tests, direct public-asset probes, error-redaction tests, and dependency licence/SBOM generation.

No correction in this sequence requires deleting Git history or concealing the upstream relationship.

## Confirmation checklist after corrections

- Search tracked source (excluding approved provenance/licence files), client build, server build, public directory, and export fixtures for all Open Lovable variants, upstream URLs, Firecrawl logo filenames, legacy generator names, and copied demo identities.
- Maintain an allowlist for legitimate provider code, environment variable names, usage accounting, lockfiles, licence notices, and `docs/UPSTREAM.md`; fail on new customer-visible occurrences.
- Request `/firecrawl.svg`, `/firecrawl-logo`, legacy API routes, and legacy source-map paths from the deployed origin and verify the intended 404/410 responses.
- Browse homepage, FAQ, login/signup flow, dashboard, builder, settings, admin, empty/loading/error states, 404, and a deliberately triggered safe 500. Inspect rendered text, accessibility labels, tooltips, notifications, network responses, and console output.
- Validate title, description, canonical, robots, Open Graph, Twitter, manifest, theme colour, favicon, Apple/app icons, and social-card rendering on each public route.
- Generate one no-cost fixture through the current deterministic/stub path, and inspect a representative existing project visually at desktop/mobile sizes.
- Download an authenticated export fixture; inspect ZIP filename, directory tree, README preservation, package metadata, HTML title/description/icon, comments, deployment files, `.env*` exclusion, badges, URLs, and applicable notices.
- Force controlled database, Firecrawl, E2B, build, and preview failures; verify responses contain no provider body, schema detail, stack, workstation path, key, or session value.
- Confirm preview URLs and `ny_session` are redacted from browser analytics, CDN/reverse-proxy logs, application logs, monitoring, and error reporting; confirm expiry and cookie exchange.
- Inspect production client assets and any publicly reachable maps after deployment. Separately scan server artifacts/logs in their access-controlled environment.
- Produce a full dependency SBOM/licence report and have counsel approve the source-distribution and export notice strategy.
- Record the post-fix branch, commit, deployment identifier, route matrix, and evidence screenshots so the result is reproducible.

## Items not fully inspected

- Authenticated production dashboard, builder, settings, admin, and live project previews were not exercised through a logged-in browser during this focused pass; their source and stored project files were inspected instead.
- Signup appears to share the authentication implementation, but a separate production signup transaction was not completed.
- No production runtime 500 was deliberately caused; the framework/default failure presentation and monitoring capture therefore remain unverified.
- No fresh paid AI generation was run, by instruction. Future model output remains nondeterministic and requires validation.
- No fresh authenticated export ZIP was downloaded; archive conclusions come from route composition plus the 106-file existing-project scan.
- Direct public source-map checks covered the discovered production JavaScript assets and conventional adjacent `.map` paths, not every possible undisclosed URL.
- Server deployment files, platform/CDN logs, analytics, monitoring, DNS, email templates, billing portals, app-store listings, external social profiles, and search-engine caches were outside available access.
- The read-only project scan covered the 7 authorised projects available at audit time, not deleted projects, other environments, or every future export.
- The licence check covered the repository notice and selected core dependencies, not every transitive package, font, uploaded asset, generated-app dependency, service term, trademark, or training-data issue.

## Final assessment

NYNZ's active public visual surface is already recognisably and consistently NYNZ in the pages inspected. The principal branding risk is not an obvious live Open Lovable label; it is **reactivation or direct discovery of inherited material that still ships**: public Firecrawl logos, compiled legacy APIs, a dormant marketing tree, and a publishable-looking Open Lovable CLI. The principal information-exposure risks are raw authenticated API errors, session-bearing preview URLs that require end-to-end redaction, and internal paths/details retained in server artifacts and legacy logging.

The correct remediation is a bounded source/deployment cleanup plus stronger metadata, generation, export, and error-validation controls. Required MIT/ISC notices and truthful upstream provenance should remain in source/distribution documentation; they do not need to appear as customer-facing NYNZ branding.
