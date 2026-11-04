/** Writes build-info.json (version, exact commit, build time) before a deploy. Refuses to stamp uncommitted changes. */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version as string;
const commit = execSync("git rev-parse --short=7 HEAD", { encoding: "utf8" }).trim();
const dirty = execSync("git status --porcelain --untracked-files=no", { encoding: "utf8" }).trim();
if (dirty && process.env.NYNZ_ALLOW_DIRTY !== "1") { console.error("Refusing to stamp a build with uncommitted changes. Commit first so the version matches a real commit."); process.exit(1); }
const info = { version, commit, builtAt: new Date().toISOString() };
writeFileSync("build-info.json", JSON.stringify(info, null, 2));
console.log(`stamped NYNZ ${version} (${commit})`);
