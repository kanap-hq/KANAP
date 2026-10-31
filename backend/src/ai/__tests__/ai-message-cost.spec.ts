import * as assert from 'node:assert/strict';
import { llmCostEur, NO_CACHE_DISCOUNT } from '../ai-llm-cost.util';
import { buildMessageUsageJson } from '../ai-message-usage.util';
import { ANTHROPIC_CACHE_COST_FACTORS } from '../providers/anthropic-ai-provider.adapter';
import { toUsage } from '../providers/openai-stream.util';
import { addUsage, cloneUsage } from '../providers/streaming.util';

function testCloneUsageKeepsCacheFieldsOnlyWhenKnown() {
  assert.equal(cloneUsage(null), undefined);
  assert.deepEqual(cloneUsage({ input_tokens: 10, output_tokens: 5 }), { input_tokens: 10, output_tokens: 5 });
  assert.deepEqual(
    cloneUsage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 6, cache_write_input_tokens: 0 }),
    { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 6, cache_write_input_tokens: 0 },
  );
}

function testAddUsageSumsCacheFields() {
  // Absent on both sides stays absent.
  assert.deepEqual(
    addUsage({ input_tokens: 10, output_tokens: 5 }, { input_tokens: 20, output_tokens: 1 }),
    { input_tokens: 30, output_tokens: 6 },
  );
  // Absent on one side counts as 0.
  assert.deepEqual(
    addUsage({ input_tokens: 10, output_tokens: 5 }, { input_tokens: 20, output_tokens: 1, cache_read_input_tokens: 15 }),
    { input_tokens: 30, output_tokens: 6, cache_read_input_tokens: 15 },
  );
  assert.deepEqual(
    addUsage(
      { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 80, cache_write_input_tokens: 10 },
      { input_tokens: 120, output_tokens: 7, cache_read_input_tokens: 90, cache_write_input_tokens: 20 },
    ),
    { input_tokens: 220, output_tokens: 12, cache_read_input_tokens: 170, cache_write_input_tokens: 30 },
  );
  assert.deepEqual(
    addUsage(undefined, { input_tokens: 1, output_tokens: 2, cache_write_input_tokens: 3 }),
    { input_tokens: 1, output_tokens: 2, cache_write_input_tokens: 3 },
  );
  const total = { input_tokens: 1, output_tokens: 2 };
  assert.equal(addUsage(total, null), total);
}

function testOpenAiCompatibleUsageReadsCachedTokens() {
  assert.equal(toUsage(null), undefined);
  // OpenAI and Mistral.
  assert.deepEqual(
    toUsage({ prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1024 } }),
    { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 1024 },
  );
  // DeepSeek.
  assert.deepEqual(
    toUsage({ prompt_tokens: 900, completion_tokens: 40, prompt_cache_hit_tokens: 640 }),
    { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 640 },
  );
  // No cache reported (Ollama, older servers).
  assert.deepEqual(
    toUsage({ prompt_tokens: 300, completion_tokens: 20 }),
    { input_tokens: 300, output_tokens: 20 },
  );
  assert.deepEqual(
    toUsage({ prompt_tokens: 300, completion_tokens: 20, prompt_tokens_details: { cached_tokens: null } }),
    { input_tokens: 300, output_tokens: 20 },
  );
}

function testLlmCostEurWithCache() {
  const prices = { priceInputEurPerMtok: 3, priceOutputEurPerMtok: 15 };
  // Without the cached part: the cost is unchanged.
  assert.equal(llmCostEur(500_000, 100_000, prices), 3);
  assert.equal(llmCostEur(500_000, 100_000, prices, null), 3);
  assert.equal(llmCostEur(500_000, 100_000, prices, { readTokens: 400_000 }), 3);
  assert.equal(llmCostEur(500_000, 100_000, prices, { factors: ANTHROPIC_CACHE_COST_FACTORS }), 3);
  // Anthropic: 100k uncached + 300k read at 0.1 + 100k written at 1.25 = 255k input tokens priced.
  assert.equal(
    llmCostEur(500_000, 100_000, prices, {
      readTokens: 300_000,
      writeTokens: 100_000,
      factors: ANTHROPIC_CACHE_COST_FACTORS,
    }),
    Number(((255_000 * 3 + 100_000 * 15) / 1_000_000).toFixed(6)),
  );
  // A provider without a known discount: the cached part costs the full input price.
  assert.equal(
    llmCostEur(500_000, 100_000, prices, { readTokens: 300_000, writeTokens: 100_000, factors: NO_CACHE_DISCOUNT }),
    3,
  );
  // A model without prices costs 0 whatever its cache.
  assert.equal(
    llmCostEur(500_000, 100_000, { priceInputEurPerMtok: 0, priceOutputEurPerMtok: 0 }, {
      readTokens: 300_000,
      factors: ANTHROPIC_CACHE_COST_FACTORS,
    }),
    0,
  );
}

function testMessageUsageJsonForIncludedModel() {
  const json = buildMessageUsageJson(
    { input_tokens: 120_000, output_tokens: 900, cache_read_input_tokens: 98_000, cache_write_input_tokens: 4_000 },
    {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      source: 'builtin',
      priceInputEurPerMtok: 0,
      priceOutputEurPerMtok: 0,
      cacheCostFactors: ANTHROPIC_CACHE_COST_FACTORS,
    },
  );
  assert.deepEqual(json, {
    input_tokens: 120_000,
    output_tokens: 900,
    cache_read_input_tokens: 98_000,
    cache_write_input_tokens: 4_000,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    model_source: 'builtin',
    price_input_eur_per_mtok: 0,
    price_output_eur_per_mtok: 0,
    cost_eur: 0,
  });
  assert.equal(buildMessageUsageJson(null, {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    source: 'builtin',
    priceInputEurPerMtok: 0,
    priceOutputEurPerMtok: 0,
    cacheCostFactors: ANTHROPIC_CACHE_COST_FACTORS,
  }), null);
}

function testMessageUsageJsonForPricedModel() {
  const anthropic = buildMessageUsageJson(
    { input_tokens: 500_000, output_tokens: 100_000, cache_read_input_tokens: 300_000, cache_write_input_tokens: 100_000 },
    {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      source: 'registry',
      priceInputEurPerMtok: 3,
      priceOutputEurPerMtok: 15,
      cacheCostFactors: ANTHROPIC_CACHE_COST_FACTORS,
    },
  );
  assert.equal(anthropic?.model_source, 'registry');
  assert.equal(anthropic?.price_input_eur_per_mtok, 3);
  assert.equal(anthropic?.price_output_eur_per_mtok, 15);
  assert.equal(anthropic?.cost_eur, 2.265);

  // Without cache fields: none appear, and the cost is the plain one.
  const openai = buildMessageUsageJson(
    { input_tokens: 1_000_000, output_tokens: 200_000 },
    {
      provider: 'openai',
      model: 'gpt-4o',
      source: 'registry',
      priceInputEurPerMtok: 2,
      priceOutputEurPerMtok: 8,
      cacheCostFactors: NO_CACHE_DISCOUNT,
    },
  );
  assert.deepEqual(openai, {
    input_tokens: 1_000_000,
    output_tokens: 200_000,
    provider: 'openai',
    model: 'gpt-4o',
    model_source: 'registry',
    price_input_eur_per_mtok: 2,
    price_output_eur_per_mtok: 8,
    cost_eur: 3.6,
  });
}

async function run() {
  const tests = [
    testCloneUsageKeepsCacheFieldsOnlyWhenKnown,
    testAddUsageSumsCacheFields,
    testOpenAiCompatibleUsageReadsCachedTokens,
    testLlmCostEurWithCache,
    testMessageUsageJsonForIncludedModel,
    testMessageUsageJsonForPricedModel,
  ];
  for (const test of tests) {
    await test();
    console.log(`${test.name}: all assertions passed`);
  }
}

void run();
