/**
 * Customer-visible release version. Commit and deployment timestamps stay in
 * authenticated provider metadata and the private release evidence.
 */
export const BUILD = {
  version: process.env.NEXT_PUBLIC_NYNZ_VERSION || "dev",
};
export const VERSION_LABEL = `v${BUILD.version}`;
