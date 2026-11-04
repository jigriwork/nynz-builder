/**
 * Release check for inherited branding (branding audit items 5-13, 22).
 * Fails when tracked source or public assets reintroduce Open Lovable /
 * Firecrawl marketing identity. Legitimate references are allowlisted:
 * licence and provenance documents, the operational Firecrawl SDK and its
 * environment variable/provider identifiers, and the truthful provenance note
 * in styles/base.css.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const ALLOWED_FILES = new Set(["LICENSE", "docs/UPSTREAM.md", "docs/NYNZ_BRANDING_PROVENANCE_AUDIT.md", "docs/NYNZ_CURRENT_STATE_AUDIT.md", "docs/NYNZ_IMPLEMENTATION_STATUS.md", "docs/RELEASE.md", "THIRD_PARTY_NOTICES.md", "scripts/check-brand.ts", "scripts/third-party-notices.ts", "scripts/verify-public-pages.ts", "scripts/verify-release.ts", "pnpm-lock.yaml"]);
// Tests and verification scripts name forbidden strings to assert they are absent.
const ALLOWED_PREFIXES = ["tests/"];
const FORBIDDEN = [/open[\s-]?lovable/i, /\blovable\b/i, /mendable(?!\/firecrawl-js)/i, /firecrawl\.svg|firecrawl-logo|FirecrawlLogo|FirecrawlIcon/, /create-open-lovable|OpenLovable/];
// Operational provider references (class C) are fine in server code, never as customer-visible copy.
const PROVIDER_NAME = /firecrawl/i;
const PROVIDER_OK = /@mendable\/firecrawl-js|FIRECRAWL_|["'`]firecrawl["'`]|firecrawl\.dev|firecrawl:|firecrawlPagePaise|FirecrawlApp|\/\/.*firecrawl|\*.*firecrawl/i;
const BASE_PROVENANCE = /originate\s*$|open-lovable starter \(see docs\/UPSTREAM\.md and LICENSE\)/;

const files = execSync("git ls-files -co --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean).filter((f) => existsSync(f) && !f.startsWith("node_modules/") && !/\.(png|ico|woff2?|jpg|jpeg|gif|webp)$/i.test(f));
const problems: string[] = [];
for (const file of files) {
  if (ALLOWED_FILES.has(file) || ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (file === "styles/base.css" && BASE_PROVENANCE.test(line)) return;
    if (FORBIDDEN.some((pattern) => pattern.test(line))) problems.push(`${file}:${index + 1}: inherited identity: ${line.trim().slice(0, 120)}`);
    const customerFacing = /^(app|components)\//.test(file) && !file.startsWith("app/api/") && !file.startsWith("app/admin/") && !file.startsWith("components/admin/");
    if (customerFacing && PROVIDER_NAME.test(line) && !PROVIDER_OK.test(line)) problems.push(`${file}:${index + 1}: provider name in customer-facing UI: ${line.trim().slice(0, 120)}`);
  });
}
for (const asset of ["public/firecrawl.svg", "public/firecrawl-logo"]) if (existsSync(asset)) problems.push(`${asset}: inherited logo asset must not ship`);
if (existsSync("packages/create-open-lovable")) problems.push("packages/create-open-lovable: residual CLI must not ship");
if (!existsSync("LICENSE") || !/MIT License/.test(readFileSync("LICENSE", "utf8"))) problems.push("LICENSE: MIT notice must be preserved");
if (!existsSync("docs/UPSTREAM.md")) problems.push("docs/UPSTREAM.md: provenance record must be preserved");

if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`brand check passed (${files.length} files)`);
