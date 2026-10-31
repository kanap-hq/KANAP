// Shared LLM cost math for the model registry (PR 2 of the AI model registry
// plan). Replaces the flat TOKEN_COST_EUR constant that was duplicated across
// every LLM stage service and priced all models — including free local ones —
// at the same made-up rate.
//
// Prices are €/Mtok as stored on the resolved model. A model with no prices
// (or 0/0 — local, self-hosted, or the platform builtin) costs 0: cost caps
// then never trigger for it, and the token caps remain the protection.

export type LlmTokenPrices = {
  priceInputEurPerMtok: number | null;
  priceOutputEurPerMtok: number | null;
};

// A cached prompt token is priced as a multiple of the input price: `read` for a
// token read from the provider's cache, `write` for a token written to it.
export type LlmCacheCostFactors = {
  read: number;
  write: number;
};

// Providers whose cache discount is unknown: cached tokens at the full input price, so the cost stays a ceiling.
export const NO_CACHE_DISCOUNT: LlmCacheCostFactors = { read: 1, write: 1 };

export type LlmCachedInput = {
  readTokens?: number | null;
  writeTokens?: number | null;
  factors?: LlmCacheCostFactors | null;
};

export function llmCostEur(
  inputTokens: number,
  outputTokens: number,
  prices: LlmTokenPrices | null | undefined,
  // The cached part of inputTokens (which counts the whole prompt) and its factors;
  // without them every input token is priced at the input price.
  cache?: LlmCachedInput | null,
): number {
  const priceIn = prices?.priceInputEurPerMtok ?? 0;
  const priceOut = prices?.priceOutputEurPerMtok ?? 0;
  if (priceIn <= 0 && priceOut <= 0) return 0;
  const cost = (weightedInputTokens(inputTokens, cache) * Math.max(0, priceIn)
    + Math.max(0, outputTokens) * Math.max(0, priceOut)) / 1_000_000;
  return Number(cost.toFixed(6));
}

function weightedInputTokens(inputTokens: number, cache: LlmCachedInput | null | undefined): number {
  const total = Math.max(0, inputTokens);
  if (!cache?.factors) return total;
  const read = Math.min(total, Math.max(0, cache.readTokens ?? 0));
  const write = Math.min(total - read, Math.max(0, cache.writeTokens ?? 0));
  const uncached = total - read - write;
  return uncached + read * Math.max(0, cache.factors.read) + write * Math.max(0, cache.factors.write);
}
