/*
 * NYNZ preview tokens. This file is copied byte-for-byte to
 * preview-host/lib/token.ts (the preview proxy is deployed as a separate
 * project); tests/unit/preview-token.test.ts fails if the copies diverge.
 *
 * Two token types, both HMAC-SHA256 signed with a dedicated preview secret
 * (never the database service key):
 *   - "x" exchange token: lives at most 2 minutes, single use (jti), carried
 *     once in a URL and immediately exchanged for a cookie by the proxy, which
 *     then redirects to a clean URL.
 *   - "s" session token: lives in an HttpOnly cookie on the preview host only.
 * Both are bound to a project, a user and the exact preview host (aud).
 * Rotation: set PREVIEW_SIGNING_SECRET to the new value and
 * PREVIEW_SIGNING_SECRET_PREVIOUS to the old one on the app and the proxy;
 * tokens signed by either verify until the previous secret is removed.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type PreviewTokenType = "x" | "s";
export type PreviewClaims = { typ: PreviewTokenType; projectId: string; userId: string; aud: string; exp: number; jti: string; kid: string; sessionExp?: number };

const CONTEXT = "nynz-preview-v2";
export const EXCHANGE_TTL_MS = 2 * 60_000;
export const SESSION_TTL_MS = 6 * 60 * 60_000;
export const EXCHANGE_PATH = "/__nynz/exchange";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Keys = { current: { kid: string; secret: string }; previous?: { kid: string; secret: string } };

function kidFor(secret: string) {
  return createHmac("sha256", secret).update(`${CONTEXT}.kid`).digest("base64url").slice(0, 8);
}

export function previewKeys(env: Record<string, string | undefined> = process.env): Keys {
  const current = env.PREVIEW_SIGNING_SECRET;
  if (!current || current.length < 32) throw new Error("PREVIEW_SIGNING_SECRET must be set to at least 32 characters");
  if (env.SUPABASE_SERVICE_ROLE_KEY && current === env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("PREVIEW_SIGNING_SECRET must differ from the database service key");
  const previous = env.PREVIEW_SIGNING_SECRET_PREVIOUS;
  return { current: { kid: kidFor(current), secret: current }, ...(previous && previous.length >= 32 ? { previous: { kid: kidFor(previous), secret: previous } } : {}) };
}

function sign(secret: string, payload: string) {
  return createHmac("sha256", secret).update(`${CONTEXT}.${payload}`).digest("base64url");
}

export function normalizeHost(host: string) {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

export function issuePreviewToken(input: { typ: PreviewTokenType; projectId: string; userId: string; aud: string; now?: number; expiresAt?: number; sessionExpiresAt?: number }, keys: Keys = previewKeys()) {
  if (!UUID.test(input.projectId) || !UUID.test(input.userId)) throw new Error("Invalid preview subject");
  const now = input.now ?? Date.now();
  const claims: PreviewClaims = {
    typ: input.typ, projectId: input.projectId.toLowerCase(), userId: input.userId.toLowerCase(), aud: normalizeHost(input.aud),
    exp: Math.min(now + (input.typ === "x" ? EXCHANGE_TTL_MS : SESSION_TTL_MS), input.expiresAt ?? Number.POSITIVE_INFINITY), jti: randomBytes(18).toString("base64url"), kid: keys.current.kid,
    ...(input.typ === "x" && input.sessionExpiresAt ? { sessionExp: Math.min(input.sessionExpiresAt, now + SESSION_TTL_MS) } : {}),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { token: `${payload}.${sign(keys.current.secret, payload)}`, claims };
}

export type VerifyResult = { ok: true; claims: PreviewClaims; expired: boolean } | { ok: false; reason: "malformed" | "signature" | "type" | "audience" };

export function verifyPreviewToken(token: string, expected: { typ: PreviewTokenType; aud: string; now?: number }, keys: Keys = previewKeys()): VerifyResult {
  const [payload, supplied, extra] = String(token || "").split(".");
  if (!payload || !supplied || extra !== undefined || payload.length > 2048) return { ok: false, reason: "malformed" };
  let claims: PreviewClaims;
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  const key = [keys.current, keys.previous].find((candidate) => candidate && candidate.kid === claims.kid);
  if (!key) return { ok: false, reason: "signature" };
  const left = Buffer.from(supplied);
  const right = Buffer.from(sign(key.secret, payload));
  if (left.length !== right.length || !timingSafeEqual(left, right)) return { ok: false, reason: "signature" };
  if (claims.typ !== expected.typ) return { ok: false, reason: "type" };
  if (!UUID.test(claims.projectId || "") || !UUID.test(claims.userId || "") || !Number.isFinite(claims.exp) || (claims.sessionExp !== undefined && !Number.isFinite(claims.sessionExp)) || typeof claims.jti !== "string") return { ok: false, reason: "malformed" };
  if (claims.aud !== normalizeHost(expected.aud)) return { ok: false, reason: "audience" };
  return { ok: true, claims, expired: claims.exp <= (expected.now ?? Date.now()) };
}

/**
 * Per-project preview hosts look like "<projectId>.<suffix>". When the host
 * carries a project id it must match the token, so one project's session can
 * never be replayed on another project's origin.
 */
export function hostProjectId(host: string) {
  const first = normalizeHost(host).split(".")[0];
  return UUID.test(first) ? first : null;
}

/** Only same-origin relative paths are accepted as post-exchange redirects. */
export function safeNextPath(raw: string | null | undefined) {
  const value = String(raw || "/");
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.startsWith(EXCHANGE_PATH)) return "/";
  return value.slice(0, 2048);
}

/** Removes preview credentials from a URL before it is logged or reported. */
export function redactPreviewUrl(raw: string) {
  return raw.replace(/([?&](?:t|ny_session|token)=)[^&#\s]+/gi, "$1[redacted]");
}
