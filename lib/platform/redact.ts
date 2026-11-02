// Removes provider credentials, Supabase keys and preview session tokens from
// text before it is written to logs. Exact secret values from the environment
// are always removed, with pattern matching as a second line of defence.
const secretNames = ["SUPABASE_SERVICE_ROLE_KEY", "SARVAM_API_KEY", "OPENROUTER_API_KEY", "E2B_API_KEY", "PREVIEW_SIGNING_SECRET", "FIRECRAWL_API_KEY"];

export function redact(text: string, env: Record<string, string | undefined> = process.env) {
  let out = text;
  for (const name of secretNames) {
    const value = env[name];
    if (value && value.length >= 8) out = out.split(value).join("[redacted]");
  }
  return out
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/(ny_session=|nynz_preview_session=|e2b-traffic-access-token:?\s*|bearer\s+)[^\s&;"']+/gi, "$1[redacted]")
    .replace(/(?:sk|e2b|fc)[-_][A-Za-z0-9_-]{12,}/g, "[redacted]");
}
