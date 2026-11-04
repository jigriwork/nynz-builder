/**
 * Model/provider-aware cost weighting.
 *
 * Credits are an internal allowance unit: 1 credit = PAISE_PER_CREDIT paise of
 * provider cost (default 100, i.e. ₹1 of measured or estimated provider cost).
 * Charges use the provider-reported cost when it is returned (OpenRouter
 * `usage.cost`). When it is not, the price table below is used and the event is
 * labelled as an estimate. Input and output tokens, and different models, are
 * priced separately; tokens are never converted 1:1 into credits.
 *
 * Default prices are OpenRouter list prices fetched from
 * https://openrouter.ai/api/v1/models on 2026-11-04 (USD per token). Override
 * with MODEL_PRICES_JSON='{"model":{"in":0.000002,"out":0.00001}}'.
 */
export type ModelPrice = { in: number; out: number; source: string };

const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "anthropic/claude-sonnet-5.5": { in: 0.000002, out: 0.00001, source: "openrouter-list-2026-11-04" },
  "anthropic/claude-sonnet-5": { in: 0.000002, out: 0.00001, source: "openrouter-list-2026-11-04" },
  "google/gemini-3.8-flash": { in: 0.000000825, out: 0.000004125, source: "openrouter-list-2026-11-04" },
};
// Unknown models are priced conservatively at the most expensive known rate.
const UNKNOWN: ModelPrice = { in: 0.000015, out: 0.000075, source: "conservative-default" };

export function usdToInrRate(env: Record<string, string | undefined> = process.env) {
  const rate = Number(env.USD_TO_INR_RATE || 95);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("USD_TO_INR_RATE must be a positive number");
  return rate;
}

export function paisePerCredit(env: Record<string, string | undefined> = process.env) {
  const value = Number(env.PAISE_PER_CREDIT || 100);
  if (!Number.isInteger(value) || value < 1) throw new Error("PAISE_PER_CREDIT must be a positive integer");
  return value;
}

export function priceFor(model: string, env: Record<string, string | undefined> = process.env): ModelPrice {
  const bare = model.replace(/^openrouter:/, "");
  let overrides: Record<string, { in: number; out: number }> = {};
  try { overrides = env.MODEL_PRICES_JSON ? JSON.parse(env.MODEL_PRICES_JSON) : {}; } catch { overrides = {}; }
  if (overrides[bare]) return { ...overrides[bare], source: "configured" };
  return DEFAULT_PRICES[bare] || UNKNOWN;
}

export function usdToPaise(usd: number, env: Record<string, string | undefined> = process.env) {
  return Math.ceil(usd * usdToInrRate(env) * 100);
}

/** Worst-case cost of one model call across every model it may fall back to. */
export function estimateModelCallPaise(models: string[], inputTokens: number, maxOutputTokens: number, env: Record<string, string | undefined> = process.env) {
  const worst = Math.max(...models.map((model) => {
    const price = priceFor(model, env);
    return inputTokens * price.in + maxOutputTokens * price.out;
  }));
  return usdToPaise(worst, env);
}

/** Actual charge for a completed call: provider-reported cost when present. */
export function actualModelCallPaise(input: { model: string; inputTokens: number; outputTokens: number; providerCostUsd?: number | null }, env: Record<string, string | undefined> = process.env) {
  if (input.providerCostUsd && input.providerCostUsd > 0) return { paise: usdToPaise(input.providerCostUsd, env), source: "provider_reported" as const };
  const price = priceFor(input.model, env);
  return { paise: usdToPaise(input.inputTokens * price.in + input.outputTokens * price.out, env), source: "estimated_from_price_table" as const, priceSource: price.source };
}

/** Rough token count for pre-call estimates (deliberately pessimistic). */
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 3);
}

export function creditsForPaise(paise: number, env: Record<string, string | undefined> = process.env) {
  return Math.max(0, Math.ceil(paise / paisePerCredit(env)));
}

/** E2B and Firecrawl have no per-call price in their responses; these are labelled estimates. */
export function sandboxSecondsPaise(seconds: number, env: Record<string, string | undefined> = process.env) {
  // Default: 2 vCPU + 2 GiB on E2B's published usage pricing (~$0.000028/s); override when measured.
  return usdToPaise(seconds * Number(env.E2B_COST_USD_PER_SECOND || 0.000028), env);
}

export function firecrawlPagePaise(pages: number, env: Record<string, string | undefined> = process.env) {
  return usdToPaise(pages * Number(env.FIRECRAWL_COST_USD_PER_PAGE || 0.00083), env);
}
