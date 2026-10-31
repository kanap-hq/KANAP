import { LlmCacheCostFactors, llmCostEur } from './ai-llm-cost.util';
import { StreamUsage } from './providers/streaming.util';

/** The model that answered a chat turn, as resolved for that turn, with its prices and cache factors. */
export type AiMessageUsageModel = {
  provider: string;
  model: string;
  source: 'builtin' | 'registry';
  priceInputEurPerMtok: number | null;
  priceOutputEurPerMtok: number | null;
  priceCacheReadEurPerMtok: number | null;
  cacheCostFactors: LlmCacheCostFactors;
};

/**
 * The `usage_json` of an assistant message: its tokens, the model that produced them, that model's
 * prices and the cost they make. The cache fields appear only when the provider reported them.
 * The included model has prices at 0, so its cost is 0.
 */
export function buildMessageUsageJson(
  usage: StreamUsage | null | undefined,
  model: AiMessageUsageModel,
): Record<string, unknown> | null {
  if (!usage) {
    return null;
  }
  const inputTokens = Number(usage.input_tokens) || 0;
  const outputTokens = Number(usage.output_tokens) || 0;
  const json: Record<string, unknown> = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  };
  if (usage.cache_read_input_tokens != null) {
    json.cache_read_input_tokens = Number(usage.cache_read_input_tokens) || 0;
  }
  if (usage.cache_write_input_tokens != null) {
    json.cache_write_input_tokens = Number(usage.cache_write_input_tokens) || 0;
  }
  json.provider = model.provider;
  json.model = model.model;
  json.model_source = model.source;
  json.price_input_eur_per_mtok = model.priceInputEurPerMtok;
  json.price_output_eur_per_mtok = model.priceOutputEurPerMtok;
  json.price_cache_read_eur_per_mtok = model.priceCacheReadEurPerMtok ?? null;
  json.cost_eur = llmCostEur(
    inputTokens,
    outputTokens,
    {
      priceInputEurPerMtok: model.priceInputEurPerMtok,
      priceOutputEurPerMtok: model.priceOutputEurPerMtok,
      priceCacheReadEurPerMtok: model.priceCacheReadEurPerMtok,
    },
    {
      readTokens: usage.cache_read_input_tokens,
      writeTokens: usage.cache_write_input_tokens,
      factors: model.cacheCostFactors,
    },
  );
  return json;
}

const PUBLIC_USAGE_FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_write_input_tokens'] as const;

/**
 * The part of a message's `usage_json` the chat screen receives: its tokens only. The model's prices
 * and the cost stay on the server, where Admin › Usage and costs reads them.
 */
export function publicMessageUsage(usageJson: unknown): Record<string, number> | null {
  if (!usageJson || typeof usageJson !== 'object') {
    return null;
  }
  const source = usageJson as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const field of PUBLIC_USAGE_FIELDS) {
    if (typeof source[field] === 'number') {
      result[field] = source[field] as number;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}
