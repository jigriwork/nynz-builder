import { describe, expect, it } from "vitest";
import { checkUpload } from "../../lib/platform/uploads";
import { actualModelCallPaise, creditsForPaise, estimateModelCallPaise } from "../../lib/billing/pricing";

const bytes = (s: string) => new TextEncoder().encode(s);
describe("upload content checks", () => {
  it("rejects spoofed types and active SVG", () => {
    expect(checkUpload("image/png", bytes("MZ\x90\x00not a png"))).toMatch(/do not match/);
    expect(checkUpload("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBeNull();
    expect(checkUpload("application/pdf", bytes("<html>"))).toMatch(/do not match/);
    expect(checkUpload("image/svg+xml", bytes('<svg onload="alert(1)"></svg>'))).toMatch(/not allowed/);
    expect(checkUpload("image/svg+xml", bytes('<svg><script>alert(1)</script></svg>'))).toMatch(/not allowed/);
    expect(checkUpload("image/svg+xml", bytes('<svg><a href="https://evil"></a></svg>'))).toMatch(/not allowed/);
    expect(checkUpload("image/svg+xml", bytes('<svg viewBox="0 0 1 1"><use href="#a"/><path d="M0"/></svg>'))).toBeNull();
    expect(checkUpload("application/json", bytes("{bad"))).toMatch(/not valid/);
    expect(checkUpload("text/plain", new Uint8Array([0x61, 0x00]))).toMatch(/do not match/);
    expect(checkUpload("application/x-msdownload", bytes("x"))).toMatch(/Use an image/);
  });
});

describe("model-aware cost weighting", () => {
  const env = { USD_TO_INR_RATE: "95", PAISE_PER_CREDIT: "100" };
  it("prices models and token directions differently", () => {
    const sonnet = actualModelCallPaise({ model: "anthropic/claude-sonnet-5.5", inputTokens: 10_000, outputTokens: 1_000 }, env);
    const flash = actualModelCallPaise({ model: "google/gemini-3.8-flash", inputTokens: 10_000, outputTokens: 1_000 }, env);
    expect(sonnet.paise).toBe(Math.ceil((10_000 * 0.000002 + 1_000 * 0.00001) * 95 * 100));
    expect(flash.paise).toBeLessThan(sonnet.paise);
    const outputHeavy = actualModelCallPaise({ model: "anthropic/claude-sonnet-5.5", inputTokens: 1_000, outputTokens: 10_000 }, env);
    expect(outputHeavy.paise).toBeGreaterThan(sonnet.paise);
  });
  it("prefers provider-reported cost and labels estimates", () => {
    expect(actualModelCallPaise({ model: "x", inputTokens: 1, outputTokens: 1, providerCostUsd: 0.01 }, env)).toEqual({ paise: 95, source: "provider_reported" });
    expect(actualModelCallPaise({ model: "unknown/model", inputTokens: 1000, outputTokens: 0 }, env).source).toBe("estimated_from_price_table");
  });
  it("estimates the worst case across fallback models and rounds credits up", () => {
    const worst = estimateModelCallPaise(["google/gemini-3.8-flash", "anthropic/claude-sonnet-5.5"], 1000, 1000, env);
    expect(worst).toBe(estimateModelCallPaise(["anthropic/claude-sonnet-5.5"], 1000, 1000, env));
    expect(creditsForPaise(101, env)).toBe(2);
    expect(creditsForPaise(0, env)).toBe(0);
  });
});
