import * as assert from 'node:assert/strict';
import {
  assistantMessageUsage,
  sumChatMessageCostsEur,
  type ChatMessageCostRow,
} from '../ai-llm-cost.util';

const today = { priceInputEurPerMtok: 10, priceOutputEurPerMtok: 20 };

function message(partial: Partial<ChatMessageCostRow> & Pick<ChatMessageCostRow, 'inputTokens' | 'outputTokens'>): ChatMessageCostRow {
  return {
    recorded: false,
    priceInputEurPerMtok: null,
    priceOutputEurPerMtok: null,
    ...partial,
  };
}

async function testTwoModelsAndOneOldMessageInTheSameMonth() {
  // Two messages that stored their own rates, plus one written before that
  // recording. Today's 10/20 applies only to the old message.
  const cost = sumChatMessageCostsEur([
    message({
      inputTokens: 1_000_000,
      outputTokens: 0,
      recorded: true,
      priceInputEurPerMtok: 2,
      priceOutputEurPerMtok: 8,
    }),
    message({
      inputTokens: 500_000,
      outputTokens: 100_000,
      recorded: true,
      priceInputEurPerMtok: 3,
      priceOutputEurPerMtok: 15,
    }),
    message({ inputTokens: 1_000_000, outputTokens: 0 }),
  ], today);
  // 2 + (1.5 + 1.5) + 10.
  assert.equal(cost, 15);
}

async function testRecordedModelWithoutPricesStaysFree() {
  const cost = sumChatMessageCostsEur([
    message({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      recorded: true,
      priceInputEurPerMtok: null,
      priceOutputEurPerMtok: null,
    }),
    message({
      inputTokens: 1_000_000,
      outputTokens: 0,
      recorded: true,
      priceInputEurPerMtok: 0,
      priceOutputEurPerMtok: 0,
    }),
  ], today);
  assert.equal(cost, 0);
}

async function testNoFallbackAndNoMessagesCostsNothing() {
  assert.equal(sumChatMessageCostsEur([], null), 0);
  assert.equal(sumChatMessageCostsEur([
    message({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
  ], null), 0);
}

async function testAssistantUsageKeepsTokensProviderModelAndPrices() {
  assert.deepEqual(
    assistantMessageUsage(
      { input_tokens: 12, output_tokens: 7 },
      { provider: 'anthropic', model: 'claude-sonnet-4', priceInputEurPerMtok: 3, priceOutputEurPerMtok: 15 },
    ),
    {
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      price_input_eur_per_mtok: 3,
      price_output_eur_per_mtok: 15,
      input_tokens: 12,
      output_tokens: 7,
    },
  );
  // A turn the provider did not meter still records which model produced it.
  const unmetered = assistantMessageUsage(null, {
    provider: 'openai',
    model: 'gpt-4o',
    priceInputEurPerMtok: null,
    priceOutputEurPerMtok: null,
  });
  assert.equal(unmetered.provider, 'openai');
  assert.equal(unmetered.model, 'gpt-4o');
  assert.equal('input_tokens' in unmetered, false);
  assert.equal(unmetered.price_input_eur_per_mtok, null);
}

async function run() {
  await testTwoModelsAndOneOldMessageInTheSameMonth();
  await testRecordedModelWithoutPricesStaysFree();
  await testNoFallbackAndNoMessagesCostsNothing();
  await testAssistantUsageKeepsTokensProviderModelAndPrices();
  console.log('ai-chat-message-cost: ok');
}

void run();
