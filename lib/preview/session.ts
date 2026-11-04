import { EXCHANGE_PATH, issuePreviewToken } from "./token";

export { redactPreviewUrl } from "./token";

/**
 * PREVIEW_ORIGIN is a template. "https://{projectId}.preview.nynz.in" gives every
 * generated app its own browser origin (cookies, storage and service workers
 * cannot collide between apps). A template without {projectId} is the legacy
 * shared-origin mode, which works but shares one origin between all of a
 * browser's previews; see docs/RELEASE.md for the wildcard-domain setup.
 */
export function getPreviewOrigin(projectId: string) {
  const template = process.env.PREVIEW_ORIGIN || "http://{projectId}.preview.localhost:3001";
  const origin = new URL(template.replaceAll("{projectId}", projectId)).origin;
  const parsed = new URL(origin);
  if (parsed.username || parsed.password) throw new Error("Preview origin must not contain credentials");
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") throw new Error("Production preview origin must use HTTPS");
  return origin;
}

export function previewOriginIsolated() {
  return (process.env.PREVIEW_ORIGIN || "{projectId}").includes("{projectId}");
}

/** Builds the one-time exchange URL that the preview proxy turns into a cookie. */
export function createPreviewExchangeUrl(projectId: string, userId: string, nextPath = "/") {
  const origin = new URL(getPreviewOrigin(projectId));
  const { token, claims } = issuePreviewToken({ typ: "x", projectId, userId, aud: origin.host });
  const url = new URL(EXCHANGE_PATH, origin);
  url.searchParams.set("t", token);
  if (nextPath !== "/") url.searchParams.set("next", nextPath);
  return { url: url.toString(), expiresAt: new Date(claims.exp).toISOString() };
}
