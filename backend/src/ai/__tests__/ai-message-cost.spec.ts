import * as assert from 'node:assert/strict';
import { z } from 'zod';
import { llmCostEur, NO_CACHE_DISCOUNT } from '../ai-llm-cost.util';
import { buildMessageUsageJson } from '../ai-message-usage.util';
import { ResolvedModel } from '../ai-model-resolver.service';
import { agentCallCostEur, AiAgentLlmClient } from '../control-plane/agent-control/ai-agent-llm-client';
import { AiProviderAdapter, AiStreamEvent } from '../providers/ai-provider.types';
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
      priceCacheReadEurPerMtok: 0,
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
    price_cache_read_eur_per_mtok: 0,
    cost_eur: 0,
  });
  assert.equal(buildMessageUsageJson(null, {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    source: 'builtin',
    priceInputEurPerMtok: 0,
    priceOutputEurPerMtok: 0,
    priceCacheReadEurPerMtok: 0,
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
      priceCacheReadEurPerMtok: null,
      cacheCostFactors: ANTHROPIC_CACHE_COST_FACTORS,
    },
  );
  assert.equal(anthropic?.model_source, 'registry');
  assert.equal(anthropic?.price_input_eur_per_mtok, 3);
  assert.equal(anthropic?.price_output_eur_per_mtok, 15);
  assert.equal(anthropic?.price_cache_read_eur_per_mtok, null);
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
      priceCacheReadEurPerMtok: null,
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
    price_cache_read_eur_per_mtok: null,
    cost_eur: 3.6,
  });

  // Mistral, 99 % of the prompt read from the cache, with the model's cache read price:
  // 10k uncached at 2 + 990k read at 0.2 + 10k output at 6.
  const mistral = buildMessageUsageJson(
    { input_tokens: 1_000_000, output_tokens: 10_000, cache_read_input_tokens: 990_000 },
    {
      provider: 'openai',
      model: 'mistral-medium-latest',
      source: 'registry',
      priceInputEurPerMtok: 2,
      priceOutputEurPerMtok: 6,
      priceCacheReadEurPerMtok: 0.2,
      cacheCostFactors: NO_CACHE_DISCOUNT,
    },
  );
  assert.equal(mistral?.price_cache_read_eur_per_mtok, 0.2);
  assert.equal(mistral?.cache_read_input_tokens, 990_000);
  assert.equal(mistral?.cost_eur, 0.278);
}

function testLlmCostEurWithCacheReadPrice() {
  const read = (priceCacheReadEurPerMtok: number | null) => ({
    priceInputEurPerMtok: 3,
    priceOutputEurPerMtok: 15,
    priceCacheReadEurPerMtok,
  });
  const cache = (factors = ANTHROPIC_CACHE_COST_FACTORS) => ({ readTokens: 300_000, writeTokens: 100_000, factors });
  // Set: the read tokens cost it, whatever the provider's factor; writes keep input x write factor.
  // 100k uncached at 3 + 300k read at 0.5 + 100k written at 3.75 + 100k output at 15.
  assert.equal(llmCostEur(500_000, 100_000, read(0.5), cache()), 2.325);
  assert.equal(
    llmCostEur(500_000, 100_000, read(0.5), cache(NO_CACHE_DISCOUNT)),
    Number(((100_000 * 3 + 300_000 * 0.5 + 100_000 * 3 + 100_000 * 15) / 1_000_000).toFixed(6)),
  );
  // An explicit 0: the read tokens are free.
  assert.equal(llmCostEur(500_000, 100_000, read(0), cache()), 2.175);
  // Empty with Anthropic: input x 0.1, as before.
  assert.equal(llmCostEur(500_000, 100_000, read(null), cache()), 2.265);
  assert.equal(
    llmCostEur(500_000, 100_000, { priceInputEurPerMtok: 3, priceOutputEurPerMtok: 15 }, cache()),
    2.265,
  );
  // Empty with another provider: the full input price.
  assert.equal(llmCostEur(500_000, 100_000, read(null), cache(NO_CACHE_DISCOUNT)), 3);
  // Without cache tokens the cache read price changes nothing.
  assert.equal(llmCostEur(500_000, 100_000, read(0.5)), 3);
  assert.equal(llmCostEur(500_000, 100_000, read(0.5), { factors: ANTHROPIC_CACHE_COST_FACTORS }), 3);
  // Without input and output prices: free (local model, included model at 0/0/0)...
  assert.equal(llmCostEur(500_000, 100_000, { priceInputEurPerMtok: null, priceOutputEurPerMtok: null }, cache()), 0);
  assert.equal(
    llmCostEur(500_000, 100_000, { priceInputEurPerMtok: 0, priceOutputEurPerMtok: 0, priceCacheReadEurPerMtok: 0 }, cache()),
    0,
  );
  // ...unless the cache read price alone is set: then only the read tokens cost (300k at 0.5).
  assert.equal(
    llmCostEur(500_000, 100_000, { priceInputEurPerMtok: null, priceOutputEurPerMtok: 0, priceCacheReadEurPerMtok: 0.5 }, cache()),
    0.15,
  );
}

function fakeAdapter(events: AiStreamEvent[][]): AiProviderAdapter & { calls: number } {
  const adapter = {
    calls: 0,
    descriptor: { id: 'openai' },
    validateConfiguration: () => [],
    async *createStream() {
      const batch = events[adapter.calls] ?? [];
      adapter.calls += 1;
      for (const event of batch) yield event;
    },
  };
  return adapter as unknown as AiProviderAdapter & { calls: number };
}

async function testAgentCallCostUsesCacheReadPrice() {
  // A registry model with its own cache read price; the provider reports cached tokens on each call.
  const resolved = {
    source: 'registry',
    configId: 'cfg-1',
    configName: 'Mistral',
    provider: 'openai',
    model: 'mistral-medium-latest',
    endpointUrl: null,
    apiKey: 'sk-test',
    hasApiKey: true,
    supportsVision: false,
    priceInputEurPerMtok: 2,
    priceOutputEurPerMtok: 6,
    priceCacheReadEurPerMtok: 0.2,
    timeoutMs: null,
    builtinRateLimits: null,
  } as ResolvedModel;
  // First answer is not JSON (the client retries), the second is: the usage adds both calls up.
  const adapter = fakeAdapter([
    [
      { type: 'text_delta', text: 'not json' },
      { type: 'done', usage: { input_tokens: 100_000, output_tokens: 1_000, cache_read_input_tokens: 90_000 } },
    ],
    [
      { type: 'text_delta', text: '{"ok":true}' },
      { type: 'done', usage: { input_tokens: 110_000, output_tokens: 1_000, cache_read_input_tokens: 100_000 } },
    ],
  ]);
  const client = new AiAgentLlmClient(
    { tryResolve: async () => resolved } as any,
    { get: () => adapter } as any,
  );
  const result = await client.callStructuredJsonModel({ tenantId: 'tenant-1', agentId: 'agent-1', manager: {} } as any, {
    taskName: 'cache_cost',
    systemPrompt: 'Return JSON.',
    userPayload: { question: 'x' },
    schema: z.object({ ok: z.boolean() }),
    maxTokens: 100,
    timeoutEnvName: 'AI_TEST_CACHE_COST_TIMEOUT_MS',
    defaultTimeoutMs: 5_000,
  });
  assert.ok(result?.ok, 'the second answer parses');
  assert.equal(adapter.calls, 2);
  assert.equal(result.runtime?.priceCacheReadEurPerMtok, 0.2);
  assert.deepEqual(result.runtime?.cacheCostFactors, NO_CACHE_DISCOUNT);
  assert.deepEqual(result.usage, {
    input_tokens: 210_000,
    output_tokens: 2_000,
    cache_read_input_tokens: 190_000,
  });
  // What the agent services record as estimated_cost_eur:
  // 20k uncached at 2 + 190k read at 0.2 + 2k output at 6.
  const cost = agentCallCostEur(result.usage!.input_tokens, result.usage!.output_tokens, result.runtime, result.usage);
  assert.equal(cost, 0.09);
  // Without the cache read price, the same call costs the full input price (no known discount).
  assert.equal(
    agentCallCostEur(210_000, 2_000, { ...result.runtime!, priceCacheReadEurPerMtok: null }, result.usage),
    0.432,
  );
  // An estimate (no usage reported) prices the whole prompt at the input price.
  assert.equal(agentCallCostEur(210_000, 2_000, result.runtime, null), 0.432);
}

async function run() {
  const tests = [
    testCloneUsageKeepsCacheFieldsOnlyWhenKnown,
    testAddUsageSumsCacheFields,
    testOpenAiCompatibleUsageReadsCachedTokens,
    testLlmCostEurWithCache,
    testMessageUsageJsonForIncludedModel,
    testMessageUsageJsonForPricedModel,
    testLlmCostEurWithCacheReadPrice,
    testAgentCallCostUsesCacheReadPrice,
  ];
  for (const test of tests) {
    await test();
    console.log(`${test.name}: all assertions passed`);
  }
}

void run();
