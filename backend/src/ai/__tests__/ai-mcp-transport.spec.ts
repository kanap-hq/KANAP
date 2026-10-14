import * as assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import * as express from 'express';
import { BadRequestException, HttpException } from '@nestjs/common';
import { AiMcpController } from '../ai-mcp.controller';
import { parseMcpApiKeyPolicy } from '../control-plane/mcp/ai-mcp-access-policy';
import { AiMcpRateLimiter } from '../control-plane/mcp/ai-mcp-rate-limiter.service';

// Drives the real MCP SDK server and Streamable HTTP transport behind POST /ai/mcp.
// The capabilities expose plain JSON Schemas: tools/list and tools/call must accept them as they are.

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const toolSchema = {
  type: 'object',
  properties: { query: { type: 'string', minLength: 1 } },
  required: ['query'],
  additionalProperties: false,
};

function createController(
  calls: Array<{ name: string; input: unknown }>,
  options: { rateLimiter?: any; rateLimitPerMinute?: number } = {},
) {
  return new AiMcpController(
    {
      execute: async (_ctx: any, request: any) => {
        calls.push({ name: request.capabilityName, input: request.input });
        if (request.input?.query === 'fail-internal') {
          throw new Error('invalid input syntax for type uuid: "PRJ-1"');
        }
        if (request.input?.query === 'fail-http') {
          throw new BadRequestException('No match for "PRJ-1".');
        }
        return { output: { items: [{ ref: 'DOC-1' }], query: request.input.query } };
      },
    } as any,
    {
      parsePolicy: (apiKey: any) => parseMcpApiKeyPolicy({
        mcp_scopes_json: apiKey.mcp_scopes,
        mcp_capability_allowlist_json: apiKey.mcp_allowed_capabilities,
        mcp_capability_denylist_json: [],
        mcp_max_effect: 'read',
        mcp_rate_limit_per_minute: options.rateLimitPerMinute ?? 60,
      }),
      assertPostAccess: async () => undefined,
      listToolJsonSchemas: async () => [
        { name: 'search_all', description: 'Search KANAP.', parameters: toolSchema },
      ],
      assertCanExecute: async () => ({}),
    } as any,
    {} as any,
    options.rateLimiter ?? { assertAllowed: () => undefined },
    {
      runWithContext: async (context: any, fn: Function) => fn({ ...context, manager: {} }),
    } as any,
  );
}

async function withServer(controller: AiMcpController, fn: (url: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.post('/ai/mcp', (req: any, res, next) => {
    req.tenant = { id: TENANT_ID };
    req.user = { sub: USER_ID, aiApiKeyId: 'key-1' };
    req.aiApiKey = {
      id: 'key-1',
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      mcp_scopes: ['mcp:tools:list', 'mcp:tools:execute'],
      mcp_allowed_capabilities: ['kanap.read.core'],
    };
    controller.handlePost(req, res).catch(next);
  });
  app.use((error: any, _req: any, res: any, _next: any) => {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    res.status(status).json(error instanceof HttpException ? error.getResponse() : { message: String(error) });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ai/mcp`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function post(url: string, body: unknown): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

async function rpc(url: string, body: unknown): Promise<any> {
  const { status, text } = await post(url, body);
  assert.equal(status, 200, text);
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(data ? data.slice('data: '.length) : text);
}

async function testInitializeAdvertisesTools(url: string) {
  const reply = await rpc(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  assert.deepEqual(reply.result.capabilities.tools, {});
}

async function testToolsListReturnsJsonSchemas(url: string) {
  const reply = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(reply.error, undefined, JSON.stringify(reply.error));
  assert.deepEqual(reply.result.tools, [
    {
      name: 'search_all',
      title: 'Search all',
      description: 'Search KANAP.',
      inputSchema: toolSchema,
      annotations: { title: 'Search all', readOnlyHint: true },
    },
  ]);
}

async function testToolsCallDispatches(url: string, calls: Array<{ name: string; input: unknown }>) {
  const reply = await rpc(url, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'search_all', arguments: { query: 'SAP' } },
  });
  assert.equal(reply.result.isError, undefined);
  assert.deepEqual(JSON.parse(reply.result.content[0].text), { items: [{ ref: 'DOC-1' }], query: 'SAP' });
  assert.deepEqual(calls.at(-1), { name: 'search_all', input: { query: 'SAP' } });
}

async function testToolErrorsComeBackAsToolResults(url: string) {
  const http = await rpc(url, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'search_all', arguments: { query: 'fail-http' } },
  });
  assert.equal(http.result.isError, true);
  assert.equal(http.result.content[0].text, 'No match for "PRJ-1".');

  const internal = await rpc(url, {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'search_all', arguments: { query: 'fail-internal' } },
  });
  assert.equal(internal.result.isError, true);
  assert.equal(internal.result.content[0].text, 'The tool failed.');
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};

function toolCall(id: number) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'search_all', arguments: { query: 'SAP' } } };
}

// A tools/call is one request: with a limit of 3 a minute, initialize, tools/list and one call fit,
// and the next request is refused before it reaches the tool.
async function testEachRequestCountsOnce() {
  const calls: Array<{ name: string; input: unknown }> = [];
  const controller = createController(calls, { rateLimiter: new AiMcpRateLimiter(), rateLimitPerMinute: 3 });
  await withServer(controller, async (url) => {
    await rpc(url, initialize);
    await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const reply = await rpc(url, toolCall(3));
    assert.equal(reply.result.isError, undefined, JSON.stringify(reply.result));
    assert.equal(calls.length, 1);

    const refused = await post(url, toolCall(4));
    assert.equal(refused.status, 429, refused.text);
    assert.equal(JSON.parse(refused.text).code, 'MCP_RATE_LIMITED');
    assert.equal(calls.length, 1);
  });
}

// A JSON-RPC batch counts each of its messages.
async function testBatchCountsEachMessage() {
  const calls: Array<{ name: string; input: unknown }> = [];
  const controller = createController(calls, { rateLimiter: new AiMcpRateLimiter(), rateLimitPerMinute: 2 });
  await withServer(controller, async (url) => {
    const refused = await post(url, [toolCall(1), toolCall(2), toolCall(3)]);
    assert.equal(refused.status, 429, refused.text);
    assert.equal(calls.length, 0);
  });
}

async function run() {
  const calls: Array<{ name: string; input: unknown }> = [];
  await withServer(createController(calls), async (url) => {
    await testInitializeAdvertisesTools(url);
    await testToolsListReturnsJsonSchemas(url);
    await testToolsCallDispatches(url, calls);
    await testToolErrorsComeBackAsToolResults(url);
  });
  await testEachRequestCountsOnce();
  await testBatchCountsEachMessage();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
