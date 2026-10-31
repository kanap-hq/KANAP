import * as assert from 'node:assert/strict';
import { AiProviderTestService } from '../ai-provider-test.service';
import { PROVIDER_TEST_MAX_RETRIES, PROVIDER_TEST_TIMEOUT_MS } from '../provider-test.constants';
import { AiProviderAdapter } from '../providers/ai-provider.types';

function createService(options?: {
  settings?: any;
  validate?: (snapshot: any) => string[];
  stream?: (params: any) => AsyncGenerator<any>;
  decrypt?: (value: string) => string;
}) {
  const adapter: AiProviderAdapter = {
    descriptor: {
      id: 'openai',
      label: 'OpenAI',
      description: 'Test adapter',
      capabilities: {
        supportsStreaming: true,
        supportsToolCalling: true,
        requiresApiKey: true,
        allowsCustomEndpoint: true,
      },
    },
    validateConfiguration: options?.validate ?? (() => []),
    createStream: options?.stream ?? (async function* () {
      yield { type: 'done' };
    }),
  };

  return {
    service: new AiProviderTestService(
      {
        find: async () => options?.settings ?? null,
      } as any,
      {
        decrypt: options?.decrypt ?? ((value: string) => value),
      } as any,
      {
        validate: (snapshot: any) => adapter.validateConfiguration(snapshot),
        get: () => adapter,
      } as any,
    ),
    adapter,
  };
}

async function testUsesPersistedSecretWhenApiKeyIsOmitted() {
  let capturedParams: any = null;
  const { service } = createService({
    settings: {
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      llm_endpoint_url: null,
      llm_api_key_encrypted: 'encrypted-secret',
    },
    decrypt: (value: string) => {
      assert.equal(value, 'encrypted-secret');
      return 'saved-secret';
    },
    stream: async function* (params: any) {
      capturedParams = params;
      yield { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } };
    },
  });

  const result = await service.testProvider('tenant-1', {
    llm_provider: 'openai',
    llm_model: 'gpt-4o-mini',
    llm_endpoint_url: '',
    llm_api_key: '',
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'openai');
  assert.equal(result.model, 'gpt-4o-mini');
  assert.equal(result.validation_errors.length, 0);
  assert.equal(typeof result.latency_ms, 'number');
  assert.equal(capturedParams.apiKey, 'saved-secret');
  assert.equal(capturedParams.timeoutMs, PROVIDER_TEST_TIMEOUT_MS);
  assert.equal(capturedParams.maxRetries, PROVIDER_TEST_MAX_RETRIES);
  assert.equal(capturedParams.messages.length, 1);
}

async function testReturnsValidationErrorsWithoutCallingProvider() {
  let called = false;
  const { service } = createService({
    validate: () => ['Provider is required.'],
    stream: async function* () {
      called = true;
      yield { type: 'done' };
    },
  });

  const result = await service.testProvider('tenant-1', {});

  assert.equal(result.ok, false);
  assert.equal(result.message, 'Provider settings are incomplete.');
  assert.deepEqual(result.validation_errors, ['Provider is required.']);
  assert.equal(called, false);
}

// F1 SSRF: a private/internal custom endpoint fails the test WITHOUT calling the provider.
async function testRejectsInternalEndpointWithoutCallingProvider() {
  let called = false;
  const { service } = createService({
    stream: async function* () {
      called = true;
      yield { type: 'done' };
    },
  });

  const result = await service.testProvider('tenant-1', {
    llm_provider: 'openai',
    llm_model: 'gpt-4o-mini',
    llm_api_key: 'sk-test',
    llm_endpoint_url: 'http://169.254.169.254/latest/meta-data/',
  });

  assert.equal(result.ok, false);
  assert.equal(called, false);
  assert.ok(/private or internal/i.test(String(result.message)));
}

async function testReturnsRuntimeFailureMessage() {
  const { service } = createService({
    settings: {
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      llm_endpoint_url: null,
      llm_api_key_encrypted: null,
    },
    validate: () => [],
    stream: async function* () {
      throw new Error('connection failed');
    },
  });

  const result = await service.testProvider('tenant-1', {
    llm_provider: 'openai',
    llm_model: 'gpt-4o-mini',
    llm_api_key: 'provided-secret',
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, 'connection failed');
  assert.equal(result.validation_errors.length, 0);
  assert.equal(typeof result.latency_ms, 'number');
}

// A registry model's test sends its reasoning effort; a provider that refuses the value fails the
// test with its own message.
async function testSendsTheReasoningEffortAndShowsARefusal() {
  const captured: any[] = [];
  const { service } = createService({
    stream: async function* (params: any) {
      captured.push(params);
      // As the OpenAI-compatible stream does for a refused call (openai-stream.util.spec).
      if (params.reasoningEffort === 'max') {
        throw new Error('AI provider request failed (HTTP 400): unknown variant `max` for reasoning_effort');
      }
      yield { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } };
    },
  });
  const input = { llm_provider: 'openai', llm_model: 'deepseek-v4', llm_api_key: 'secret' };

  const accepted = await service.testProvider('tenant-1', { ...input, reasoning_effort: 'high' }, { skipStoredFallback: true });
  assert.equal(accepted.ok, true);
  assert.equal(captured[0].reasoningEffort, 'high');

  const refused = await service.testProvider('tenant-1', { ...input, reasoning_effort: 'max' }, { skipStoredFallback: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.message, 'AI provider request failed (HTTP 400): unknown variant `max` for reasoning_effort');
  assert.equal(captured[1].reasoningEffort, 'max');

  // No effort set: nothing is sent, as before.
  await service.testProvider('tenant-1', input, { skipStoredFallback: true });
  assert.equal(captured[2].reasoningEffort, null);
}

async function run() {
  await testUsesPersistedSecretWhenApiKeyIsOmitted();
  await testReturnsValidationErrorsWithoutCallingProvider();
  await testRejectsInternalEndpointWithoutCallingProvider();
  await testReturnsRuntimeFailureMessage();
  await testSendsTheReasoningEffortAndShowsARefusal();
}

void run();
