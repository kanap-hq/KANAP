import * as assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import * as express from 'express';
import { BadRequestException, HttpException } from '@nestjs/common';
import { AiMcpController, internalToolErrorMessage } from '../ai-mcp.controller';
import { APP_VERSION } from '../../config/version';
import { parseMcpApiKeyPolicy } from '../control-plane/mcp/ai-mcp-access-policy';
import { AiMcpCallRecord } from '../control-plane/mcp/ai-mcp-audit.service';
import { AiMcpExposureService } from '../control-plane/mcp/ai-mcp-exposure.service';
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

// What KANAP declares (ai-capability.registry.ts describeRegisteredCapability): the refusals of
// tools/call come from the real AiMcpExposureService.explainRefusal on these.
const DECLARED: Record<string, { reads: boolean; mcpReadable: boolean }> = {
  search_all: { reads: true, mcpReadable: true },
  query_entities: { reads: true, mcpReadable: true },
  get_entity_comments: { reads: true, mcpReadable: true },
  web_search: { reads: true, mcpReadable: true },
  prepare_mutation_plan: { reads: false, mcpReadable: false },
  create_business_record: { reads: false, mcpReadable: false },
};
const realExposure = new AiMcpExposureService(
  { describeRegisteredCapability: (name: string) => DECLARED[name] ?? null } as any,
  {} as any,
);

function createController(
  calls: Array<{ name: string; input: unknown }>,
  options: { rateLimiter?: any; rateLimitPerMinute?: number; journal?: AiMcpCallRecord[] } = {},
) {
  const journal = options.journal ?? [];
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
      explainRefusal: (apiKey: any, name: string) => realExposure.explainRefusal(apiKey, name),
    } as any,
    { recordCall: async (_ctx: any, record: AiMcpCallRecord) => { journal.push(record); } } as any,
    options.rateLimiter ?? { assertAllowed: () => undefined },
    {
      runWithContext: async (context: any, fn: Function) => fn({
        ...context,
        manager: { query: async () => [{ name: 'Fromage & Co', slug: 'fromage' }] },
      }),
    } as any,
  );
}

async function withServer(
  controller: AiMcpController,
  fn: (url: string) => Promise<void>,
  allowedCapabilities: string[] = ['kanap.read.core'],
) {
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
      mcp_allowed_capabilities: allowedCapabilities,
      mcp_denied_capabilities: [],
      mcp_max_effect: 'read',
      mcp_rate_limit_per_minute: 60,
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
  // The KANAP version, and what a client must know before its first call.
  assert.equal(reply.result.serverInfo.name, 'kanap-mcp');
  assert.equal(reply.result.serverInfo.version, APP_VERSION);
  assert.notEqual(reply.result.serverInfo.version, '1.0.0');
  const instructions: string = reply.result.instructions;
  // The client knows which workspace it reads before its first call.
  assert.match(instructions, /^This connection reads the KANAP workspace "Fromage & Co" \(fromage\)/);
  assert.match(instructions, /only reads/);
  assert.match(instructions, /rights of the person/);
  assert.match(instructions, /start with search_all/);
  assert.match(instructions, /describe_entity_filters[^.]*before|Before query_entities[^.]*describe_entity_filters/);
  for (const family of ['audit log', 'AI agents']) {
    assert.ok(instructions.includes(family), family);
  }
  // The reference data are read (Plaid L9): searched by search_all, the rates by query_entities only.
  assert.match(instructions, /start with search_all \(names, codes and references such as APP-4; cost centers, calendars and dimensions included\)/);
  assert.match(instructions, /Exchange rates: query_entities on exchange_rates\./);
  assert.doesNotMatch(instructions, /does not read cost centers|does not read[^.]*(calendars|exchange rates)/);
  // Roles and data access are read only for an administrator of users with access to all data.
  assert.match(instructions, /reads roles and data access settings only for a person who administers users with access to all data/);
  // The path from a search to one record (Plaid L9, lot F, m4).
  assert.match(instructions, /get_entity_detail and get_entity_context read one record\./);
  assert.ok(instructions.length < 1200, `instructions stay short (${instructions.length})`);
}

// An unknown name is a JSON-RPC -32602; a known tool this call may not run is a tool result with
// the cause (read only, key policy, web search off, missing read right). Each one is journaled.
async function testRefusalsSayWhy(url: string, journal: AiMcpCallRecord[]) {
  const call = (id: number, name: string) => rpc(url, {
    jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { query: 'SAP' } },
  });

  const unknown = await call(10, 'does_not_exist');
  assert.equal(unknown.result, undefined);
  assert.equal(unknown.error.code, -32602);
  assert.match(unknown.error.message, /^Unknown tool: does_not_exist\./);

  const cases: Array<[string, RegExp, string]> = [
    ['prepare_mutation_plan', /^This server is read only: prepare_mutation_plan changes data/, 'read_only'],
    ['create_business_record', /^This server is read only/, 'read_only'],
    ['web_search', /^Web search is turned off/, 'disabled'],
    ['get_entity_comments', /^Your KANAP role does not allow this tool/, 'permission'],
  ];
  let id = 11;
  for (const [name, text, reason] of cases) {
    const reply = await call(id++, name);
    assert.equal(reply.error, undefined, JSON.stringify(reply.error));
    assert.equal(reply.result.isError, true, name);
    assert.match(reply.result.content[0].text, text);
    assert.equal(journal.at(-1)?.reason, reason, name);
    assert.equal(journal.at(-1)?.toolName, name);
    assert.deepEqual(journal.at(-1)?.arguments, { query: 'SAP' });
  }
  assert.equal(journal.filter((line) => line.reason === 'unknown_tool').length, 1);
}

async function testKeyPolicyRefusal() {
  const calls: Array<{ name: string; input: unknown }> = [];
  const journal: AiMcpCallRecord[] = [];
  const controller = createController(calls, { journal });
  await withServer(controller, async (url) => {
    const reply = await rpc(url, {
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'query_entities', arguments: {} },
    });
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /^This key does not allow this tool: query_entities\./);
    assert.equal(journal.at(-1)?.reason, 'key_policy');
    assert.equal(calls.length, 0);
  }, ['search_all']);
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

async function testToolErrorsComeBackAsToolResults(
  url: string,
  logged: Array<{ message: string; stack?: string }>,
  journal: AiMcpCallRecord[],
) {
  const http = await rpc(url, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'search_all', arguments: { query: 'fail-http' } },
  });
  assert.equal(http.result.isError, true);
  assert.equal(http.result.content[0].text, 'No match for "PRJ-1".');
  // The request transaction rolled back the dispatcher's lines: the journal gets the refusal.
  assert.deepEqual(
    { tool: journal.at(-1)?.toolName, reason: journal.at(-1)?.reason, message: journal.at(-1)?.message },
    { tool: 'search_all', reason: 'invalid_input', message: 'No match for "PRJ-1".' },
  );

  const internal = await rpc(url, {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'search_all', arguments: { query: 'fail-internal' } },
  });
  assert.equal(internal.result.isError, true);
  const text: string = internal.result.content[0].text;
  const reference = text.match(/reference ([0-9a-f]{8}) /)?.[1];
  assert.ok(reference, text);
  assert.equal(text, internalToolErrorMessage(reference));
  // Logged once, under the same reference, with the stack; the HTTP error above is not logged.
  assert.equal(logged.length, 1);
  assert.match(logged[0].message, new RegExp(`search_all failed, reference ${reference}`));
  assert.match(logged[0].stack ?? '', /invalid input syntax for type uuid/);
  // The internal error's own message stays on the server.
  assert.doesNotMatch(text, /uuid|PRJ-1/);
  assert.equal(journal.at(-1)?.reason, 'error');
  assert.equal(journal.at(-1)?.message, text);
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
    const wait = JSON.parse(refused.text).retry_after_seconds;
    assert.ok(Number.isInteger(wait) && wait >= 1 && wait <= 60, String(wait));
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
  const journal: AiMcpCallRecord[] = [];
  const controller = createController(calls, { journal });
  const logged: Array<{ message: string; stack?: string }> = [];
  const warned: string[] = [];
  (controller as any).logger = {
    error: (message: string, stack?: string) => logged.push({ message, stack }),
    warn: (message: string) => warned.push(message),
  };
  await withServer(controller, async (url) => {
    await testInitializeAdvertisesTools(url);
    await testToolsListReturnsJsonSchemas(url);
    await testToolsCallDispatches(url, calls);
    // A completed call leaves its line through the dispatcher, not here.
    assert.equal(journal.length, 0);
    await testToolErrorsComeBackAsToolResults(url, logged, journal);
    await testRefusalsSayWhy(url, journal);
  });
  assert.deepEqual(warned, []);
  await testKeyPolicyRefusal();
  await testEachRequestCountsOnce();
  await testBatchCountsEachMessage();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
