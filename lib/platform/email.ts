/**
 * Email delivery guard. Supabase sends NYNZ's auth emails (invitations,
 * password resets). Messages are never sent to reserved test domains, and all
 * delivery can be disabled with NYNZ_EMAIL_DELIVERY=disabled (used by tests
 * and fixtures), in which case invitations remain acceptable inside NYNZ.
 */
const RESERVED = /(^|\.)(example\.(com|net|org)|test|invalid|localhost|example)$/i;

export function canSendEmail(email: string, env: Record<string, string | undefined> = process.env) {
  if (env.NYNZ_EMAIL_DELIVERY === "disabled") return false;
  const domain = email.split("@")[1] || "";
  return Boolean(domain) && !RESERVED.test(domain);
}

export function appOrigin(env: Record<string, string | undefined> = process.env) {
  const value = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return new URL(value).origin;
}
