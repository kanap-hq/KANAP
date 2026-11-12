import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AiModelConfigsController } from '../ai-model-configs.controller';
import { AiProviderTestService, MODEL_KEY_NEEDED_FOR_ADDRESS } from '../ai-provider-test.service';
import { AiProviderAdapter } from '../providers/ai-provider.types';

// « Test » in the model dialog tests what is on screen: the provider, model, address
// and key of the draft, saved or not. The saved key goes only to the destination it was
// saved for: a new address without a typed key is refused before any call, as on save.

// The spec's provider hosts are allowlisted, so the request-time address check
// does not resolve them.
process.env.SSRF_ALLOWED_HOSTS = 'api.mistral.ai,ai.example.com,ollama.example.com';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const MODEL_ID = '00000000-0000-4000-8000-0000000000aa';

const STORED = {
  id: MODEL_ID,
  provider: 'openai',
  model: 'mistral-medium-latest',
  endpoint_url: 'https://api.mistral.ai/v1',
  api_key_encrypted: 'enc:saved-key',
  reasoning_effort: null,
};

function adapter(id: any, requiresApiKey: boolean, calls: any[]): AiProviderAdapter {
  return {
    descriptor: {
      id,
      label: id,
      description: id,
      capabilities: { supportsStreaming: true, supportsToolCalling: true, requiresApiKey, allowsCustomEndpoint: true },
    },
    validateConfiguration: (snapshot) => (requiresApiKey && !snapshot.has_llm_api_key ? ['API key is required.'] : []),
    createStream: async function* (params) {
      calls.push(params);
      yield { type: 'done' } as any;
    },
  };
}

function controller(stored: Record<string, unknown> | null) {
  const calls: any[] = [];
  const adapters: Record<string, AiProviderAdapter> = {
    openai: adapter('openai', true, calls),
    ollama: adapter('ollama', false, calls),
  };
  const registry = {
    get: (id: string | null) => (id ? adapters[id] ?? null : null),
    validate: (snapshot: any) => adapters[snapshot.llm_provider]?.validateConfiguration(snapshot) ?? ['Provider is required.'],
  };
  const cipher = { decrypt: (value: string) => value.replace(/^enc:/, ''), canEncrypt: () => true };
  const providerTest = new AiProviderTestService({ find: async () => null } as any, cipher as any, registry as any);
  const instance = new AiModelConfigsController(
    { run: async (_tenantId: string, fn: (manager: unknown) => unknown) => fn({}) } as any,
    { assertSettingsAccess: async () => undefined } as any,
    {
      getById: async (_tenantId: string, id: string) => {
        assert.equal(id, MODEL_ID);
        if (!stored) throw new Error('not found');
        return stored;
      },
    } as any,
    providerTest,
    cipher as any,
  );
  const req = { tenant: { id: TENANT_ID }, user: { sub: 'user-1' } } as any;
  return { instance, calls, req };
}

async function testUnsavedValuesAreTested() {
  const { instance, calls, req } = controller(STORED);
  const result = await instance.test(MODEL_ID, { model: 'mistral-large-latest', reasoning_effort: 'high' }, req);
  assert.equal(result.ok, true, result.message);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'mistral-large-latest', 'the model typed is the one tested');
  assert.equal(calls[0].endpointUrl, 'https://api.mistral.ai/v1');
  assert.equal(calls[0].apiKey, 'saved-key', 'the saved key goes to its own address');
}

async function testAnotherSpellingKeepsTheSavedKey() {
  const { instance, calls, req } = controller(STORED);
  const result = await instance.test(MODEL_ID, { endpoint_url: 'https://API.mistral.ai/v1/' }, req);
  assert.equal(result.ok, true, result.message);
  assert.equal(calls[0].apiKey, 'saved-key');
}

async function testNewAddressWithoutKeyIsRefused() {
  const { instance, calls, req } = controller(STORED);
  const result = await instance.test(MODEL_ID, { endpoint_url: 'https://ai.example.com/v1', api_key: '  ' }, req);
  assert.equal(result.ok, false);
  assert.equal(result.message, MODEL_KEY_NEEDED_FOR_ADDRESS);
  assert.equal(calls.length, 0, 'nothing is sent, the saved key least of all');

  const otherProvider = await instance.test(MODEL_ID, { provider: 'ollama', endpoint_url: 'https://api.mistral.ai/v1' }, req);
  assert.equal(otherProvider.ok, true, 'a provider that needs no key runs without one');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, null, 'the saved key does not follow a change of provider');
}

async function testNewAddressWithTypedKey() {
  const { instance, calls, req } = controller(STORED);
  const result = await instance.test(MODEL_ID, { endpoint_url: 'https://ai.example.com/v1', api_key: 'typed-key' }, req);
  assert.equal(result.ok, true, result.message);
  assert.equal(calls[0].endpointUrl, 'https://ai.example.com/v1');
  assert.equal(calls[0].apiKey, 'typed-key');
}

async function testNewEntryIsTestedBeforeItIsSaved() {
  const { instance, calls, req } = controller(null);
  const result = await instance.test(undefined, {
    provider: 'openai',
    model: 'gpt-5-mini',
    endpoint_url: 'https://ai.example.com/v1',
    api_key: 'typed-key',
  }, req);
  assert.equal(result.ok, true, result.message);
  assert.equal(calls[0].model, 'gpt-5-mini');
  assert.equal(calls[0].apiKey, 'typed-key');

  const withoutKey = await instance.test(undefined, { provider: 'openai', model: 'gpt-5-mini' }, req);
  assert.equal(withoutKey.ok, false);
  assert.deepEqual(withoutKey.validation_errors, ['API key is required.']);
  assert.equal(calls.length, 1);
}

// The body goes through the global validation pipe with the type the route declares:
// a union type would be emitted as Object and skip every check of the DTO.
async function testTheBodyIsValidated() {
  const types = Reflect.getMetadata('design:paramtypes', AiModelConfigsController.prototype, 'test');
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = { type: 'body' as const, metatype: types[1], data: '' };
  for (const body of [{ provider: 'unknown' }, { endpoint_url: 'not an address' }, { model: 'x'.repeat(101) }, { reasoning_effort: 'extreme' }]) {
    await assert.rejects(pipe.transform(body, meta), BadRequestException, JSON.stringify(body));
  }
  const cleaned = await pipe.transform({ model: 'mistral-large-latest', extra: 'dropped' }, meta);
  assert.equal(cleaned.model, 'mistral-large-latest');
  assert.equal('extra' in cleaned, false, 'unknown fields are stripped');
  await pipe.transform(undefined, meta);
}

async function run() {
  await testTheBodyIsValidated();
  await testUnsavedValuesAreTested();
  await testAnotherSpellingKeepsTheSavedKey();
  await testNewAddressWithoutKeyIsRefused();
  await testNewAddressWithTypedKey();
  await testNewEntryIsTestedBeforeItIsSaved();
  console.log('ai-model-draft-test.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
