import * as assert from 'node:assert/strict';
import { Features } from '../../config/features';
import { AiProviderTestService } from '../ai-provider-test.service';
import { AiAgentLlmClient } from '../control-plane/agent-control/ai-agent-llm-client';
import { PlatformAiAdminController } from '../platform/platform-ai-admin.controller';

// Who set a provider endpoint decides how it is reached: an endpoint marked
// `platform` (the built-in provider, configured by the platform operator) is used
// as configured; any other is checked and bound to its validated addresses. Only
// the built-in source and the platform test route mark an endpoint `platform`.
// The provider tests read the first event, then close the stream, on success and
// on error. (The chat orchestrator is covered in ai-chat-orchestrator.service.spec.ts.)

// The tenant endpoints below use the loopback address, allowlisted as an address
// so that the request-time check passes without a DNS lookup.
process.env.SSRF_ALLOWED_HOSTS = '127.0.0.1';
const TENANT_ENDPOINT = 'http://127.0.0.1:9/v1';
const PLATFORM_ENDPOINT = 'https://platform-llm.example.test/v1';

/** An adapter that records the stream parameters and whether the stream was closed. */
function recordingAdapter(firstEvent: Record<string, unknown> = { type: 'text_delta', text: 'ok' }) {
  const recorded = { params: [] as any[], closed: 0 };
  const adapter = {
    validateConfiguration: () => [],
    createStream(params: unknown) {
      recorded.params.push(params);
      return (async function* () {
        try {
          yield firstEvent;
          yield { type: 'done' };
        } finally {
          recorded.closed += 1;
        }
      })();
    },
  };
  return { adapter, recorded, registry: { validate: () => [], get: () => adapter, list: () => [] } };
}

async function testAgentClientMarksOnlyTheBuiltinSource() {
  for (const [source, expected] of [['builtin', 'platform'], ['registry', 'tenant']] as const) {
    const { recorded, registry } = recordingAdapter();
    const resolver = {
      tryResolve: async () => ({
        source,
        provider: 'custom',
        model: 'm',
        apiKey: 'test-key',
        endpointUrl: source === 'builtin' ? PLATFORM_ENDPOINT : TENANT_ENDPOINT,
        configId: source === 'builtin' ? null : 'model-config-1',
        supportsVision: false,
        timeoutMs: null,
        priceInputEurPerMtok: null,
        priceOutputEurPerMtok: null,
      }),
    };
    const client = new AiAgentLlmClient(resolver as any, registry as any);
    const result = await client.callJsonModel(
      { tenantId: 'tenant-1', agentId: null, manager: {} } as any,
      { systemPrompt: 'Reply with ok.', userPayload: {}, maxTokens: 16, timeoutEnvName: 'AI_ENDPOINT_SOURCE_SPEC_TIMEOUT', defaultTimeoutMs: 5_000 },
    );
    assert.equal(result?.text, 'ok');
    assert.equal(recorded.params.length, 1);
    assert.equal(recorded.params[0].endpointSource, expected, `${source} model`);
  }
}

async function testPlatformTestRoute() {
  const platformConfig = {
    getRuntimeConfig: async () => ({ provider: 'custom', model: 'm', apiKey: 'test-key', endpoint_url: PLATFORM_ENDPOINT }),
  };

  const ok = recordingAdapter();
  const controller = new PlatformAiAdminController(platformConfig as any, {} as any, ok.registry as any);
  const success = await controller.testConfig({});
  assert.equal(success.ok, true, success.message);
  assert.equal(ok.recorded.params[0].endpointSource, 'platform');
  assert.equal(ok.recorded.params[0].endpointUrl, PLATFORM_ENDPOINT);
  assert.equal(ok.recorded.closed, 1, 'platform test: the stream is closed after the first event');

  const failing = recordingAdapter({ type: 'error', message: 'model unavailable' });
  const failed = await new PlatformAiAdminController(platformConfig as any, {} as any, failing.registry as any).testConfig({});
  assert.equal(failed.ok, false);
  assert.equal(failed.message, 'model unavailable');
  assert.equal(failing.recorded.closed, 1, 'platform test error: the stream is closed after the first event');
}

async function testTenantProviderTest() {
  const input = { llm_provider: 'custom', llm_model: 'm', llm_endpoint_url: TENANT_ENDPOINT, llm_api_key: 'test-key' };
  const service = (registry: unknown) => new AiProviderTestService(
    { find: async () => null } as any,
    { decrypt: (value: string) => value } as any,
    registry as any,
  );

  const ok = recordingAdapter();
  const success = await service(ok.registry).testProvider('tenant-1', input, { skipStoredFallback: true });
  assert.equal(success.ok, true, success.message);
  assert.notEqual(ok.recorded.params[0].endpointSource, 'platform', 'a tenant endpoint is never marked platform');
  assert.equal(ok.recorded.closed, 1, 'provider test: the stream is closed after the first event');

  const failing = recordingAdapter({ type: 'error', message: 'model unavailable' });
  const failed = await service(failing.registry).testProvider('tenant-1', input, { skipStoredFallback: true });
  assert.equal(failed.ok, false);
  assert.equal(failed.message, 'model unavailable');
  assert.equal(failing.recorded.closed, 1, 'provider test error: the stream is closed after the first event');
}

async function run() {
  const originalSingleTenant = Features.SINGLE_TENANT;
  (Features as any).SINGLE_TENANT = false;
  try {
    await testAgentClientMarksOnlyTheBuiltinSource();
    await testPlatformTestRoute();
    await testTenantProviderTest();
  } finally {
    (Features as any).SINGLE_TENANT = originalSingleTenant;
  }
  console.log('ai-endpoint-source.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
