import { createHmac, timingSafeEqual } from "node:crypto";

export type PreviewSessionClaims = {
  projectId: string;
  userId: string;
  sandboxId: string;
  expiresAt: number;
};

function signingKey() {
  const key = process.env.PREVIEW_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Preview signing configuration is missing");
  return key;
}

function signature(payload: string) {
  return createHmac("sha256", signingKey()).update(`nynz-preview-v1.${payload}`).digest("base64url");
}

export function createPreviewSession(claims: PreviewSessionClaims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyPreviewSession(token: string): PreviewSessionClaims | null {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  const expected = signature(payload);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PreviewSessionClaims;
    if (!claims.projectId || !claims.userId || !claims.sandboxId || claims.expiresAt <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export function getPreviewOrigin(projectId: string) {
  const template = process.env.PREVIEW_ORIGIN || "http://{projectId}.preview.localhost:3001";
  const origin = new URL(template.replaceAll("{projectId}", projectId)).origin;
  const parsed = new URL(origin);
  if (parsed.username || parsed.password) throw new Error("Preview origin must not contain credentials");
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") throw new Error("Production preview origin must use HTTPS");
  return origin;
}
