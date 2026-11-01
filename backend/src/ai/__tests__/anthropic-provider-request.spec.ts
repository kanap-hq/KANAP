import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import {
  AnthropicAiProviderAdapter,
  anthropicModelSupportsEffort,
} from '../providers/anthropic-ai-provider.adapter';
import { AiStreamEvent, AiStreamParams } from '../providers/ai-provider.types';

// The Anthropic adapter against a local stand-in server: every request turns on
// automatic prompt caching, ends a breakpoint after the fixed part of the system prompt, sends the reasoning effort only to models that accept it,
// and reports input_tokens as the whole prompt (uncached + cache write + cache read).

// The stand-in server listens on 127.0.0.1, which the request-time check blocks in
// multi-tenant mode.
process.env.SSRF_ALLOWED_HOSTS = '127.0.0.1';

const bodies: Array<Record<string, unknown>> = [];

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const STREAM = [
  sse('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [],
      stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000 },
    },
  }),
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }),
  sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
  sse('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 5 },
  }),
  sse('message_stop', { type: 'message_stop' }),
].join('');

function startServer(): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(STREAM);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function run(params: Partial<AiStreamParams>): Promise<AiStreamEvent[]> {
  const adapter = new AnthropicAiProviderAdapter();
  const events: AiStreamEvent[] = [];
  for await (const event of adapter.createStream({
    model: 'claude-opus-5-5',
    apiKey: 'test-key',
    endpointUrl: null,
    systemPrompt: 'You are a test.',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    maxTokens: 100,
    maxRetries: 0,
    ...params,
  })) {
    events.push(event);
  }
  return events;
}

function testEffortModelGate() {
  for (const model of [
    'claude-opus-5-5', 'claude-opus-4-5', 'claude-opus-4-5-20251101', 'claude-sonnet-4-6',
    'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'anthropic.claude-opus-4-8',
  ]) {
    assert.equal(anthropicModelSupportsEffort(model), true, model);
  }
  for (const model of [
    'claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-20250514', 'claude-opus-4-1',
    'claude-opus-4-20250514', 'claude-3-5-sonnet-latest', 'some-other-model',
  ]) {
    assert.equal(anthropicModelSupportsEffort(model), false, model);
  }
}

async function main() {
  testEffortModelGate();

  const { server, base } = await startServer();
  const previousBaseUrl = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = base;
  try {
    const events = await run({ reasoningEffort: 'low' });
    const body = bodies.at(-1)!;
    assert.deepEqual(body.cache_control, { type: 'ephemeral' });
    assert.deepEqual(body.output_config, { effort: 'low' });
    const done = events.find((event) => event.type === 'done');
    assert.ok(done && done.type === 'done');
    assert.deepEqual(done.usage, {
      input_tokens: 3210,
      output_tokens: 5,
      cache_read_input_tokens: 3000,
      cache_write_input_tokens: 200,
    });

    // The values above high go out as set, for the models that take the field.
    for (const [model, effort] of [
      ['claude-opus-5-5', 'max'],
      ['claude-sonnet-5-5', 'xhigh'],
      ['claude-haiku-5-5', 'max'],
    ] as const) {
      await run({ model, reasoningEffort: effort });
      assert.deepEqual(bodies.at(-1)!.output_config, { effort }, `${model} ${effort}`);
    }

    await run({ reasoningEffort: null });
    assert.deepEqual(bodies.at(-1)!.cache_control, { type: 'ephemeral' });
    assert.equal('output_config' in bodies.at(-1)!, false);

    await run({ model: 'claude-haiku-4-5', reasoningEffort: 'low' });
    assert.deepEqual(bodies.at(-1)!.cache_control, { type: 'ephemeral' });
    assert.equal('output_config' in bodies.at(-1)!, false);

    // A level the model does not accept is not sent either (Sonnet 4.6 has no xhigh).
    await run({ model: 'claude-sonnet-4-6', reasoningEffort: 'xhigh' });
    assert.equal('output_config' in bodies.at(-1)!, false);

    // No cacheable prefix: the system prompt as it is, cached by the automatic breakpoint only.
    assert.equal(bodies.at(-1)!.system, 'You are a test.');

    // Tools, then the fixed part of the system prompt with its own breakpoint, then the person
    // and the clock, then the history under the automatic breakpoint: two breakpoints of four.
    await run({
      systemPrompt: 'Fixed rules.\n\nTenant and current user context: Alex, 20:41.',
      systemPromptCacheablePrefix: 'Fixed rules.',
      tools: [{ name: 'query_entities', description: 'Query.', parameters: { type: 'object', properties: {} } }],
    });
    const cached = bodies.at(-1)!;
    assert.deepEqual(cached.system, [
      { type: 'text', text: 'Fixed rules.', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Tenant and current user context: Alex, 20:41.' },
    ]);
    assert.deepEqual(cached.cache_control, { type: 'ephemeral' });
    assert.deepEqual((cached.tools as any[]).map((tool) => tool.name), ['query_entities']);
    assert.equal(JSON.stringify(cached.tools).includes('cache_control'), false, 'the system breakpoint covers the tools');
    assert.equal(JSON.stringify(cached.messages).includes('cache_control'), false, 'the automatic breakpoint places itself');

    // A prefix the prompt does not start with is ignored, never sent as a second copy.
    await run({ systemPrompt: 'Other prompt.', systemPromptCacheablePrefix: 'Fixed rules.' });
    assert.equal(bodies.at(-1)!.system, 'Other prompt.');

    // A prompt that is all prefix: one block, with the breakpoint.
    await run({ systemPrompt: 'Fixed rules.', systemPromptCacheablePrefix: 'Fixed rules.' });
    assert.deepEqual(bodies.at(-1)!.system, [
      { type: 'text', text: 'Fixed rules.', cache_control: { type: 'ephemeral' } },
    ]);
  } finally {
    if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previousBaseUrl;
    server.close();
  }
  console.log('anthropic-provider-request.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
