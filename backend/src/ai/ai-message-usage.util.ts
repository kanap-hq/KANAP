import { LlmCacheCostFactors, llmCostEur } from './ai-llm-cost.util';
import { StreamUsage } from './providers/streaming.util';

/** The model that answered a chat turn, as resolved for that turn, with its prices and cache factors. */
export type AiMessageUsageModel = {
  provider: string;
  model: string;
  source: 'builtin' | 'registry';
  priceInputEurPerMtok: number | null;
  priceOutputEurPerMtok: number | null;
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
  json.cost_eur = llmCostEur(
    inputTokens,
    outputTokens,
    { priceInputEurPerMtok: model.priceInputEurPerMtok, priceOutputEurPerMtok: model.priceOutputEurPerMtok },
    {
      readTokens: usage.cache_read_input_tokens,
      writeTokens: usage.cache_write_input_tokens,
      factors: model.cacheCostFactors,
    },
  );
  return json;
}
