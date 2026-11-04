/**
 * Build identity shown to everyone (footer, account menu, admin header and
 * /version). Values are inlined at build time by next.config.ts from
 * build-info.json, which scripts/stamp-build.ts writes before each deploy.
 */
export const BUILD = {
  version: process.env.NEXT_PUBLIC_NYNZ_VERSION || "dev",
  commit: process.env.NEXT_PUBLIC_NYNZ_COMMIT || "unknown",
  builtAt: process.env.NEXT_PUBLIC_NYNZ_BUILT_AT || null,
};
export const VERSION_LABEL = `v${BUILD.version}${BUILD.commit !== "unknown" ? ` · ${BUILD.commit}` : ""}`;
