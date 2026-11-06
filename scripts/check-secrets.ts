/**
 * Fails when a tracked file contains what looks like a live credential, using
 * the same patterns NYNZ applies to GitHub exports plus database URLs with a
 * password. Prints the file, line and kind of secret, never the value.
 * A line can be allowed explicitly with the comment "nynz-secret-scan: allow".
 *   npx tsx scripts/check-secrets.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { SECRET_PATTERNS } from "../lib/integrations/github";

const PATTERNS: Array<[string, RegExp]> = [...SECRET_PATTERNS, ["database URL with a password", /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@(?!localhost|127\.0\.0\.1)[^\s/]+/]];
const SKIP = /(^|\/)(pnpm-lock\.yaml|package-lock\.json)$|\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip)$/i;
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter((f) => f && !SKIP.test(f));
const findings: string[] = [];
for (const file of files) {
  let text: string;
  try { if (statSync(file).size > 2_000_000) continue; text = readFileSync(file, "utf8"); } catch { continue; }
  text.split("\n").forEach((line, index) => {
    if (line.includes("nynz-secret-scan: allow")) return;
    for (const [kind, pattern] of PATTERNS) if (pattern.test(line)) findings.push(`${file}:${index + 1} looks like a ${kind}`);
  });
}
console.log(`Scanned ${files.length} tracked files: ${findings.length ? `${findings.length} possible secret(s)` : "no secrets found"}`);
for (const finding of findings) console.log(`  ${finding}`);
process.exit(findings.length ? 1 : 0);
