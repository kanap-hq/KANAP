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

export function llmCostEur(
  inputTokens: number,
  outputTokens: number,
  prices: LlmTokenPrices | null | undefined,
): number {
  const priceIn = prices?.priceInputEurPerMtok ?? 0;
  const priceOut = prices?.priceOutputEurPerMtok ?? 0;
  if (priceIn <= 0 && priceOut <= 0) return 0;
  const cost = (Math.max(0, inputTokens) * Math.max(0, priceIn)
    + Math.max(0, outputTokens) * Math.max(0, priceOut)) / 1_000_000;
  return Number(cost.toFixed(6));
}

export function chatPricesArePositive(prices: LlmTokenPrices | null | undefined): boolean {
  return (prices?.priceInputEurPerMtok ?? 0) > 0 || (prices?.priceOutputEurPerMtok ?? 0) > 0;
}

/** The model and the rates applied when an assistant message was produced. */
export type RecordedChatModel = {
  provider: string;
  model: string;
  priceInputEurPerMtok: number | null;
  priceOutputEurPerMtok: number | null;
};

/**
 * Token usage plus the provider, the model and the prices applied at the time.
 * Stored on `ai_messages.usage_json`. A later change of the assigned model
 * does not rewrite it. Tokens are omitted when the provider reported none.
 */
export function assistantMessageUsage(
  usage: { input_tokens?: number; output_tokens?: number } | null | undefined,
  model: RecordedChatModel,
): Record<string, unknown> {
  const recorded: Record<string, unknown> = {
    provider: model.provider,
    model: model.model,
    price_input_eur_per_mtok: model.priceInputEurPerMtok,
    price_output_eur_per_mtok: model.priceOutputEurPerMtok,
  };
  if (usage) {
    recorded.input_tokens = usage.input_tokens ?? 0;
    recorded.output_tokens = usage.output_tokens ?? 0;
  }
  return recorded;
}

export type ChatMessageCostRow = {
  inputTokens: number;
  outputTokens: number;
  /**
   * The message stored the model that produced it. Prices may still be null
   * or zero (a free model, or one registered without prices): that is a
   * recorded rate of zero, not a reason to apply today's model.
   */
  recorded: boolean;
  priceInputEurPerMtok: number | null;
  priceOutputEurPerMtok: number | null;
};

/**
 * Sum of per-message chat costs. A message without a recorded model is priced
 * at `fallbackPrices` (the model assigned today). Each message is rounded the
 * way `llmCostEur` rounds, then the sum is rounded once more.
 */
export function sumChatMessageCostsEur(
  messages: readonly ChatMessageCostRow[],
  fallbackPrices: LlmTokenPrices | null | undefined,
): number {
  let total = 0;
  for (const message of messages) {
    const prices = message.recorded
      ? {
          priceInputEurPerMtok: message.priceInputEurPerMtok,
          priceOutputEurPerMtok: message.priceOutputEurPerMtok,
        }
      : fallbackPrices;
    total += llmCostEur(message.inputTokens, message.outputTokens, prices);
  }
  return Number(total.toFixed(6));
}
