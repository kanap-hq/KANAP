import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AiAdminOverviewController } from '../ai-admin-overview.controller';
import { AiApiKeysController } from '../ai-api-keys.controller';
import { AiCapabilitiesController } from '../ai-capabilities.controller';
import { AiChatController } from '../ai-chat.controller';
import { AiConversationsController } from '../ai-conversations.controller';
import { AiMcpController } from '../ai-mcp.controller';
import { AiSettingsController } from '../ai-settings.controller';
import { AiMcpRateLimiter } from '../control-plane/mcp/ai-mcp-rate-limiter.service';
import {
  MCP_SCOPE_TOOLS_EXECUTE,
  MCP_SCOPE_TOOLS_LIST,
  parseMcpApiKeyPolicy,
} from '../control-plane/mcp/ai-mcp-access-policy';

const TEST_TENANT_ID = '11111111-1111-4111-8111-111111111111';

function createRequest(overrides?: Record<string, unknown>) {
  return {
    tenant: { id: TEST_TENANT_ID },
    user: { sub: 'user-1', aiApiKeyId: 'key-1' },
    id: 'req-1',
    isPlatformHost: true,
    ...overrides,
  };
}

function createResponseRecorder() {
  const state = {
    headers: [] as Array<[string, string]>,
    flushed: false,
    writes: [] as string[],
    ended: false,
  };

  return {
    state,
    response: {
      setHeader: (name: string, value: string) => {
        state.headers.push([name, value]);
      },
      flushHeaders: () => {
        state.flushed = true;
      },
      write: (value: string) => {
        state.writes.push(value);
      },
      end: () => {
        state.ended = true;
      },
    } as any,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function assertBaseContext(context: any, expected: { surface: 'chat' | 'mcp'; authMethod: 'jwt' | 'api_key'; aiApiKeyId: string | null }) {
  assert.equal(context.tenantId, TEST_TENANT_ID);
  assert.equal(context.userId, 'user-1');
  assert.equal(context.isPlatformHost, true);
  assert.equal(context.surface, expected.surface);
  assert.equal(context.authMethod, expected.authMethod);
  assert.equal(context.requestId, 'req-1');
  assert.equal(context.aiApiKeyId, expected.aiApiKeyId);
}

function createMcpApiKey(overrides?: Record<string, unknown>) {
  return {
    id: 'key-1',
    tenant_id: TEST_TENANT_ID,
    user_id: 'user-1',
    mcp_scopes: [MCP_SCOPE_TOOLS_LIST, MCP_SCOPE_TOOLS_EXECUTE],
    mcp_allowed_capabilities: ['kanap.read.core'],
    mcp_denied_capabilities: [],
    mcp_max_effect: 'read',
    mcp_rate_limit_per_minute: 60,
    ...(overrides ?? {}),
  };
}

function createMcpPostRequest(body: unknown, apiKey = createMcpApiKey()) {
  return createRequest({
    body,
    aiApiKey: apiKey,
  });
}

function parseTestMcpPolicy(apiKey: any) {
  return parseMcpApiKeyPolicy({
    mcp_scopes_json: apiKey.mcp_scopes_json ?? apiKey.mcp_scopes,
    mcp_capability_allowlist_json: apiKey.mcp_capability_allowlist_json ?? apiKey.mcp_allowed_capabilities,
    mcp_capability_denylist_json: apiKey.mcp_capability_denylist_json ?? apiKey.mcp_denied_capabilities,
    mcp_max_effect: apiKey.mcp_max_effect,
    mcp_rate_limit_per_minute: apiKey.mcp_rate_limit_per_minute,
  });
}

function createMcpControllerHarness(options?: {
  rateLimiter?: any;
  assertPostAccess?: (ctx: any, apiKey: any) => Promise<void>;
}) {
  const rateCalls: Array<{ tenantId: string; apiKeyId: string | null | undefined; limit: number }> = [];
  const exposureCalls = { post: 0, list: 0, execute: 0 };
  const rateLimiter = options?.rateLimiter ?? {
    assertAllowed: (tenantId: string, apiKeyId: string | null | undefined, limit: number) => {
      rateCalls.push({ tenantId, apiKeyId, limit });
    },
  };
  const controller = new AiMcpController(
    {} as any,
    {
      parsePolicy: parseTestMcpPolicy,
      assertPostAccess: async (ctx: any, apiKey: any) => {
        exposureCalls.post += 1;
        await options?.assertPostAccess?.(ctx, apiKey);
      },
      listToolJsonSchemas: async () => {
        exposureCalls.list += 1;
        return [];
      },
      assertCanExecute: async () => {
        exposureCalls.execute += 1;
        return {};
      },
      assertCanReadAudit: async (ctx: any, apiKey: any) => parseTestMcpPolicy(apiKey),
    } as any,
    {} as any,
    rateLimiter,
    {
      runWithContext: async (context: any, fn: Function) => fn({ ...context, manager: { tag: 'manager' } }),
    } as any,
    {
      get: async () => ({}),
      getEffectiveProviderSource: () => 'custom',
    } as any,
    { tryResolve: async () => ({ source: 'registry' }) } as any,
    {} as any,
    {} as any,
  );
  return { controller, exposureCalls, rateCalls };
}

function runMcpPostPreflight(controller: AiMcpController, req: any) {
  const context = (controller as any).buildContext(req);
  const methods = (controller as any).mcpMethods(req.body);
  return (controller as any).assertMcpPostPreflight(context, req.aiApiKey, methods);
}

function assertMcpRateLimited(error: any) {
  const response = typeof error?.getResponse === 'function' ? error.getResponse() : null;
  assert.equal(typeof error?.getStatus === 'function' ? error.getStatus() : null, 429);
  assert.equal(response?.code, 'MCP_RATE_LIMITED');
  return true;
}

function createInitializeRequest(id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    },
  };
}

async function testControllersBuildPlatformAwareContexts() {
  const req = createRequest();

  const chat = new AiChatController({} as any, {} as any, {} as any, {} as any);
  assertBaseContext((chat as any).buildContext(req), {
    surface: 'chat',
    authMethod: 'jwt',
    aiApiKeyId: null,
  });

  const capabilities = new AiCapabilitiesController({} as any, {} as any);
  assertBaseContext((capabilities as any).buildContext(req), {
    surface: 'chat',
    authMethod: 'jwt',
    aiApiKeyId: null,
  });

  const conversations = new AiConversationsController({} as any, {} as any, {} as any, {} as any, {} as any);
  assertBaseContext((conversations as any).buildContext(req), {
    surface: 'chat',
    authMethod: 'jwt',
    aiApiKeyId: null,
  });

  const apiKeys = new AiApiKeysController({} as any, {} as any, {} as any, {} as any);
  assertBaseContext((apiKeys as any).buildContext(req), {
    surface: 'mcp',
    authMethod: 'jwt',
    aiApiKeyId: null,
  });

  const settings = new AiSettingsController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  assertBaseContext((settings as any).buildContext(req), {
    surface: 'chat',
    authMethod: 'jwt',
    aiApiKeyId: null,
  });

  const mcp = new AiMcpController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  assertBaseContext((mcp as any).buildContext(req), {
    surface: 'mcp',
    authMethod: 'api_key',
    aiApiKeyId: 'key-1',
  });
}

async function testControllersRejectMissingTenantContext() {
  const req = createRequest({ tenant: undefined });
  const settings = new AiSettingsController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const mcp = new AiMcpController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

  assert.throws(
    () => (settings as any).buildContext(req),
    (error: unknown) => error instanceof UnauthorizedException,
  );
  assert.throws(
    () => (mcp as any).buildContext(req),
    (error: unknown) => error instanceof UnauthorizedException,
  );
}

async function testControllersRejectInvalidTenantContext() {
  const req = createRequest({ tenant: { id: 'tenant-1' } });
  const settings = new AiSettingsController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const overview = new AiAdminOverviewController({} as any, {} as any, {} as any);
  const mcp = new AiMcpController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

  assert.throws(
    () => (settings as any).buildContext(req),
    (error: unknown) => error instanceof UnauthorizedException,
  );
  assert.throws(
    () => (overview as any).buildContext(req),
    (error: unknown) => error instanceof ForbiddenException,
  );
  assert.throws(
    () => (mcp as any).buildContext(req),
    (error: unknown) => error instanceof UnauthorizedException,
  );
}

async function testMcpPostRejectsMixedListAndCallBatchBeforeExposure() {
  const { controller, exposureCalls, rateCalls } = createMcpControllerHarness();
  const req = createMcpPostRequest(
    [
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'search_all', arguments: { query: 'kanap' } },
      },
    ],
    createMcpApiKey({ mcp_scopes: [MCP_SCOPE_TOOLS_EXECUTE] }),
  );

  await assert.rejects(
    () => controller.handlePost(req as any, {} as any),
    (error: unknown) => error instanceof BadRequestException,
  );
  assert.equal(rateCalls.length, 1);
  assert.equal(rateCalls[0].tenantId, TEST_TENANT_ID);
  assert.equal(rateCalls[0].apiKeyId, 'key-1');
  assert.equal(exposureCalls.list, 0);
}

async function testMcpPostRatesMissingScopeListAndCallAttemptsBeforeExposure() {
  const { controller, exposureCalls, rateCalls } = createMcpControllerHarness();

  await assert.rejects(
    () => controller.handlePost(
      createMcpPostRequest(
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        createMcpApiKey({ mcp_scopes: [MCP_SCOPE_TOOLS_EXECUTE] }),
      ) as any,
      {} as any,
    ),
    (error: unknown) => error instanceof ForbiddenException,
  );
  await assert.rejects(
    () => controller.handlePost(
      createMcpPostRequest(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'search_all', arguments: { query: 'kanap' } },
        },
        createMcpApiKey({ mcp_scopes: [MCP_SCOPE_TOOLS_LIST] }),
      ) as any,
      {} as any,
    ),
    (error: unknown) => error instanceof ForbiddenException,
  );

  assert.equal(rateCalls.length, 2);
  assert.equal(exposureCalls.list, 0);
}

function testMcpPostRateLimitsRepeatedInitializeAndBogusAttempts() {
  const limiter = new AiMcpRateLimiter();
  const { controller } = createMcpControllerHarness({ rateLimiter: limiter });
  const apiKey = createMcpApiKey({ mcp_rate_limit_per_minute: 1 });

  runMcpPostPreflight(
    controller,
    createMcpPostRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
    }, apiKey),
  );
  assert.throws(
    () => runMcpPostPreflight(controller, createMcpPostRequest({ bogus: true }, apiKey)),
    assertMcpRateLimited,
  );
}

async function testMcpPostRateLimitsUnknownAndHiddenToolCallsBeforeExposure() {
  const limiter = new AiMcpRateLimiter();
  const { controller, exposureCalls } = createMcpControllerHarness({ rateLimiter: limiter });
  const apiKey = createMcpApiKey({
    mcp_scopes: [MCP_SCOPE_TOOLS_EXECUTE],
    mcp_rate_limit_per_minute: 1,
  });

  runMcpPostPreflight(
    controller,
    createMcpPostRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'unknown.tool', arguments: {} },
    }, apiKey),
  );
  await assert.rejects(
    () => controller.handlePost(
      createMcpPostRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'ticketing.ticket.internal_note.add_approved', arguments: { action_request_id: 'act-1' } },
      }, apiKey) as any,
      {} as any,
    ),
    assertMcpRateLimited,
  );
  assert.equal(exposureCalls.list, 0);
}

async function testMcpPostInitializeRequiresTenantMcpEnabled() {
  const { controller, exposureCalls, rateCalls } = createMcpControllerHarness({
    assertPostAccess: async () => {
      throw new ForbiddenException('AI MCP access is disabled for this tenant.');
    },
  });

  await assert.rejects(
    () => controller.handlePost(
      createMcpPostRequest(createInitializeRequest()) as any,
      {} as any,
    ),
    /AI MCP access is disabled/,
  );
  assert.equal(rateCalls.length, 1);
  assert.equal(exposureCalls.post, 1);
  assert.equal(exposureCalls.list, 0);
}

async function testMcpPostInitializeRequiresKeyOwnerMcpPermission() {
  const { controller, exposureCalls, rateCalls } = createMcpControllerHarness({
    assertPostAccess: async (ctx: any) => {
      assert.equal(ctx.userId, 'user-1');
      throw new ForbiddenException('Missing required permission ai_mcp:reader.');
    },
  });

  await assert.rejects(
    () => controller.handlePost(
      createMcpPostRequest(createInitializeRequest()) as any,
      {} as any,
    ),
    /Missing required permission ai_mcp:reader/,
  );
  assert.equal(rateCalls.length, 1);
  assert.equal(exposureCalls.post, 1);
  assert.equal(exposureCalls.list, 0);
}

async function testSettingsControllerDelegatesProviderTest() {
  let captured: any = null;
  const controller = new AiSettingsController(
    {
      run: async (_tenantId: string, fn: Function) => fn({ tag: 'manager' }),
    } as any,
    {
      assertSettingsAccess: async () => undefined,
    } as any,
    {
      toView: () => ({ ok: true }),
    } as any,
    {
      testProvider: async (tenantId: string, body: any, opts: any) => {
        captured = { tenantId, body, opts };
        return {
          ok: true,
          provider: 'openai',
          model: 'gpt-4o-mini',
          latency_ms: 12,
          message: 'Provider test succeeded.',
          validation_errors: [],
        };
      },
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const result = await controller.testProvider(
    {
      llm_provider: 'openai',
      llm_model: 'gpt-4o-mini',
      llm_api_key: '',
    },
    createRequest() as any,
  );

  assert.equal(result.ok, true);
  assert.equal(captured.tenantId, '11111111-1111-4111-8111-111111111111');
  assert.equal(captured.body.llm_provider, 'openai');
  assert.equal(captured.opts.manager.tag, 'manager');
}

async function testSettingsControllerDelegatesGlpiTest() {
  let captured: any = null;
  const controller = new AiSettingsController(
    {
      run: async (_tenantId: string, fn: Function) => fn({ tag: 'manager' }),
    } as any,
    {
      assertSettingsAccess: async () => undefined,
    } as any,
    {
      toView: () => ({ ok: true }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {
      testConnection: async (tenantId: string, body: any, manager: any) => {
        captured = { tenantId, body, manager };
        return {
          ok: true,
          message: 'GLPI connection succeeded.',
          latency_ms: 23,
        };
      },
    } as any,
    {} as any,
  );

  const result = await controller.testGlpi(
    {
      glpi_url: 'https://glpi.internal',
      glpi_user_token: 'secret',
      glpi_app_token: 'app-secret',
    },
    createRequest() as any,
  );

  assert.equal(result.ok, true);
  assert.equal(captured.tenantId, '11111111-1111-4111-8111-111111111111');
  assert.equal(captured.body.glpi_url, 'https://glpi.internal');
  assert.equal(captured.manager.tag, 'manager');
}

async function testChatControllerRejectsPlatformHostBeforeStreaming() {
  let capturedContext: any = null;
  const controller = new AiChatController(
    {
      prepareRequest: async (params: any) => {
        capturedContext = params.context;
        if (params.context.isPlatformHost) {
          throw new ForbiddenException('AI is not available on the platform host.');
        }
        return { providerSource: 'custom' };
      },
    } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const { response, state } = createResponseRecorder();

  await assert.rejects(
    () => controller.stream(
      { message: 'hello' },
      createRequest({ on: () => undefined }) as any,
      response,
    ),
    (error: unknown) => error instanceof ForbiddenException,
  );

  assert.equal(capturedContext?.isPlatformHost, true);
  assert.equal(state.flushed, false);
  assert.equal(state.ended, false);
  assert.deepEqual(state.headers, []);
}

async function testChatControllerStreamsForTenantHost() {
  let capturedContext: any = null;
  const controller = new AiChatController(
    {
      prepareRequest: async (params: any) => {
        capturedContext = params.context;
        return { providerSource: 'custom' };
      },
      streamPrepared: async function* () {
        yield { type: 'conversation', id: 'conv-1', title: 'Hello' };
        yield { type: 'done' };
      },
    } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const { response, state } = createResponseRecorder();
  const req = Object.assign(new EventEmitter(), createRequest({ isPlatformHost: false }));

  await controller.stream(
    { message: 'hello' },
    req as any,
    response,
  );

  assert.equal(capturedContext?.isPlatformHost, false);
  assert.equal(state.flushed, true);
  assert.equal(state.ended, true);
  assert.equal(state.writes.length, 2);
}

async function testChatControllerAbortsOnDisconnect() {
  // Held on an object so the control-flow analysis of the local variable cannot
  // hide the assignment made from inside the stream generator.
  const captured: { signal: AbortSignal | null } = { signal: null };
  const controller = new AiChatController(
    {
      prepareRequest: async () => ({ providerSource: 'custom' }),
      streamPrepared: async function* (_prepared: any, opts: any) {
        captured.signal = opts.signal ?? null;
        yield { type: 'text_delta', text: 'chunk-1' };
        while (!(opts.signal?.aborted)) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      },
    } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const { response, state } = createResponseRecorder();
  const req = Object.assign(new EventEmitter(), createRequest({ isPlatformHost: false }));

  const streamPromise = controller.stream(
    { message: 'hello' },
    req as any,
    response,
  );

  await waitFor(() => state.writes.length > 0);
  req.emit('close');

  await streamPromise;

  assert.equal(captured.signal?.aborted, true);
  assert.equal(state.writes.length, 1);
  assert.equal(state.ended, false);
}

async function testAdminOverviewControllerBuildsContextAndCallsService() {
  let capturedContext: any = null;
  let capturedTenantId: string | null = null;

  const controller = new AiAdminOverviewController(
    {
      run: async (tenantId: string, fn: Function) => {
        capturedTenantId = tenantId;
        return fn({ tag: 'manager' });
      },
    } as any,
    {
      assertSettingsAccess: async (context: any) => {
        capturedContext = context;
      },
    } as any,
    {
      getOverview: async (tenantId: string, manager: any) => ({
        tenant_id: tenantId,
        manager_tag: manager.tag,
      }),
    } as any,
  );

  const result: any = await controller.getOverview(createRequest() as any);

  assert.equal(capturedTenantId, '11111111-1111-4111-8111-111111111111');
  assert.equal(capturedContext?.surface, 'chat');
  assert.equal(capturedContext?.authMethod, 'jwt');
  assert.equal(result.tenant_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(result.manager_tag, 'manager');
}

async function testAdminOverviewControllerRejectsMissingTenantContext() {
  const controller = new AiAdminOverviewController({} as any, {} as any, {} as any);

  await assert.rejects(
    () => controller.getOverview(createRequest({ tenant: null }) as any),
    (error: unknown) => error instanceof ForbiddenException,
  );
}

async function testConversationsControllerReturnsMessagesWithConversationUsage() {
  let capturedContext: any = null;
  let checkedConversation = false;

  const controller = new AiConversationsController(
    {
      runWithContext: async (context: any, fn: Function) => {
        capturedContext = context;
        return fn({ ...context, manager: { tag: 'manager' } });
      },
    } as any,
    {
      assertSurfaceAccess: async () => undefined,
    } as any,
    {
      getConversationForUser: async () => {
        checkedConversation = true;
        return { id: 'conv-1' };
      },
      listMessagesForConversation: async () => [
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Hello',
          tool_calls: null,
          usage_json: { input_tokens: 3, output_tokens: 5 },
          created_at: new Date('2026-03-24T10:00:00.000Z'),
        },
      ],
      getConversationUsage: async () => ({
        input_tokens: 30,
        output_tokens: 50,
      }),
    } as any,
    {} as any,
    {
      listAttachmentsForMessages: async () => [],
    } as any,
  );

  const result = await controller.getMessages('conv-1', createRequest({ isPlatformHost: false }) as any);

  assert.equal(capturedContext?.surface, 'chat');
  assert.equal(checkedConversation, true);
  assert.deepEqual(result, {
    messages: [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'Hello',
        tool_calls: null,
        usage_json: { input_tokens: 3, output_tokens: 5 },
        created_at: '2026-03-24T10:00:00.000Z',
        attachments: [],
      },
    ],
    conversation_usage: {
      input_tokens: 30,
      output_tokens: 50,
    },
  });
}

async function run() {
  await testControllersBuildPlatformAwareContexts();
  await testControllersRejectMissingTenantContext();
  await testControllersRejectInvalidTenantContext();
  await testMcpPostRejectsMixedListAndCallBatchBeforeExposure();
  await testMcpPostRatesMissingScopeListAndCallAttemptsBeforeExposure();
  testMcpPostRateLimitsRepeatedInitializeAndBogusAttempts();
  await testMcpPostRateLimitsUnknownAndHiddenToolCallsBeforeExposure();
  await testMcpPostInitializeRequiresTenantMcpEnabled();
  await testMcpPostInitializeRequiresKeyOwnerMcpPermission();
  await testSettingsControllerDelegatesProviderTest();
  await testSettingsControllerDelegatesGlpiTest();
  await testChatControllerRejectsPlatformHostBeforeStreaming();
  await testChatControllerStreamsForTenantHost();
  await testChatControllerAbortsOnDisconnect();
  await testAdminOverviewControllerBuildsContextAndCallsService();
  await testAdminOverviewControllerRejectsMissingTenantContext();
  await testConversationsControllerReturnsMessagesWithConversationUsage();
}

void run();
