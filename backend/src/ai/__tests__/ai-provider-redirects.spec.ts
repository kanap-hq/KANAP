import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { Features } from '../../config/features';
import { AiProviderTestService } from '../ai-provider-test.service';
import { AnthropicAiProviderAdapter } from '../providers/anthropic-ai-provider.adapter';
import { CustomAiProviderAdapter } from '../providers/custom-ai-provider.adapter';
import { openaiCompatibleStream } from '../providers/openai-stream.util';
import { describeProviderError } from '../providers/provider-http.util';

// Provider calls against a local stand-in server: a redirect is an error in
// multi-tenant mode (no request reaches the redirect target), single-tenant keeps
// following it, and error messages carry the status and the structured provider
// message, never the raw response body.

const RAW_BODY_MARKER = 'raw-body-text-7f3a';

type Mode = 'redirect' | 'html-error' | 'json-error' | 'ok';

const state: { mode: Mode; requests: string[] } = { mode: 'ok', requests: [] };

const OPENAI_SSE_OK = [
  'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"m",'
    + '"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}',
  '',
  'data: [DONE]',
  '',
  '',
].join('\n');

function startServer(): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer((req, res) => {
    const path = req.url || '/';
    state.requests.push(path);
    // Drain the request body before answering.
    req.resume();
    req.on('end', () => {
      if (path.startsWith('/target/v1/chat/completions')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(OPENAI_SSE_OK);
        return;
      }
      if (path.startsWith('/target/v1/messages')) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'redirect target reached' },
        }));
        return;
      }
      if (state.mode === 'redirect') {
        res.writeHead(307, {
          location: `/target${path}`,
          'content-type': 'text/html',
        });
        res.end(`<html><body>${RAW_BODY_MARKER}</body></html>`);
        return;
      }
      if (state.mode === 'html-error') {
        res.writeHead(502, { 'content-type': 'text/html' });
        res.end(`<html><body>${RAW_BODY_MARKER}</body></html>`);
        return;
      }
      if (state.mode === 'json-error') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          error: { message: 'The model m does not exist.', type: 'invalid_request_error' },
          debug: RAW_BODY_MARKER,
        }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(OPENAI_SSE_OK);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function collect(gen: AsyncGenerator<any>): Promise<{ events: any[]; error: unknown }> {
  const events: any[] = [];
  try {
    for await (const event of gen) events.push(event);
    return { events, error: null };
  } catch (error) {
    return { events, error };
  }
}

function reset(mode: Mode) {
  state.mode = mode;
  state.requests.length = 0;
}

function openaiParams(base: string, maxRetries?: number) {
  return {
    providerId: 'custom' as const,
    model: 'm',
    apiKey: 'test-key',
    endpointUrl: `${base}/v1`,
    systemPrompt: 'Reply with ok.',
    messages: [{ role: 'user' as const, content: 'Hello' }],
    tools: [],
    maxTokens: 16,
    timeoutMs: 5_000,
    ...(maxRetries === undefined ? {} : { maxRetries }),
  };
}

function setSingleTenant(value: boolean) {
  (Features as any).SINGLE_TENANT = value;
}

async function testMultiTenantRedirectIsAnErrorWithoutFollowUp(base: string) {
  setSingleTenant(false);
  reset('redirect');
  const { events, error } = await collect(openaiCompatibleStream(openaiParams(base)));
  assert.equal(events.length, 0);
  assert.ok(error instanceof Error, 'a redirect must surface as an error');
  const message = (error as Error).message;
  assert.match(message, /redirect/i);
  assert.match(message, /HTTP 307/);
  assert.ok(!message.includes(RAW_BODY_MARKER), 'the error must not repeat the response body');
  assert.deepEqual(state.requests, ['/v1/chat/completions'], 'only the original request is sent');
}

async function testSingleTenantRedirectIsFollowed(base: string) {
  setSingleTenant(true);
  reset('redirect');
  const { events, error } = await collect(openaiCompatibleStream(openaiParams(base)));
  assert.equal(error, null);
  assert.deepEqual(state.requests, ['/v1/chat/completions', '/target/v1/chat/completions']);
  assert.deepEqual(events.find((event) => event.type === 'text_delta'), { type: 'text_delta', text: 'ok' });
  assert.equal(events.at(-1)?.type, 'done');
}

async function testUnexpectedBodyIsNotRepeated(base: string) {
  for (const singleTenant of [false, true]) {
    setSingleTenant(singleTenant);
    reset('html-error');
    const { error } = await collect(openaiCompatibleStream(openaiParams(base, 0)));
    assert.ok(error instanceof Error);
    assert.equal((error as Error).message, 'AI provider request failed (HTTP 502).');
  }
}

async function testStructuredProviderMessageIsKept(base: string) {
  setSingleTenant(false);
  reset('json-error');
  const { error } = await collect(openaiCompatibleStream(openaiParams(base, 0)));
  assert.ok(error instanceof Error);
  assert.equal(
    (error as Error).message,
    'AI provider request failed (HTTP 404): The model m does not exist.',
  );
}

async function testAnthropicClientFollowsTheSameRule(base: string) {
  const previousBaseUrl = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = base;
  try {
    const adapter = new AnthropicAiProviderAdapter();
    const params = { ...openaiParams(base), providerId: 'anthropic' as const, endpointUrl: null };

    setSingleTenant(false);
    reset('redirect');
    const cloud = await collect(adapter.createStream(params));
    assert.ok(cloud.error instanceof Error);
    assert.match((cloud.error as Error).message, /redirect.*HTTP 307/i);
    assert.ok(!(cloud.error as Error).message.includes(RAW_BODY_MARKER));
    assert.deepEqual(state.requests, ['/v1/messages']);

    setSingleTenant(true);
    reset('redirect');
    const onPrem = await collect(adapter.createStream(params));
    assert.deepEqual(state.requests, ['/v1/messages', '/target/v1/messages']);
    assert.ok(onPrem.error instanceof Error);
    assert.equal(
      (onPrem.error as Error).message,
      'AI provider request failed (HTTP 400): redirect target reached',
    );
  } finally {
    if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previousBaseUrl;
  }
}

async function testProviderTestEndpointReportsTheRedirect(base: string) {
  const previousAllow = process.env.SSRF_ALLOWED_HOSTS;
  // The local stand-in server is private: allow it so the request-time guard lets
  // the provider call through and the redirect rule is what stops it.
  process.env.SSRF_ALLOWED_HOSTS = '127.0.0.1';
  try {
    setSingleTenant(false);
    reset('redirect');
    const adapter = new CustomAiProviderAdapter();
    const service = new AiProviderTestService(
      { find: async () => null } as any,
      { decrypt: (value: string) => value } as any,
      {
        validate: (snapshot: any) => adapter.validateConfiguration(snapshot),
        get: () => adapter,
      } as any,
    );
    const result = await service.testProvider('tenant-1', {
      llm_provider: 'custom',
      llm_model: 'm',
      llm_endpoint_url: `${base}/v1`,
      llm_api_key: 'test-key',
    }, { skipStoredFallback: true });
    assert.equal(result.ok, false);
    assert.match(result.message, /redirect.*HTTP 307/i);
    assert.ok(!result.message.includes(RAW_BODY_MARKER));
    assert.deepEqual(state.requests, ['/v1/chat/completions']);
  } finally {
    if (previousAllow === undefined) delete process.env.SSRF_ALLOWED_HOSTS;
    else process.env.SSRF_ALLOWED_HOSTS = previousAllow;
  }
}

function testDescribeProviderError() {
  // OpenAI-compatible payload kept by the SDK on `error`.
  assert.equal(
    describeProviderError({ status: 401, error: { message: 'Invalid key' } }),
    'AI provider request failed (HTTP 401): Invalid key',
  );
  // Anthropic payload: the whole body on `error`.
  assert.equal(
    describeProviderError({ status: 429, error: { type: 'error', error: { message: 'Slow down' } } }),
    'AI provider request failed (HTTP 429): Slow down',
  );
  // String error field.
  assert.equal(
    describeProviderError({ status: 404, error: 'model not found' }),
    'AI provider request failed (HTTP 404): model not found',
  );
  // A status without a structured message: the message text (raw body) is ignored.
  const withRawBody = Object.assign(new Error(`500 ${RAW_BODY_MARKER}`), { status: 500 });
  assert.equal(describeProviderError(withRawBody), 'AI provider request failed (HTTP 500).');
  // A payload without a message field is not repeated.
  assert.equal(
    describeProviderError(Object.assign(new Error(RAW_BODY_MARKER), { error: { detail: RAW_BODY_MARKER } })),
    'The AI provider returned an unexpected response.',
  );
  // Unparseable data from the provider.
  assert.equal(
    describeProviderError(new SyntaxError(`Unexpected token '<', "${RAW_BODY_MARKER}" is not valid JSON`)),
    'The AI provider returned an unexpected response.',
  );
  // Long provider messages are truncated.
  const long = describeProviderError({ status: 400, error: { message: 'x'.repeat(1000) } });
  assert.ok(long.length < 400, 'long provider messages are truncated');
  assert.ok(long.endsWith('...'));
  // Connection errors keep their own message.
  assert.equal(describeProviderError(new Error('Connection error.')), 'Connection error.');
}

async function run() {
  const originalSingleTenant = Features.SINGLE_TENANT;
  const { server, base } = await startServer();
  try {
    testDescribeProviderError();
    await testMultiTenantRedirectIsAnErrorWithoutFollowUp(base);
    await testSingleTenantRedirectIsFollowed(base);
    await testUnexpectedBodyIsNotRepeated(base);
    await testStructuredProviderMessageIsKept(base);
    await testAnthropicClientFollowsTheSameRule(base);
    await testProviderTestEndpointReportsTheRedirect(base);
  } finally {
    setSingleTenant(originalSingleTenant);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log('ai-provider-redirects.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
