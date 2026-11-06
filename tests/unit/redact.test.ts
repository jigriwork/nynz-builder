import { describe, expect, it } from "vitest";
import { redact } from "../../lib/platform/redact";

describe("log redaction", () => {
  it("removes exact environment secret values", () => {
    const env = { SARVAM_API_KEY: "plain-value-without-prefix-1234", OPENROUTER_API_KEY: "router-value-should-never-leak", PREVIEW_SIGNING_SECRET: "signing-secret-abcdef" };
    const out = redact("key plain-value-without-prefix-1234 router-value-should-never-leak and signing-secret-abcdef", env);
    expect(out).not.toContain("plain-value");
    expect(out).not.toContain("signing-secret");
    expect(out).not.toContain("router-value");
  });

  it("removes Supabase keys, JWTs and preview session tokens", () => {
    const text = "auth eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl sb_secret_abcdefghijkl url?ny_session=payload.sig&x=1 Bearer abc.def e2b_0123456789abcdef"; // nynz-secret-scan: allow (fake test value)
    const out = redact(text, {});
    expect(out).not.toMatch(/eyJ|sb_secret_abc|payload\.sig|abc\.def|e2b_0123/);
    expect(out).toContain("ny_session=[redacted]");
  });
});
