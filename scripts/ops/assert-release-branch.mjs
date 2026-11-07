// Refuses a production deploy unless it is exactly the pushed tip of feat/nynz-platform.
import { execFileSync } from "node:child_process";
const RELEASE = "feat/nynz-platform";
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const fail = (m) => { console.error(`Production deploy refused: ${m}`); process.exit(1); };
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== RELEASE) fail(`checked out "${branch}", production releases come only from ${RELEASE}.`);
if (git("status", "--porcelain", "--untracked-files=no")) fail("uncommitted changes.");
git("fetch", "--quiet", "origin", RELEASE);
if (git("rev-parse", "HEAD") !== git("rev-parse", `origin/${RELEASE}`)) fail(`HEAD is not origin/${RELEASE}; push first.`);
console.log(`Release branch check passed: ${RELEASE} @ ${git("rev-parse", "--short", "HEAD")}`);
