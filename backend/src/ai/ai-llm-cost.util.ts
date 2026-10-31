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
  // Price of a token read from the provider's cache; null or absent: the input price times `read` below.
  priceCacheReadEurPerMtok?: number | null;
};

// A cached prompt token is priced as a multiple of the input price: `read` for a
// token read from the provider's cache (unless the model has its own cache read
// price), `write` for a token written to it.
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
  // The cached part of inputTokens (which counts the whole prompt) and the provider's factors;
  // without it every input token is priced at the input price.
  cache?: LlmCachedInput | null,
): number {
  const priceIn = Math.max(0, prices?.priceInputEurPerMtok ?? 0);
  const priceOut = Math.max(0, prices?.priceOutputEurPerMtok ?? 0);
  const priceCacheRead = prices?.priceCacheReadEurPerMtok ?? null;
  // Free without any price; with only the cache read price set, only the tokens read from the cache cost.
  if (priceIn <= 0 && priceOut <= 0 && !(priceCacheRead != null && priceCacheRead > 0)) return 0;
  const total = Math.max(0, inputTokens);
  const factors = cache?.factors ?? NO_CACHE_DISCOUNT;
  const read = Math.min(total, Math.max(0, cache?.readTokens ?? 0));
  const write = Math.min(total - read, Math.max(0, cache?.writeTokens ?? 0));
  const readPrice = priceCacheRead != null ? Math.max(0, priceCacheRead) : priceIn * Math.max(0, factors.read);
  const writePrice = priceIn * Math.max(0, factors.write);
  const cost = ((total - read - write) * priceIn
    + read * readPrice
    + write * writePrice
    + Math.max(0, outputTokens) * priceOut) / 1_000_000;
  return Number(cost.toFixed(6));
}
