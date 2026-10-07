import * as assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import {
  AiChatOrchestratorService,
  resolveChatProviderTimeoutMs,
  resolveProviderMaxTokens,
} from '../ai-chat-orchestrator.service';
import { estimateTokenCount } from '../ai-context-budget.helper';
import { AiSystemPromptService } from '../ai-system-prompt.service';
import { ChatStreamEvent } from '../ai.types';

function createOrchestrator(options?: {
  providerEvents?: any[];
  providerToolEvents?: any[];
  providerEventBatches?: any[][];
  toolResult?: any;
  toolResultsByName?: Record<string, any>;
  toolError?: string;
  providerContextWindow?: number | null;
  historyMessages?: any[];
  providerId?: string;
  model?: string;
  endpointUrl?: string | null;
  previewResult?: any;
  previewResults?: any[];
  followUpPreviews?: any[];
  conversationUsage?: { input_tokens: number; output_tokens: number };
  availableTools?: any[];
}) {
  const persistedMessages: any[] = [];
  let conversationCreated = false;
  let messageIndex = 0;
  const recordedRequests: any[] = [];
  const executedToolCalls: Array<{ toolName: string; input: any }> = [];
  const toolExecuteCount = { value: 0 };
  const approvalCalls = { approve: 0, reject: 0 };

  const mockTenantExecutor = {
    run: async (_tenantId: string, fn: Function, _opts?: any) => fn({} as any),
    runWithContext: async (context: any, fn: Function, _opts?: any) =>
      fn({
        ...context,
        manager: {
          query: async (sql: string) => {
            if (sql.includes('FROM tenants')) {
              return [{ name: 'Test Tenant' }];
            }
            if (sql.includes('FROM users u')) {
              return [{
                email: 'alex@example.com',
                first_name: 'Alex',
                last_name: 'Operator',
                primary_role_name: 'Administrator',
              }];
            }
            if (sql.includes('FROM user_roles')) {
              return [];
            }
            if (sql.includes('FROM portfolio_team_member_configs')) {
              return [{ team_name: 'Strategy' }];
            }
            return [];
          },
          getRepository: () => ({
            find: async () => [],
            findOne: async () => null,
            save: async (record: any) => record,
            create: (payload: any) => ({ id: `msg-${++messageIndex}`, ...payload }),
          }),
        },
      }),
  };

  const mockPolicy = {
    assertSurfaceAccess: async () => {},
    listReadableEntityTypes: async () => ['applications', 'projects'],
  };

  const mockSettings = {
    get: async () => ({
      provider_source: 'custom',
      llm_provider: options?.providerId ?? 'openai',
      llm_model: options?.model ?? 'gpt-4o',
      llm_api_key_encrypted: 'encrypted-key',
      llm_endpoint_url: options?.endpointUrl ?? null,
      chat_enabled: true,
    }),
    getEffectiveProviderSource: () => 'custom',
  };

  const mockCipher = {
    decrypt: () => 'real-api-key',
  };

  const mockResolvedModel = () => ({
    source: 'registry' as const,
    configId: 'model-config-1',
    configName: options?.model ?? 'gpt-4o',
    provider: options?.providerId ?? 'openai',
    model: options?.model ?? 'gpt-4o',
    endpointUrl: options?.endpointUrl ?? null,
    apiKey: 'real-api-key',
    supportsVision: true,
    priceInputEurPerMtok: null,
    priceOutputEurPerMtok: null,
    timeoutMs: null,
  });

  const mockModelResolver = {
    resolve: async () => mockResolvedModel(),
    tryResolve: async () => mockResolvedModel(),
    validationErrors: async () => [],
  };

  const providerCallCount = { value: 0 };

  const mockProviderRegistry = {
    get: () => ({
      descriptor: {
        id: options?.providerId ?? 'openai',
        label: 'OpenAI',
        capabilities: {
          supportsStreaming: true,
          supportsToolCalling: true,
          requiresApiKey: true,
          allowsCustomEndpoint: true,
          contextWindow: options?.providerContextWindow ?? 128000,
        },
      },
      createStream: async function* (params: any) {
        recordedRequests.push(params);
        providerCallCount.value++;
        const batch = options?.providerEventBatches?.[providerCallCount.value - 1];
        if (batch) {
          for (const event of batch) {
            yield event;
          }
          return;
        }
        // First call might return tool calls
        if (providerCallCount.value === 1 && options?.providerEvents) {
          for (const event of options.providerEvents) {
            yield event;
          }
          return;
        }
        // Second call (after tool execution) returns text
        if (providerCallCount.value === 2 && options?.providerToolEvents) {
          for (const event of options.providerToolEvents) {
            yield event;
          }
          return;
        }
        // Default: simple text response
        yield { type: 'text_delta', text: 'Hello ' };
        yield { type: 'text_delta', text: 'there!' };
        yield { type: 'done', usage: { input_tokens: 100, output_tokens: 50 } };
      },
    }),
  };

  const mockConversations = {
    createConversation: async (input: any) => {
      conversationCreated = true;
      return { id: 'conv-1', ...input };
    },
    getConversationForUser: async () => ({
      id: 'conv-1',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      title: 'Test',
    }),
    listMessagesForUser: async () => options?.historyMessages ?? [],
    getConversationUsage: async () => options?.conversationUsage ?? { input_tokens: 0, output_tokens: 0 },
    appendMessage: async (input: any) => {
      persistedMessages.push(input);
      return { id: `msg-${persistedMessages.length}`, ...input };
    },
  };

  const mockCapabilityRegistry = {
    toToolJsonSchemas: (tools: Array<{ name: string }>) => tools.map((tool) => ({
      name: tool.name,
      description: tool.name === 'search_all' ? 'Search' : `${tool.name} description`,
      parameters: { type: 'object' },
    })),
    listAvailableToolItems: async () => options?.availableTools ?? [
      { name: 'search_all', category: 'discovery', description: 'Search', input_summary: {}, read_only: true, surfaces: ['chat', 'mcp'] },
    ],
  };

  const defaultExecutedPreview = () => options?.previewResult ?? {
      preview_id: 'preview-1',
      tool_name: 'update_task_status',
      status: 'executed',
      target: { entity_type: 'tasks', entity_id: 'task-1', ref: 'T-1', title: 'Test task' },
      changes: { status: { from: 'open', to: 'done' } },
      requires_confirmation: false,
      actions: [],
      summary: 'T-1 status updated to done.',
      error_message: null,
      conversation_id: 'conv-1',
      created_at: '2026-03-24T10:00:00.000Z',
      expires_at: '2026-03-24T10:10:00.000Z',
      approved_at: '2026-03-24T10:01:00.000Z',
      rejected_at: null,
      executed_at: '2026-03-24T10:01:00.000Z',
    };
  const defaultRejectedPreview = () => options?.previewResult ?? {
      preview_id: 'preview-1',
      tool_name: 'update_task_status',
      status: 'rejected',
      target: { entity_type: 'tasks', entity_id: 'task-1', ref: 'T-1', title: 'Test task' },
      changes: { status: { from: 'open', to: 'done' } },
      requires_confirmation: false,
      actions: [],
      summary: 'Status update for T-1 was rejected.',
      error_message: null,
      conversation_id: 'conv-1',
      created_at: '2026-03-24T10:00:00.000Z',
      expires_at: '2026-03-24T10:10:00.000Z',
      approved_at: null,
      rejected_at: '2026-03-24T10:01:00.000Z',
      executed_at: null,
    };

  const mockPreviews = {
    listConversationPreviews: async () => [],
    executePreview: async () => defaultExecutedPreview(),
    executePreviews: async () => options?.previewResults ?? [defaultExecutedPreview()],
    executePreviewsWithFollowUps: async () => ({
      results: options?.previewResults ?? [defaultExecutedPreview()],
      followUpPreviews: options?.followUpPreviews ?? [],
    }),
    rejectPreview: async () => defaultRejectedPreview(),
    rejectPreviews: async () => options?.previewResults ?? [defaultRejectedPreview()],
  };

  const mockDispatcher = {
    execute: async (_ctx: any, input: any) => {
      if (input.capabilityName === 'kanap.mutation_preview.execute_approved') {
        return {
          run_id: 'run-approval',
          step_id: 'step-approval',
          tool_execution_id: 'tool-approval',
          output: {
            results: options?.previewResults ?? [defaultExecutedPreview()],
            followUpPreviews: options?.followUpPreviews ?? [],
          },
        };
      }
      toolExecuteCount.value++;
      executedToolCalls.push({ toolName: input.capabilityName, input: input.input });
      if (options?.toolError) throw new Error(options.toolError);
      if (options?.toolResultsByName && Object.prototype.hasOwnProperty.call(options.toolResultsByName, input.capabilityName)) {
        return {
          run_id: input.execution?.runId ?? 'run-1',
          step_id: 'step-1',
          tool_execution_id: 'tool-1',
          output: options.toolResultsByName[input.capabilityName],
        };
      }
      return {
        run_id: input.execution?.runId ?? 'run-1',
        step_id: 'step-1',
        tool_execution_id: 'tool-1',
        output: options?.toolResult ?? { items: [], total: 0 },
      };
    },
  };

  const mockApprovals = {
    approvePreviewsFromChat: async () => {
      approvalCalls.approve++;
      return [];
    },
    rejectPreviewsFromChat: async () => {
      approvalCalls.reject++;
      return [];
    },
  };

  const mockSystemPrompt = {
    build: () => 'You are Plaid.',
    buildWithMetadata: () => ({
      text: 'You are Plaid.',
      sections: [{ key: 'identity', label: 'Assistant identity', size: 'You are Plaid.'.length }],
    }),
  };

  const mockPlatformAiConfig = {
    getRuntimeConfig: async () => ({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'platform-key',
      endpoint_url: null,
      rate_limit_tenant_per_minute: 30,
      rate_limit_user_per_hour: 60,
    }),
  };

  const mockBuiltinUsage = {
    getCurrentUsage: async () => ({
      count: 1,
      limit: 100,
      year_month: '2026-03',
      reset_date: '2026-04-01T00:00:00.000Z',
    }),
  };

  const orchestrator = new AiChatOrchestratorService(
    mockTenantExecutor as any,
    mockPolicy as any,
    mockSettings as any,
    mockCipher as any,
    mockModelResolver as any,
    mockProviderRegistry as any,
    mockPlatformAiConfig as any,
    mockBuiltinUsage as any,
    mockConversations as any,
    mockPreviews as any,
    mockCapabilityRegistry as any,
    mockDispatcher as any,
    mockApprovals as any,
    mockSystemPrompt as any,
    {
      assertAndLoadAttachments: async () => [],
      linkAttachmentsToMessage: async () => undefined,
      listAttachmentsForMessages: async () => [],
      loadAttachmentBuffer: async () => ({ attachment: {} as any, buffer: Buffer.alloc(0) }),
    } as any,
  );

  return { orchestrator, persistedMessages, providerCallCount, recordedRequests, toolExecuteCount, executedToolCalls, approvalCalls };
}

async function collectEvents(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

async function testSimpleTextResponse() {
  const { orchestrator, persistedMessages, recordedRequests } = createOrchestrator({
    providerContextWindow: 1000,
    historyMessages: [{ role: 'user', content: 'Hello' }],
    conversationUsage: { input_tokens: 100, output_tokens: 50 },
  });
  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Hello',
    }),
  );

  // Should emit conversation, text_delta, text_delta, done
  assert.ok(events.some((e) => e.type === 'conversation'));
  assert.ok(events.some((e) => e.type === 'text_delta'));
  assert.ok(events.some((e) => e.type === 'done'));

  const textDeltas = events.filter((e) => e.type === 'text_delta') as any[];
  assert.equal(textDeltas.map((e: any) => e.text).join(''), 'Hello there!');

  const done = events.find((e) => e.type === 'done') as any;
  assert.deepEqual(done.usage, { input_tokens: 100, output_tokens: 50 });
  assert.deepEqual(done.last_usage, { input_tokens: 100, output_tokens: 50 });
  assert.deepEqual(done.conversation_usage, { input_tokens: 100, output_tokens: 50 });

  // Should persist user message + assistant message
  assert.ok(persistedMessages.length >= 2, `Expected at least 2 persisted messages, got ${persistedMessages.length}`);
  assert.equal(persistedMessages[0].role, 'user');
  assert.equal(persistedMessages[0].content, 'Hello');
  assert.equal(recordedRequests[0].systemPrompt, 'You are Plaid.');
  assert.deepEqual(recordedRequests[0].messages.map((message: any) => message.content), ['Hello']);
  assert.deepEqual(recordedRequests[0].tools, [], 'Minimal greeting profile should not send tools to the provider.');

  const contextEvent = events.find((e) => e.type === 'context' && (e as any).context.tools) as any;
  assert.equal(contextEvent.context.tools.available_count, 1);
  assert.equal(contextEvent.context.tools.selected_count, 0);
  assert.equal(contextEvent.context.tools.context_profile, 'minimal');

  const budgetEvent = events.find((e) => e.type === 'context' && (e as any).context.budget) as any;
  assert.ok(budgetEvent, 'Expected a budget context event.');
  assert.equal(budgetEvent.context.budget.breakdown.unit, 'estimated_tokens');
  assert.equal(budgetEvent.context.budget.breakdown.system_prompt, estimateTokenCount('You are Plaid.'));
  assert.equal(
    budgetEvent.context.budget.breakdown.message_roles.user,
    estimateTokenCount('user') + estimateTokenCount('Hello') + 4,
  );
  assert.equal(
    budgetEvent.context.budget.breakdown.total,
    budgetEvent.context.budget.estimated_request_size,
  );
  assert.equal(budgetEvent.context.budget.breakdown.tool_schemas.total, 0);

  const finalTimingEvent = [...events].reverse().find((e) =>
    e.type === 'context' && typeof (e as any).context.timings?.total_ms === 'number',
  ) as any;
  assert.ok(finalTimingEvent, 'Expected final timing context event.');
  assert.equal(finalTimingEvent.context.timings.iterations, 1);
}

async function testToolCallFlow() {
  const { orchestrator, providerCallCount, toolExecuteCount, recordedRequests } = createOrchestrator({
    providerEvents: [
      { type: 'text_delta', text: 'Let me search.' },
      { type: 'tool_call_start', id: 'tc-1', name: 'search_all' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"query":"test"}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'done', usage: { input_tokens: 100, output_tokens: 50 } },
    ],
    providerToolEvents: [
      { type: 'text_delta', text: 'Found results.' },
      { type: 'done', usage: { input_tokens: 200, output_tokens: 100 } },
    ],
    toolResult: { items: [{ type: 'applications', id: 'app-1', label: 'CRM' }], total: 1 },
    conversationUsage: { input_tokens: 300, output_tokens: 150 },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Search for CRM',
    }),
  );

  assert.ok(events.some((e) => e.type === 'tool_call'));
  assert.ok(events.some((e) => e.type === 'tool_result'));
  assert.equal(providerCallCount.value, 2, 'Provider should be called twice (initial + after tool result)');
  assert.deepEqual(
    recordedRequests[0].tools.map((tool: any) => tool.name),
    ['search_all'],
    'Read/search profile should keep the selected discovery tool.',
  );

  const contextEvent = events.find((e) => e.type === 'context' && (e as any).context.tools) as any;
  assert.equal(contextEvent.context.tools.available_count, 1);
  assert.equal(contextEvent.context.tools.selected_count, 1);
  assert.equal(contextEvent.context.tools.context_profile, 'read_query');

  const toolCall = events.find((e) => e.type === 'tool_call') as any;
  assert.equal(toolCall.name, 'search_all');

  const toolResult = events.find((e) => e.type === 'tool_result') as any;
  assert.equal(toolResult.name, 'search_all');
  assert.deepEqual(toolResult.result.items[0].label, 'CRM');
  assert.equal(toolExecuteCount.value, 1);

  const done = events.find((e) => e.type === 'done') as any;
  assert.deepEqual(done.last_usage, { input_tokens: 200, output_tokens: 100 });
  assert.deepEqual(done.conversation_usage, { input_tokens: 300, output_tokens: 150 });
}

async function testDeepSeekReasoningContentIsReplayedForToolContinuation() {
  const { orchestrator, persistedMessages, recordedRequests } = createOrchestrator({
    providerId: 'custom',
    endpointUrl: 'https://api.deepseek.com',
    providerEvents: [
      { type: 'reasoning_delta', text: 'I need to search first.' },
      { type: 'tool_call_start', id: 'tc-1', name: 'search_all' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"query":"crm"}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'done', usage: { input_tokens: 100, output_tokens: 50 } },
    ],
    providerToolEvents: [
      { type: 'text_delta', text: 'Found CRM.' },
      { type: 'done', usage: { input_tokens: 200, output_tokens: 100 } },
    ],
  });

  await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Search for CRM',
    }),
  );

  assert.equal(recordedRequests.length, 2);
  const assistantReplay = (recordedRequests[1].messages as any[])
    .find((message) => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'tc-1');
  assert.equal(assistantReplay.reasoning_content, 'I need to search first.');

  const persistedAssistant = persistedMessages
    .find((message) => message.role === 'assistant' && message.toolCalls?.[0]?.id === 'tc-1');
  assert.equal(
    persistedAssistant.providerMetadata.deepseek.reasoning_content,
    'I need to search first.',
  );
}

async function testDeepSeekReasoningContentIsReplayedForEverySplitToolCall() {
  const { orchestrator, persistedMessages, recordedRequests } = createOrchestrator({
    providerId: 'custom',
    endpointUrl: 'https://api.deepseek.com',
    providerEvents: [
      { type: 'reasoning_delta', text: 'I need to inspect several asset groups.' },
      { type: 'tool_call_start', id: 'tc-1', name: 'search_all' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"query":"linux assets"}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'tool_call_start', id: 'tc-2', name: 'search_all' },
      { type: 'tool_call_delta', id: 'tc-2', arguments: '{"query":"windows assets"}' },
      { type: 'tool_call_end', id: 'tc-2' },
      { type: 'done', usage: { input_tokens: 100, output_tokens: 50 } },
    ],
    providerToolEvents: [
      { type: 'text_delta', text: 'Found asset groups.' },
      { type: 'done', usage: { input_tokens: 200, output_tokens: 100 } },
    ],
  });

  await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Check Ansible asset compatibility',
    }),
  );

  assert.equal(recordedRequests.length, 2);
  const replayedAssistantToolCalls = (recordedRequests[1].messages as any[])
    .filter((message) => message.role === 'assistant' && message.tool_calls?.length);
  assert.equal(replayedAssistantToolCalls.length, 2);
  assert.deepEqual(
    replayedAssistantToolCalls.map((message) => message.reasoning_content),
    [
      'I need to inspect several asset groups.',
      'I need to inspect several asset groups.',
    ],
  );

  const persistedAssistantToolCalls = persistedMessages
    .filter((message) => message.role === 'assistant' && message.toolCalls?.length);
  assert.equal(persistedAssistantToolCalls.length, 2);
  assert.deepEqual(
    persistedAssistantToolCalls.map((message) => message.providerMetadata.deepseek.reasoning_content),
    [
      'I need to inspect several asset groups.',
      'I need to inspect several asset groups.',
    ],
  );
}

async function testReasoningContentIsNotReplayedForNonDeepSeekEndpoint() {
  const { orchestrator, persistedMessages, recordedRequests } = createOrchestrator({
    providerId: 'custom',
    endpointUrl: 'https://openrouter.ai/api/v1',
    providerEvents: [
      { type: 'reasoning_delta', text: 'Hidden provider reasoning.' },
      { type: 'tool_call_start', id: 'tc-1', name: 'search_all' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"query":"crm"}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'done', usage: { input_tokens: 100, output_tokens: 50 } },
    ],
    providerToolEvents: [
      { type: 'text_delta', text: 'Found CRM.' },
      { type: 'done', usage: { input_tokens: 200, output_tokens: 100 } },
    ],
  });

  await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Search for CRM',
    }),
  );

  const assistantReplay = (recordedRequests[1].messages as any[])
    .find((message) => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'tc-1');
  assert.equal(Object.prototype.hasOwnProperty.call(assistantReplay, 'reasoning_content'), false);

  const persistedAssistant = persistedMessages
    .find((message) => message.role === 'assistant' && message.toolCalls?.[0]?.id === 'tc-1');
  assert.equal(persistedAssistant.providerMetadata, null);
}

async function testPersistedDeepSeekReasoningContentIsReplayedOnSecondTurn() {
  const { orchestrator, recordedRequests } = createOrchestrator({
    providerId: 'custom',
    endpointUrl: 'https://api.deepseek.com',
    historyMessages: [
      { id: 'msg-1', role: 'user', content: 'Search for CRM' },
      {
        id: 'msg-2',
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'tc-1', name: 'search_all', arguments: '{"query":"crm"}' }],
        provider_metadata_json: { deepseek: { reasoning_content: 'I need to search first.' } },
      },
      {
        id: 'msg-3',
        role: 'tool',
        content: JSON.stringify({ tool_call_id: 'tc-1', tool_name: 'search_all', result: { total: 1 } }),
      },
      { id: 'msg-4', role: 'assistant', content: 'Found CRM.' },
      { id: 'msg-5', role: 'user', content: 'Now summarize it.' },
    ],
  });

  await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: 'Now summarize it.',
    }),
  );

  const replayedAssistant = (recordedRequests[0].messages as any[])
    .find((message) => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'tc-1');
  assert.equal(replayedAssistant.reasoning_content, 'I need to search first.');
}

async function testPersistedDeepSeekToolCallWithoutReasoningIsSkippedOnReplay() {
  const { orchestrator, recordedRequests } = createOrchestrator({
    providerId: 'custom',
    endpointUrl: 'https://api.deepseek.com',
    historyMessages: [
      { id: 'msg-1', role: 'user', content: 'Search for CRM' },
      {
        id: 'msg-2',
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'tc-1', name: 'search_all', arguments: '{"query":"crm"}' }],
        provider_metadata_json: null,
      },
      {
        id: 'msg-3',
        role: 'tool',
        content: JSON.stringify({ tool_call_id: 'tc-1', tool_name: 'search_all', result: { total: 1 } }),
      },
      { id: 'msg-4', role: 'assistant', content: 'Found CRM.' },
      { id: 'msg-5', role: 'user', content: 'Now summarize it.' },
    ],
  });

  await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: 'Now summarize it.',
    }),
  );

  const replayedMessages = recordedRequests[0].messages as any[];
  assert.equal(
    replayedMessages.some((message) => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'tc-1'),
    false,
  );
  assert.equal(
    replayedMessages.some((message) => message.role === 'tool' && message.tool_call_id === 'tc-1'),
    false,
  );
  assert.equal(
    replayedMessages.some((message) => message.role === 'assistant' && message.content === 'Found CRM.'),
    true,
  );
}

async function testBatchPreviewToolResultEmitsEveryPreview() {
  const previews = [1, 2].map((index) => ({
    preview_id: `preview-${index}`,
    tool_name: 'update_task_assignee',
    status: 'pending',
    target: { entity_type: 'tasks', entity_id: `task-${index}`, ref: `T-${index}`, title: `Task ${index}` },
    changes: { assignee: { from: 'Paul', to: 'Marie' } },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: `Update T-${index} assignee from Paul to Marie.`,
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-03-24T10:00:00.000Z',
    expires_at: '2026-03-24T10:10:00.000Z',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  }));
  const { orchestrator } = createOrchestrator({
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat'] },
      {
        name: 'update_task_assignees',
        category: 'mutation',
        description: 'Create assignee previews.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'tasks',
          fields: ['assignee'],
          reversible: true,
          prompt_hint: 'For bulk task reassignment, prefer `update_task_assignees`.',
        },
      },
    ],
    providerEvents: [
      { type: 'tool_call_start', id: 'tc-1', name: 'update_task_assignees' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"refs":["T-1","T-2"],"assignee_email":"marie@example.com"}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'done', usage: { input_tokens: 100, output_tokens: 50 } },
    ],
    providerToolEvents: [
      { type: 'text_delta', text: 'I prepared both previews.' },
      { type: 'done', usage: { input_tokens: 200, output_tokens: 100 } },
    ],
    toolResult: {
      previews,
      errors: [],
      total: 2,
      created: 2,
      failed: 0,
      complete: true,
    },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Réassigne T-1 et T-2 à Marie.',
    }),
  );

  const previewEvents = events.filter((event) => event.type === 'preview') as any[];
  assert.equal(previewEvents.length, 2);
  assert.deepEqual(previewEvents.map((event) => event.preview_id), ['preview-1', 'preview-2']);
  const injectedPreviewContext = events.find((event) =>
    event.type === 'context' && Array.isArray((event as any).context.injected)
      && (event as any).context.injected.some((item: any) => item.kind === 'preview'),
  ) as any;
  assert.deepEqual(injectedPreviewContext.context.injected.map((item: any) => item.ref), ['T-1', 'T-2']);
}

async function testUnsafeWriteConfirmationWithoutPreviewIsRetriedAsToolCall() {
  const preview = {
    preview_id: 'preview-1',
    tool_name: 'update_task_assignee',
    status: 'pending',
    target: { entity_type: 'tasks', entity_id: 'task-1', ref: 'T-1', title: 'Task 1' },
    changes: { assignee: { from: 'Paul', to: 'Marie' } },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: 'Update T-1 assignee from Paul to Marie.',
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-03-24T10:00:00.000Z',
    expires_at: '2026-03-24T10:10:00.000Z',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  };
  const { orchestrator, recordedRequests, toolExecuteCount } = createOrchestrator({
    historyMessages: [{ role: 'user', content: 'Réassigne T-1 à Marie.' }],
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat'] },
      {
        name: 'update_task_assignees',
        category: 'mutation',
        description: 'Create assignee previews.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'tasks',
          fields: ['assignee'],
          reversible: true,
          prompt_hint: 'For bulk task reassignment, prefer `update_task_assignees`.',
        },
      },
    ],
    providerEvents: [
      { type: 'text_delta', text: "Souhaitez-vous que j'execute cette reassignment ?" },
      { type: 'done', usage: { input_tokens: 100, output_tokens: 50 } },
    ],
    providerToolEvents: [
      { type: 'tool_call_start', id: 'tc-1', name: 'update_task_assignees' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"refs":["T-1"],"assignee_email":"marie@example.com"}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'done', usage: { input_tokens: 200, output_tokens: 100 } },
    ],
    toolResult: {
      previews: [preview],
      errors: [],
      total: 1,
      created: 1,
      failed: 0,
      complete: true,
    },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Réassigne T-1 à Marie.',
    }),
  );

  const text = (events.filter((event) => event.type === 'text_delta') as any[])
    .map((event) => event.text)
    .join('');
  assert.doesNotMatch(text, /Souhaitez-vous que j'execute/);
  assert.equal(toolExecuteCount.value, 1);
  assert.equal((events.filter((event) => event.type === 'preview') as any[]).length, 1);
  assert.equal(recordedRequests.length, 3);
  const repairMessage = [...recordedRequests[1].messages].reverse().find((message: any) => message.role === 'user') as any;
  assert.match(repairMessage.content, /previous assistant response was blocked/i);
  assert.match(repairMessage.content, /update_task_assignees/);
}

async function testRawPseudoToolCallTextIsRetriedAsRealToolCall() {
  const preview = {
    preview_id: 'preview-1',
    tool_name: 'update_task_assignee',
    status: 'pending',
    target: { entity_type: 'tasks', entity_id: 'task-1', ref: 'T-1', title: 'Task 1' },
    changes: { assignee: { from: 'Paul', to: 'Marie' } },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: 'Update T-1 assignee from Paul to Marie.',
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-03-24T10:00:00.000Z',
    expires_at: '2026-03-24T10:10:00.000Z',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  };
  const { orchestrator, recordedRequests, toolExecuteCount } = createOrchestrator({
    historyMessages: [
      { role: 'user', content: 'Réassigne T-1 à Marie.' },
      { role: 'assistant', content: "Souhaitez-vous que j'execute cette reassignment ?" },
      { role: 'user', content: 'oui' },
    ],
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat'] },
      {
        name: 'update_task_assignees',
        category: 'mutation',
        description: 'Create assignee previews.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'tasks',
          fields: ['assignee'],
          reversible: true,
          prompt_hint: 'For bulk task reassignment, prefer `update_task_assignees`.',
        },
      },
    ],
    providerEvents: [
      { type: 'text_delta', text: '<tool_call> <function=update_entity> <parameter=id> task-1 </tool_call>' },
      { type: 'done', usage: { input_tokens: 100, output_tokens: 50 } },
    ],
    providerToolEvents: [
      { type: 'tool_call_start', id: 'tc-1', name: 'update_task_assignees' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"refs":["T-1"],"assignee_email":"marie@example.com"}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'done', usage: { input_tokens: 200, output_tokens: 100 } },
    ],
    toolResult: {
      previews: [preview],
      errors: [],
      total: 1,
      created: 1,
      failed: 0,
      complete: true,
    },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: 'oui',
    }),
  );

  const text = (events.filter((event) => event.type === 'text_delta') as any[])
    .map((event) => event.text)
    .join('');
  assert.doesNotMatch(text, /<tool_call>/);
  assert.equal(toolExecuteCount.value, 1);
  assert.equal((events.filter((event) => event.type === 'preview') as any[]).length, 1);
  assert.equal(recordedRequests.length, 3);
  const repairMessage = [...recordedRequests[1].messages].reverse().find((message: any) => message.role === 'user') as any;
  assert.match(repairMessage.content, /raw <tool_call> text/i);
}

async function testTaskMentionWriteKeepsTaskMutationTools() {
  const prompt = 'tu peux passer la [T-49](/portfolio/tasks/task-49) en "en cours" ?';
  const { orchestrator, recordedRequests } = createOrchestrator({
    historyMessages: [{ role: 'user', content: prompt }],
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat', 'mcp'] },
      { name: 'get_entity_detail', category: 'inspection', description: 'Get entity detail', input_summary: {}, read_only: true, surfaces: ['chat', 'mcp'] },
      { name: 'update_task_status', category: 'mutation', description: 'Update task status', input_summary: {}, read_only: false, surfaces: ['chat', 'mcp'], write_preview: { entity_type: 'tasks', fields: ['status'], reversible: true, prompt_hint: 'Update task status.' } },
      { name: 'update_business_record', category: 'mutation', description: 'Update business record', input_summary: {}, read_only: false, surfaces: ['chat', 'mcp'], write_preview: { entity_type: 'applications', fields: ['status'], reversible: true, prompt_hint: 'Update business record.' } },
    ],
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: prompt,
    }),
  );

  const sentToolNames = recordedRequests[0].tools.map((tool: any) => tool.name);
  assert.ok(sentToolNames.includes('update_task_status'), 'Task status writes must keep the task mutation tool.');
  assert.ok(sentToolNames.includes('update_business_record'), 'Non-web KANAP tools stay available for quality and fallback.');
  assert.ok(
    sentToolNames.indexOf('update_task_status') < sentToolNames.indexOf('update_business_record'),
    'Profile-relevant tools should be ordered before fallback write tools.',
  );

  const contextEvent = events.find((e) => e.type === 'context' && (e as any).context.tools) as any;
  assert.equal(contextEvent.context.tools.context_profile, 'write_task');
}

async function testTaskCommentContinuationKeepsTaskMutationTools() {
  const currentMessage = '"Jalopeno for the win"';
  const { orchestrator, recordedRequests } = createOrchestrator({
    historyMessages: [
      {
        role: 'user',
        content: 'tu peux ajouter un commentaire à la [T-49](/portfolio/tasks/task-49) ?',
      },
      {
        role: 'assistant',
        content: 'Je peux ajouter un commentaire à la tâche T-49. Quel contenu souhaitez-vous y inscrire ?',
      },
      {
        role: 'user',
        content: currentMessage,
      },
    ],
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat', 'mcp'] },
      { name: 'get_entity_detail', category: 'inspection', description: 'Get entity detail', input_summary: {}, read_only: true, surfaces: ['chat', 'mcp'] },
      { name: 'add_task_comment', category: 'mutation', description: 'Add task comment', input_summary: {}, read_only: false, surfaces: ['chat', 'mcp'], write_preview: { entity_type: 'tasks', fields: ['comments'], reversible: false, prompt_hint: 'Add task comment.' } },
      { name: 'update_business_record', category: 'mutation', description: 'Update business record', input_summary: {}, read_only: false, surfaces: ['chat', 'mcp'], write_preview: { entity_type: 'applications', fields: ['status'], reversible: true, prompt_hint: 'Update business record.' } },
    ],
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: currentMessage,
    }),
  );

  const sentToolNames = recordedRequests[0].tools.map((tool: any) => tool.name);
  assert.ok(sentToolNames.includes('add_task_comment'), 'Continuation after a task-comment prompt must keep task comment tooling.');
  assert.ok(sentToolNames.includes('update_business_record'), 'Non-web KANAP tools stay available for quality and fallback.');
  assert.ok(
    sentToolNames.indexOf('add_task_comment') < sentToolNames.indexOf('update_business_record'),
    'Continuation should prioritize the inherited task write tool before fallback write tools.',
  );

  const contextEvent = events.find((e) => e.type === 'context' && (e as any).context.tools) as any;
  assert.equal(contextEvent.context.tools.context_profile, 'write_task');
}

async function testModifiedDocumentFollowUpDoesNotTriggerWritePreviewGuard() {
  const currentMessage = 'et tu es capable de me dire ce qui a été modifié ?';
  const { orchestrator, recordedRequests, toolExecuteCount } = createOrchestrator({
    historyMessages: [
      { role: 'user', content: 'quel est le dernier document modifié ?' },
      {
        role: 'assistant',
        content: 'Le dernier document modifié est le DOC-161 — "INT-5 - O365 to SAP - Specification".',
      },
      { role: 'user', content: currentMessage },
    ],
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat', 'mcp'] },
      { name: 'get_document', category: 'inspection', description: 'Get document', input_summary: {}, read_only: true, surfaces: ['chat', 'mcp'] },
      { name: 'update_document_content', category: 'mutation', description: 'Update document content', input_summary: {}, read_only: false, surfaces: ['chat', 'mcp'], write_preview: { entity_type: 'documents', fields: ['content_markdown'], reversible: true, prompt_hint: 'Update document content.' } },
    ],
    providerEvents: [
      { type: 'text_delta', text: "Je peux comparer ce que KANAP expose, mais je n'ai pas d'historique de version détaillé pour ce document." },
      { type: 'done', usage: { input_tokens: 100, output_tokens: 50 } },
    ],
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: currentMessage,
    }),
  );

  const text = (events.filter((event) => event.type === 'text_delta') as any[])
    .map((event) => event.text)
    .join('');
  assert.doesNotMatch(text, /previews backend/i);
  assert.match(text, /historique de version/);
  assert.equal(toolExecuteCount.value, 0);
  assert.equal(recordedRequests.length, 1);

  const contextEvent = events.find((e) => e.type === 'context' && (e as any).context.tools) as any;
  assert.equal(contextEvent.context.tools.context_profile, 'entity_inspection');
}

async function testFeatureAdviceQuestionDoesNotTriggerWritePreviewGuard() {
  const prompt = "sur la base de ce que tu connais de KANAP, quelle serait LA fonctionnalité à ajouter ou améliorer ?";
  const { orchestrator, recordedRequests } = createOrchestrator({
    historyMessages: [{ role: 'user', content: prompt }],
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat', 'mcp'] },
      { name: 'create_task', category: 'mutation', description: 'Create task', input_summary: {}, read_only: false, surfaces: ['chat', 'mcp'], write_preview: { entity_type: 'tasks', fields: ['title'], reversible: false, prompt_hint: 'Create task.' } },
    ],
    providerEvents: [
      { type: 'text_delta', text: 'La fonctionnalité à ajouter serait un diff explicable des changements, relié aux documents et aux previews.' },
      { type: 'done', usage: { input_tokens: 100, output_tokens: 50 } },
    ],
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: prompt,
    }),
  );

  const text = (events.filter((event) => event.type === 'text_delta') as any[])
    .map((event) => event.text)
    .join('');
  assert.doesNotMatch(text, /previews backend/i);
  assert.match(text, /diff explicable/);
  assert.equal(recordedRequests.length, 1);

  const contextEvent = events.find((e) => e.type === 'context' && (e as any).context.tools) as any;
  assert.equal(contextEvent.context.tools.context_profile, 'read_query');
}

async function testParallelToolCallsAreReplayedAsSequentialTurns() {
  const { orchestrator, recordedRequests, persistedMessages, toolExecuteCount } = createOrchestrator({
    providerEvents: [
      { type: 'tool_call_start', id: 'tc-1', name: 'get_entity_detail' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"entity_type":"capex_items","entity_id":"capex-1"}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'tool_call_start', id: 'tc-2', name: 'search_all' },
      { type: 'tool_call_delta', id: 'tc-2', arguments: '{"query":"Remplacement infra","entity_types":["tasks"]}' },
      { type: 'tool_call_end', id: 'tc-2' },
      { type: 'done', usage: { input_tokens: 100, output_tokens: 50 } },
    ],
    providerToolEvents: [
      { type: 'text_delta', text: 'Here are the details.' },
      { type: 'done', usage: { input_tokens: 200, output_tokens: 100 } },
    ],
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Show details for this CAPEX item',
    }),
  );

  assert.equal(toolExecuteCount.value, 2);
  assert.equal(events.filter((event) => event.type === 'tool_call').length, 2);
  assert.equal(recordedRequests.length, 2);

  const replayMessages = recordedRequests[1].messages as any[];
  const assistantToolMessages = replayMessages.filter((message) => message.role === 'assistant' && message.tool_calls?.length);
  assert.equal(assistantToolMessages.length, 2);
  assert.deepEqual(assistantToolMessages.map((message) => message.tool_calls.map((tc: any) => tc.id)), [['tc-1'], ['tc-2']]);

  const toolMessages = replayMessages.filter((message) => message.role === 'tool');
  assert.deepEqual(toolMessages.map((message) => message.tool_call_id), ['tc-1', 'tc-2']);

  assert.deepEqual(
    persistedMessages.map((message) => message.role).slice(1, 5),
    ['assistant', 'tool', 'assistant', 'tool'],
  );
}

async function testApprovalMarkerExecutesPreviewWithoutProviderRoundTrip() {
  const { orchestrator, persistedMessages, recordedRequests, providerCallCount } = createOrchestrator({
    historyMessages: [
      {
        role: 'user',
        content: '[APPROVE:11111111-1111-4111-8111-111111111111]',
      },
    ],
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: '[APPROVE:11111111-1111-4111-8111-111111111111]',
    }),
  );

  const previewResult = events.find((event) => event.type === 'preview_result') as any;
  assert.ok(previewResult);
  assert.equal(previewResult.status, 'executed');
  const textDeltas = events.filter((event) => event.type === 'text_delta') as any[];
  assert.equal(textDeltas.map((event) => event.text).join(''), '[T-1](/portfolio/tasks/task-1) status updated to done.');
  assert.equal(persistedMessages[0].role, 'user');
  assert.equal(persistedMessages[0].content, '[APPROVE:11111111-1111-4111-8111-111111111111]');
  assert.equal(persistedMessages[1].role, 'assistant');
  assert.equal(persistedMessages[1].content, '[T-1](/portfolio/tasks/task-1) status updated to done.');
  assert.equal(providerCallCount.value, 0);
  assert.equal(recordedRequests.length, 0);
}

async function testBatchApprovalMarkerExecutesSelectedPreviewsWithoutProviderRoundTrip() {
  const { orchestrator, providerCallCount } = createOrchestrator({
    previewResults: [
      {
        preview_id: '11111111-1111-4111-8111-111111111111',
        tool_name: 'update_task_status',
        status: 'executed',
        target: { entity_type: 'tasks', entity_id: 'task-1', ref: 'T-1', title: 'First task' },
        changes: { status: { from: 'open', to: 'done' } },
        requires_confirmation: false,
        actions: [],
        summary: 'T-1 status updated to done.',
        error_message: null,
        conversation_id: 'conv-1',
        created_at: '2026-03-24T10:00:00.000Z',
        expires_at: '2026-03-24T10:10:00.000Z',
        approved_at: '2026-03-24T10:01:00.000Z',
        rejected_at: null,
        executed_at: '2026-03-24T10:01:00.000Z',
      },
      {
        preview_id: '22222222-2222-4222-8222-222222222222',
        tool_name: 'update_task_status',
        status: 'failed',
        target: { entity_type: 'tasks', entity_id: 'task-2', ref: 'T-2', title: 'Second task' },
        changes: { status: { from: 'open', to: 'done' } },
        requires_confirmation: false,
        actions: [],
        summary: 'Status update for T-2 failed.',
        error_message: 'Task status changed after the preview was created.',
        conversation_id: 'conv-1',
        created_at: '2026-03-24T10:00:00.000Z',
        expires_at: '2026-03-24T10:10:00.000Z',
        approved_at: '2026-03-24T10:01:00.000Z',
        rejected_at: null,
        executed_at: null,
      },
    ],
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: '[APPROVE_SELECTED:11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222]',
    }),
  );

  const previewResults = events.filter((event) => event.type === 'preview_result') as any[];
  assert.equal(previewResults.length, 2);
  assert.deepEqual(previewResults.map((event) => event.status), ['executed', 'failed']);
  const textDeltas = events.filter((event) => event.type === 'text_delta') as any[];
  const assistantText = textDeltas.map((event) => event.text).join('');
  assert.match(assistantText, /1 applied, 1 failed/);
  assert.match(assistantText, /T-2: Task status changed after the preview was created/);
  assert.equal(providerCallCount.value, 0);
}

async function testApprovalMarkerStreamsDependentFollowUpPreviews() {
  const followUpPreviews = [1, 2].map((index) => ({
    preview_id: `task-preview-${index}`,
    tool_name: 'create_task',
    status: 'pending',
    target: { entity_type: 'tasks', entity_id: null, ref: null, title: `Task ${index}` },
    changes: { title: { from: null, to: `Task ${index}` } },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: `Create task ${index}.`,
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-03-24T10:00:00.000Z',
    expires_at: '2026-03-24T10:10:00.000Z',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  }));
  const { orchestrator, providerCallCount } = createOrchestrator({
    previewResults: [
      {
        preview_id: '11111111-1111-4111-8111-111111111111',
        tool_name: 'create_business_record',
        status: 'executed',
        target: { entity_type: 'projects', entity_id: 'project-1', ref: 'PRJ-1', title: 'Project A' },
        changes: { name: { from: null, to: 'Project A' } },
        requires_confirmation: false,
        actions: [],
        summary: 'Created project "Project A".',
        error_message: null,
        conversation_id: 'conv-1',
        created_at: '2026-03-24T10:00:00.000Z',
        expires_at: '2026-03-24T10:10:00.000Z',
        approved_at: '2026-03-24T10:01:00.000Z',
        rejected_at: null,
        executed_at: '2026-03-24T10:01:00.000Z',
      },
    ],
    followUpPreviews,
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: '[APPROVE:11111111-1111-4111-8111-111111111111]',
    }),
  );

  assert.equal((events.filter((event) => event.type === 'preview_result') as any[]).length, 1);
  const followUpPreviewEvents = events.filter((event) => event.type === 'preview') as any[];
  assert.deepEqual(followUpPreviewEvents.map((event) => event.preview_id), ['task-preview-1', 'task-preview-2']);
  const syntheticToolResult = events.find((event) =>
    event.type === 'tool_result' && (event as any).name === 'prepare_mutation_plan'
  ) as any;
  assert.deepEqual(syntheticToolResult.result.previews.map((preview: any) => preview.preview_id), [
    'task-preview-1',
    'task-preview-2',
  ]);
  const assistantText = (events.filter((event) => event.type === 'text_delta') as any[])
    .map((event) => event.text)
    .join('');
  assert.match(assistantText, /2 dependent previews are now prepared/i);
  assert.equal(providerCallCount.value, 0);
}

async function testApprovalMarkerContinuesOpenMultiStepWorkflowWithoutDurablePlan() {
  const taskPreviews = [1, 2, 3].map((index) => ({
    preview_id: `task-preview-${index}`,
    tool_name: 'create_task',
    status: 'pending',
    target: { entity_type: 'tasks', entity_id: null, ref: null, title: `Task ${index}` },
    changes: { title: { from: null, to: `Task ${index}` } },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: `Create task ${index}.`,
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-03-24T10:00:00.000Z',
    expires_at: '2026-03-24T10:10:00.000Z',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  }));
  const { orchestrator, providerCallCount, recordedRequests, toolExecuteCount } = createOrchestrator({
    historyMessages: [
      {
        role: 'user',
        content: 'Crée le projet A et trois tâches associées.',
      },
      {
        role: 'assistant',
        content: 'Étape 1 : créer le projet. Étapes 2-4 : créer les tâches associées dépendant du projet.',
      },
      {
        role: 'user',
        content: '[APPROVE:99999999-9999-4999-8999-999999999999]',
      },
      {
        role: 'assistant',
        content: 'Le premier preview a échoué. Le plan a été recréé avec les champs manquants. Une fois ce projet approuvé et créé, les 3 tâches suivantes seront automatiquement créées et liées au projet.',
      },
      {
        role: 'user',
        content: '[APPROVE:11111111-1111-4111-8111-111111111111]',
      },
    ],
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat'] },
      {
        name: 'prepare_mutation_plan',
        category: 'mutation',
        description: 'Prepare mutation plan.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'mutation_plan',
          fields: ['operations'],
          reversible: false,
          prompt_hint: 'For dependent changes, use `prepare_mutation_plan`.',
        },
      },
      {
        name: 'create_task',
        category: 'mutation',
        description: 'Create task preview.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'tasks',
          fields: ['title'],
          reversible: false,
          prompt_hint: 'For task creation, use `create_task`.',
        },
      },
    ],
    previewResults: [
      {
        preview_id: '11111111-1111-4111-8111-111111111111',
        tool_name: 'create_business_record',
        status: 'executed',
        target: { entity_type: 'projects', entity_id: 'project-1', ref: 'PRJ-1', title: 'Project A' },
        changes: { name: { from: null, to: 'Project A' } },
        requires_confirmation: false,
        actions: [],
        summary: 'Created project "Project A".',
        error_message: null,
        conversation_id: 'conv-1',
        created_at: '2026-03-24T10:00:00.000Z',
        expires_at: '2026-03-24T10:10:00.000Z',
        approved_at: '2026-03-24T10:01:00.000Z',
        rejected_at: null,
        executed_at: '2026-03-24T10:01:00.000Z',
      },
    ],
    providerEvents: [
      { type: 'tool_call_start', id: 'tc-1', name: 'prepare_mutation_plan' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"summary":"Create remaining tasks","operations":[]}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'done', usage: { input_tokens: 100, output_tokens: 50 } },
    ],
    providerToolEvents: [
      { type: 'text_delta', text: 'I prepared the remaining task previews.' },
      { type: 'done', usage: { input_tokens: 200, output_tokens: 100 } },
    ],
    toolResult: {
      previews: taskPreviews,
      errors: [],
      total: 3,
      created: 3,
      failed: 0,
      complete: true,
    },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: '[APPROVE:11111111-1111-4111-8111-111111111111]',
    }),
  );

  assert.equal(providerCallCount.value, 2);
  assert.equal(toolExecuteCount.value, 1);
  assert.ok(
    recordedRequests[0].messages.some((message: any) =>
      message.role === 'user' && /Continue from this exact state/i.test(String(message.content || '')),
    ),
  );
  assert.equal((events.filter((event) => event.type === 'preview_result') as any[]).length, 1);
  const taskPreviewEvents = events.filter((event) => event.type === 'preview') as any[];
  assert.deepEqual(taskPreviewEvents.map((event) => event.preview_id), [
    'task-preview-1',
    'task-preview-2',
    'task-preview-3',
  ]);
}

async function testEmptyWriteResponseAfterToolIsRepairedIntoPreviews() {
  const taskPreviews = [65, 66, 67].map((number, index) => ({
    preview_id: `task-assignee-preview-${index + 1}`,
    tool_name: 'update_task_assignees',
    status: 'pending',
    target: { entity_type: 'tasks', entity_id: `task-${number}`, ref: `T-${number}`, title: `Task ${number}` },
    changes: { assignee: { from: null, to: 'Nicolas Bertrand' } },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: `Assign T-${number} to Nicolas Bertrand.`,
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-03-24T10:00:00.000Z',
    expires_at: '2026-03-24T10:10:00.000Z',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  }));
  const { orchestrator, providerCallCount, recordedRequests, toolExecuteCount } = createOrchestrator({
    historyMessages: [
      {
        role: 'user',
        content: 'Crée le projet Omelette et trois tâches associées.',
      },
      {
        role: 'assistant',
        content: 'Created project "PRJ-16 - Omelette". 3 dependent previews are now prepared and waiting for explicit approval.\n\n- T-65\n- T-66\n- T-67',
      },
      {
        role: 'user',
        content: 'Parfait. Tu peux assigner toutes les tâches à Nicolas Bertrand ?',
      },
    ],
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat'] },
      {
        name: 'update_task_assignees',
        category: 'mutation',
        description: 'Bulk task reassignment preview.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'tasks',
          fields: ['assignee'],
          reversible: false,
          prompt_hint: 'For bulk task reassignment, use `update_task_assignees`.',
        },
      },
    ],
    providerEventBatches: [
      [
        { type: 'tool_call_start', id: 'tc-query-user', name: 'query_entities' },
        { type: 'tool_call_delta', id: 'tc-query-user', arguments: '{"entity_type":"users","filters":{"query":"Nicolas Bertrand"}}' },
        { type: 'tool_call_end', id: 'tc-query-user' },
        { type: 'done', usage: { input_tokens: 100, output_tokens: 30 } },
      ],
      [
        { type: 'done', usage: { input_tokens: 120, output_tokens: 0 } },
      ],
      [
        { type: 'tool_call_start', id: 'tc-preview', name: 'update_task_assignees' },
        { type: 'tool_call_delta', id: 'tc-preview', arguments: '{"task_refs":["T-65","T-66","T-67"],"assignee_email":"nicolas.bertrand@example.com"}' },
        { type: 'tool_call_end', id: 'tc-preview' },
        { type: 'done', usage: { input_tokens: 140, output_tokens: 40 } },
      ],
      [
        { type: 'text_delta', text: 'I prepared the reassignment previews.' },
        { type: 'done', usage: { input_tokens: 160, output_tokens: 20 } },
      ],
    ],
    toolResultsByName: {
      query_entities: {
        items: [{ id: 'user-2', type: 'users', label: 'Nicolas Bertrand', email: 'nicolas.bertrand@example.com' }],
        total: 1,
      },
      update_task_assignees: {
        previews: taskPreviews,
        errors: [],
        total: 3,
        created: 3,
        failed: 0,
        complete: true,
      },
    },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: 'Parfait. Tu peux assigner toutes les tâches à Nicolas Bertrand ?',
    }),
  );

  assert.equal(providerCallCount.value, 4);
  assert.equal(toolExecuteCount.value, 2);
  assert.ok(
    recordedRequests[2].messages.some((message: any) =>
      message.role === 'user' && /ended with no visible answer/i.test(String(message.content || '')),
    ),
  );
  const previewEvents = events.filter((event) => event.type === 'preview') as any[];
  assert.deepEqual(previewEvents.map((event) => event.preview_id), [
    'task-assignee-preview-1',
    'task-assignee-preview-2',
    'task-assignee-preview-3',
  ]);
}

async function testEmptyWriteCorrectionResponseIsRepairedIntoPreviews() {
  const taskPreviews = ['T-48', 'T-31'].map((ref, index) => ({
    preview_id: `task-comment-correction-preview-${index + 1}`,
    tool_name: 'add_task_comment',
    status: 'pending',
    target: { entity_type: 'tasks', entity_id: `task-${index + 1}`, ref, title: `Task ${index + 1}` },
    changes: { comment: { from: null, to: 'Tant va la cruche a l eau qu a la fin elle se casse.' } },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: `Add comment to ${ref}.`,
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-03-24T10:00:00.000Z',
    expires_at: '2026-03-24T10:10:00.000Z',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  }));
  const { orchestrator, providerCallCount, recordedRequests, toolExecuteCount } = createOrchestrator({
    historyMessages: [
      {
        role: 'user',
        content: 'Ajoute le commentaire "Tant va la cruche a l eau qu a la fin elle se casse." à toutes les tâches en retard',
      },
      {
        role: 'assistant',
        content: 'Les 27 previews sont prêtes. Voulez-vous les approuver toutes pour exécution ?',
      },
      {
        role: 'user',
        content: "c'est une relance ! je ne veux mettre ce message qu'aux tâches qui sont encore en cours.",
      },
    ],
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat'] },
      {
        name: 'prepare_mutation_plan',
        category: 'mutation',
        description: 'Prepare mutation plan.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'mutation_plan',
          fields: ['operations'],
          reversible: false,
          prompt_hint: 'Use prepare_mutation_plan for bulk target tracking.',
        },
      },
      {
        name: 'add_task_comment',
        category: 'mutation',
        description: 'Add task comment.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'tasks',
          fields: ['comments'],
          reversible: false,
          prompt_hint: 'Use add_task_comment with a canonical task ref.',
        },
      },
    ],
    providerEventBatches: [
      [
        { type: 'done', usage: { input_tokens: 100, output_tokens: 0 } },
      ],
      [
        { type: 'text_delta', text: 'Je corrige la sélection et ne cible que les tâches encore en cours.' },
        { type: 'tool_call_start', id: 'tc-plan', name: 'prepare_mutation_plan' },
        {
          type: 'tool_call_delta',
          id: 'tc-plan',
          arguments: '{"summary":"Add comments to active overdue tasks","operations":[{"operation_id":"t48","tool_name":"add_task_comment","input":{"ref":"T-48","content":"Tant va la cruche a l eau qu a la fin elle se casse."}},{"operation_id":"t31","tool_name":"add_task_comment","input":{"ref":"T-31","content":"Tant va la cruche a l eau qu a la fin elle se casse."}}],"expected_target_refs":["T-48","T-31"],"expected_target_count":2}',
        },
        { type: 'tool_call_end', id: 'tc-plan' },
        { type: 'done', usage: { input_tokens: 120, output_tokens: 60 } },
      ],
      [
        { type: 'text_delta', text: 'Les previews corrigées sont prêtes.' },
        { type: 'done', usage: { input_tokens: 140, output_tokens: 20 } },
      ],
    ],
    toolResultsByName: {
      prepare_mutation_plan: {
        previews: taskPreviews,
        errors: [],
        total: 2,
        created: 2,
        failed: 0,
        expected_count: 2,
        expected_refs: ['T-48', 'T-31'],
        covered_refs: ['T-48', 'T-31'],
        missing_refs: [],
        excluded: [],
        complete: true,
      },
    },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: "c'est une relance ! je ne veux mettre ce message qu'aux tâches qui sont encore en cours.",
    }),
  );

  assert.equal(providerCallCount.value, 3);
  assert.equal(toolExecuteCount.value, 1);
  assert.ok(
    recordedRequests[1].messages.some((message: any) =>
      message.role === 'user' && /no visible assistant text/i.test(String(message.content || '')),
    ),
  );
  const previewEvents = events.filter((event) => event.type === 'preview') as any[];
  assert.deepEqual(previewEvents.map((event) => event.preview_id), [
    'task-comment-correction-preview-1',
    'task-comment-correction-preview-2',
  ]);
  assert.ok(!events.some((event) => event.type === 'error'));
}

async function testIncompleteBulkPreviewCoverageTriggersRepairInstruction() {
  const taskPreviews = [1, 2, 3].map((number) => ({
    preview_id: `task-comment-preview-${number}`,
    tool_name: 'add_task_comment',
    status: 'pending',
    target: { entity_type: 'tasks', entity_id: `task-${number}`, ref: `T-${number}`, title: `Task ${number}` },
    changes: { comment: { from: null, to: 'allo ?' } },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: `Add comment to T-${number}.`,
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-03-24T10:00:00.000Z',
    expires_at: '2026-03-24T10:10:00.000Z',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  }));
  const { orchestrator, providerCallCount, recordedRequests } = createOrchestrator({
    historyMessages: [
      {
        role: 'user',
        content: 'Ajoute le commentaire "allo ?" à toutes les tâches en retard',
      },
    ],
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat'] },
      {
        name: 'prepare_mutation_plan',
        category: 'mutation',
        description: 'Prepare mutation plan.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'mutation_plan',
          fields: ['operations'],
          reversible: false,
          prompt_hint: 'Use prepare_mutation_plan for bulk target tracking.',
        },
      },
      {
        name: 'add_task_comment',
        category: 'mutation',
        description: 'Add task comment.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'tasks',
          fields: ['comments'],
          reversible: false,
          prompt_hint: 'Use add_task_comment with a canonical task ref.',
        },
      },
    ],
    providerEventBatches: [
      [
        { type: 'tool_call_start', id: 'tc-query', name: 'query_entities' },
        { type: 'tool_call_delta', id: 'tc-query', arguments: '{"entity_type":"tasks","filters":{"due":"overdue"},"limit":50}' },
        { type: 'tool_call_end', id: 'tc-query' },
        { type: 'done', usage: { input_tokens: 100, output_tokens: 30 } },
      ],
      [
        { type: 'tool_call_start', id: 'tc-plan', name: 'prepare_mutation_plan' },
        { type: 'tool_call_delta', id: 'tc-plan', arguments: '{"summary":"Add comments","operations":[{"operation_id":"t1","tool_name":"add_task_comment","input":{"ref":"T-1","content":"allo ?"}},{"operation_id":"t2","tool_name":"add_task_comment","input":{"ref":"T-2","content":"allo ?"}},{"operation_id":"t3","tool_name":"add_task_comment","input":{"ref":"T-3","content":"allo ?"}}]}' },
        { type: 'tool_call_end', id: 'tc-plan' },
        { type: 'done', usage: { input_tokens: 120, output_tokens: 40 } },
      ],
      [
        { type: 'text_delta', text: 'J ai prepare les previews.' },
        { type: 'done', usage: { input_tokens: 140, output_tokens: 20 } },
      ],
      [
        { type: 'text_delta', text: 'Hypothese : T-4 est exclue du perimetre actif. Les autres previews restent en attente d approbation.' },
        { type: 'done', usage: { input_tokens: 160, output_tokens: 24 } },
      ],
    ],
    toolResultsByName: {
      query_entities: {
        items: [1, 2, 3, 4].map((number) => ({
          id: `task-${number}`,
          type: 'tasks',
          ref: `T-${number}`,
          label: `Task ${number}`,
        })),
        total: 4,
        returned: 4,
        truncated: false,
        complete: true,
      },
      prepare_mutation_plan: {
        previews: taskPreviews,
        errors: [],
        total: 3,
        created: 3,
        failed: 0,
        complete: true,
      },
    },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: 'Ajoute le commentaire "allo ?" à toutes les tâches en retard',
    }),
  );

  assert.equal(providerCallCount.value, 4);
  assert.ok(
    recordedRequests[3].messages.some((message: any) =>
      message.role === 'user'
      && /did not cover the complete resolved bulk target set/i.test(String(message.content || ''))
      && /T-4/.test(String(message.content || '')),
    ),
  );
  assert.equal(
    (events.filter((event) => event.type === 'text_delta') as any[]).map((event) => event.text).join(''),
    'Hypothese : T-4 est exclue du perimetre actif. Les autres previews restent en attente d approbation.',
  );
}

async function testSingleRefBulkRepairIsAutoplannedForMissingRefs() {
  const taskPreviews = [1, 2, 3, 4].map((number) => ({
    preview_id: `task-comment-preview-${number}`,
    tool_name: 'add_task_comment',
    status: 'pending',
    target: { entity_type: 'tasks', entity_id: `task-${number}`, ref: `T-${number}`, title: `Task ${number}` },
    changes: { comment: { from: null, to: 'allo ?' } },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: `Add comment to T-${number}.`,
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-03-24T10:00:00.000Z',
    expires_at: '2026-03-24T10:10:00.000Z',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  }));
  const { orchestrator, executedToolCalls, providerCallCount } = createOrchestrator({
    historyMessages: [
      {
        role: 'user',
        content: 'Ajoute le commentaire "allo ?" à toutes les tâches en retard',
      },
    ],
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat'] },
      {
        name: 'prepare_mutation_plan',
        category: 'mutation',
        description: 'Prepare mutation plan.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'mutation_plan',
          fields: ['operations'],
          reversible: false,
          prompt_hint: 'Use prepare_mutation_plan for bulk target tracking.',
        },
      },
      {
        name: 'add_task_comment',
        category: 'mutation',
        description: 'Add task comment.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'tasks',
          fields: ['comments'],
          reversible: false,
          prompt_hint: 'Use add_task_comment with a canonical task ref.',
        },
      },
    ],
    providerEventBatches: [
      [
        { type: 'tool_call_start', id: 'tc-query', name: 'query_entities' },
        { type: 'tool_call_delta', id: 'tc-query', arguments: '{"entity_type":"tasks","filters":{"due":"overdue"},"limit":50}' },
        { type: 'tool_call_end', id: 'tc-query' },
        { type: 'done', usage: { input_tokens: 100, output_tokens: 30 } },
      ],
      [
        { type: 'tool_call_start', id: 'tc-comment', name: 'add_task_comment' },
        { type: 'tool_call_delta', id: 'tc-comment', arguments: '{"ref":"T-1","content":"allo ?"}' },
        { type: 'tool_call_end', id: 'tc-comment' },
        { type: 'done', usage: { input_tokens: 120, output_tokens: 40 } },
      ],
      [
        { type: 'text_delta', text: 'Les previews sont pretes.' },
        { type: 'done', usage: { input_tokens: 140, output_tokens: 20 } },
      ],
    ],
    toolResultsByName: {
      query_entities: {
        items: [1, 2, 3, 4].map((number) => ({
          id: `task-${number}`,
          type: 'tasks',
          ref: `T-${number}`,
          label: `Task ${number}`,
        })),
        total: 4,
        returned: 4,
        truncated: false,
        complete: true,
      },
      prepare_mutation_plan: {
        previews: taskPreviews,
        errors: [],
        total: 4,
        created: 4,
        failed: 0,
        expected_count: 4,
        expected_refs: ['T-1', 'T-2', 'T-3', 'T-4'],
        covered_refs: ['T-1', 'T-2', 'T-3', 'T-4'],
        missing_refs: [],
        excluded: [],
        complete: true,
      },
    },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: 'Ajoute le commentaire "allo ?" à toutes les tâches en retard',
    }),
  );

  assert.equal(providerCallCount.value, 3);
  assert.deepEqual(executedToolCalls.map((call) => call.toolName), ['query_entities', 'prepare_mutation_plan']);
  assert.deepEqual(
    executedToolCalls[1].input.operations.map((operation: any) => operation.input.ref),
    ['T-1', 'T-2', 'T-3', 'T-4'],
  );
  assert.equal((events.filter((event) => event.type === 'preview') as any[]).length, 4);
  assert.ok(!events.some((event) => event.type === 'error'));
}

async function testSingleRefBulkContinuationUsesTextualTargetSet() {
  const taskPreviews = [1, 2, 3].map((number) => ({
    preview_id: `task-comment-preview-${number}`,
    tool_name: 'add_task_comment',
    status: 'pending',
    target: { entity_type: 'tasks', entity_id: `task-${number}`, ref: `T-${number}`, title: `Task ${number}` },
    changes: { comment: { from: null, to: 'allo ?' } },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: `Add comment to T-${number}.`,
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-03-24T10:00:00.000Z',
    expires_at: '2026-03-24T10:10:00.000Z',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  }));
  const { orchestrator, executedToolCalls } = createOrchestrator({
    historyMessages: [
      {
        role: 'user',
        content: 'Ajoute le commentaire "allo ?" à toutes les tâches en retard',
      },
      {
        role: 'assistant',
        content: [
          'Plan de mutation mis à jour',
          '3 tâches actives restantes : T-1, T-2, T-3',
          'Tâches exclues : T-4 (done)',
        ].join('\n'),
      },
      {
        role: 'user',
        content: "mais... là il n'y en avait qu'une !",
      },
    ],
    availableTools: [
      {
        name: 'prepare_mutation_plan',
        category: 'mutation',
        description: 'Prepare mutation plan.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'mutation_plan',
          fields: ['operations'],
          reversible: false,
          prompt_hint: 'Use prepare_mutation_plan for bulk target tracking.',
        },
      },
      {
        name: 'add_task_comment',
        category: 'mutation',
        description: 'Add task comment.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'tasks',
          fields: ['comments'],
          reversible: false,
          prompt_hint: 'Use add_task_comment with a canonical task ref.',
        },
      },
    ],
    providerEventBatches: [
      [
        { type: 'text_delta', text: 'Je vais générer les previews pour les 3 tâches actives restantes.' },
        { type: 'tool_call_start', id: 'tc-comment', name: 'add_task_comment' },
        { type: 'tool_call_delta', id: 'tc-comment', arguments: '{"ref":"T-1","content":"allo ?"}' },
        { type: 'tool_call_end', id: 'tc-comment' },
        { type: 'done', usage: { input_tokens: 100, output_tokens: 40 } },
      ],
      [
        { type: 'text_delta', text: 'Les previews sont prêtes.' },
        { type: 'done', usage: { input_tokens: 120, output_tokens: 20 } },
      ],
    ],
    toolResultsByName: {
      prepare_mutation_plan: {
        previews: taskPreviews,
        errors: [],
        total: 3,
        created: 3,
        failed: 0,
        expected_count: 3,
        expected_refs: ['T-1', 'T-2', 'T-3'],
        covered_refs: ['T-1', 'T-2', 'T-3'],
        missing_refs: [],
        excluded: [],
        complete: true,
      },
    },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: "mais... là il n'y en avait qu'une !",
    }),
  );

  assert.deepEqual(executedToolCalls.map((call) => call.toolName), ['prepare_mutation_plan']);
  assert.deepEqual(
    executedToolCalls[0].input.operations.map((operation: any) => operation.input.ref),
    ['T-1', 'T-2', 'T-3'],
  );
  assert.equal((events.filter((event) => event.type === 'preview') as any[]).length, 3);
}

async function testPartialMutationPlanUsesCurrentTextualTargetSet() {
  const refs = ['T-48', 'T-31', 'T-30', 'T-29', 'T-28', 'T-27', 'T-25'];
  const taskPreviews = refs.map((ref, index) => ({
    preview_id: `task-comment-preview-${index + 1}`,
    tool_name: 'add_task_comment',
    status: 'pending',
    target: { entity_type: 'tasks', entity_id: `task-${index + 1}`, ref, title: `Task ${index + 1}` },
    changes: { comment: { from: null, to: 'allo ?' } },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: `Add comment to ${ref}.`,
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-03-24T10:00:00.000Z',
    expires_at: '2026-03-24T10:10:00.000Z',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  }));
  const { orchestrator, executedToolCalls } = createOrchestrator({
    historyMessages: [
      {
        role: 'user',
        content: 'Ajoute le commentaire "allo ?" à toutes les tâches en retard',
      },
      {
        role: 'assistant',
        content: 'J ai trouvé 27 tâches en retard.',
      },
      {
        role: 'user',
        content: 'Exclus les tâches déjà fermées.',
      },
    ],
    availableTools: [
      {
        name: 'prepare_mutation_plan',
        category: 'mutation',
        description: 'Prepare mutation plan.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'mutation_plan',
          fields: ['operations'],
          reversible: false,
          prompt_hint: 'Use prepare_mutation_plan for bulk target tracking.',
        },
      },
      {
        name: 'add_task_comment',
        category: 'mutation',
        description: 'Add task comment.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'tasks',
          fields: ['comments'],
          reversible: false,
          prompt_hint: 'Use add_task_comment with a canonical task ref.',
        },
      },
    ],
    providerEventBatches: [
      [
        {
          type: 'text_delta',
          text: [
            'Vous avez raison. Je cible les 7 tâches en retard avec un statut actif.',
            '',
            'Tâches ciblées (7):',
            'T-48 test héritage',
            'T-31 Résilier ASAP',
            'T-30 Résilier ASAP',
            'T-29 Résiliser ASAP',
            'T-28 Résilier ASAP',
            'T-27 Résilier ASAP',
            'T-25 Résiliation ASAP',
            '',
            'Tâches exclues (déjà terminées): T-26, T-19, T-17',
          ].join('\n'),
        },
        { type: 'tool_call_start', id: 'tc-plan', name: 'prepare_mutation_plan' },
        {
          type: 'tool_call_delta',
          id: 'tc-plan',
          arguments: '{"summary":"Add comments","operations":[{"operation_id":"t48","tool_name":"add_task_comment","input":{"ref":"T-48","content":"allo ?"}},{"operation_id":"t31","tool_name":"add_task_comment","input":{"ref":"T-31","content":"allo ?"}}]}',
        },
        { type: 'tool_call_end', id: 'tc-plan' },
        { type: 'done', usage: { input_tokens: 100, output_tokens: 40 } },
      ],
      [
        { type: 'text_delta', text: 'Les previews sont prêtes.' },
        { type: 'done', usage: { input_tokens: 120, output_tokens: 20 } },
      ],
    ],
    toolResultsByName: {
      prepare_mutation_plan: {
        previews: taskPreviews,
        errors: [],
        total: refs.length,
        created: refs.length,
        failed: 0,
        expected_count: refs.length,
        expected_refs: refs,
        covered_refs: refs,
        missing_refs: [],
        excluded: [],
        complete: true,
      },
    },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: 'Exclus les tâches déjà fermées.',
    }),
  );

  assert.deepEqual(executedToolCalls.map((call) => call.toolName), ['prepare_mutation_plan']);
  assert.deepEqual(
    executedToolCalls[0].input.operations.map((operation: any) => operation.input.ref),
    refs,
  );
  assert.equal((events.filter((event) => event.type === 'preview') as any[]).length, refs.length);
}

async function testTextualWriteConfirmationWithoutPreviewIsRewrittenToCreatePreviews() {
  const { orchestrator, recordedRequests } = createOrchestrator({
    historyMessages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Réassigne les 3 tâches de Friedrich EVA à Nicolas Bertrand.',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Voici les modifications proposées. Souhaitez-vous que je procède à cette réassignation ?',
      },
      {
        id: 'msg-3',
        role: 'user',
        content: 'oui',
      },
    ],
    availableTools: [
      { name: 'query_entities', category: 'authoritative', description: 'Query entities', input_summary: {}, read_only: true, surfaces: ['chat'] },
      {
        name: 'update_task_assignee',
        category: 'mutation',
        description: 'Create assignee preview.',
        input_summary: {},
        read_only: false,
        surfaces: ['chat'],
        write_preview: {
          entity_type: 'tasks',
          fields: ['assignee'],
          reversible: true,
          prompt_hint: 'For assignee changes, use `update_task_assignee` with the assignee email.',
        },
      },
    ],
    providerEvents: [{ type: 'text_delta', text: 'I will create the previews.' }, { type: 'done' }],
  });

  await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      conversationId: 'conv-1',
      userMessage: 'oui',
    }),
  );

  assert.equal(recordedRequests.length, 1);
  const messages = recordedRequests[0].messages as any[];
  const latestUser = [...messages].reverse().find((message) => message.role === 'user');
  assert.match(latestUser.content, /No pending backend mutation preview exists/);
  assert.match(latestUser.content, /Create the required backend mutation previews now/);
  assert.match(latestUser.content, /update_task_assignee/);
  assert.match(latestUser.content, /Do not execute changes/);
}

async function testProviderReceivesAbortSignal() {
  const abortController = new AbortController();
  const { orchestrator, recordedRequests } = createOrchestrator({
    providerEvents: [{ type: 'done', usage: { input_tokens: 1, output_tokens: 1 } }],
  });

  await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Hello',
      signal: abortController.signal,
    }),
  );

  assert.equal(recordedRequests[0].signal, abortController.signal);
}

async function testProviderRequestUsesChatTimeout() {
  const { orchestrator, recordedRequests } = createOrchestrator({
    providerEvents: [{ type: 'done', usage: { input_tokens: 1, output_tokens: 1 } }],
  });

  await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Hello',
    }),
  );

  assert.equal(recordedRequests[0].timeoutMs, 300000);
}

async function testRepeatedToolCallRepairCanRecoverToFinalAnswer() {
  const repeatedSearchBatch = (id: string) => [
    { type: 'tool_call_start', id, name: 'search_all' },
    { type: 'tool_call_delta', id, arguments: '{"query":"test"}' },
    { type: 'tool_call_end', id },
    { type: 'done', usage: { input_tokens: 100, output_tokens: 20 } },
  ];
  const { orchestrator, providerCallCount, toolExecuteCount, recordedRequests } = createOrchestrator({
    providerEventBatches: [
      repeatedSearchBatch('tc-1'),
      repeatedSearchBatch('tc-2'),
      [
        { type: 'text_delta', text: 'No matching results.' },
        { type: 'done', usage: { input_tokens: 150, output_tokens: 25 } },
      ],
    ],
    toolResult: { items: [], total: 0 },
    conversationUsage: { input_tokens: 250, output_tokens: 45 },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Search',
    }),
  );

  assert.equal(events.find((e) => e.type === 'error'), undefined);
  assert.ok(events.some((e) => e.type === 'done'));
  assert.equal(providerCallCount.value, 3);
  assert.equal(toolExecuteCount.value, 1);
  assert.equal(events.filter((e) => e.type === 'tool_result').length, 1);

  const repairRequestMessages = recordedRequests[2].messages as any[];
  const repairMessage = [...repairRequestMessages].reverse().find((message) => message.role === 'user') as any;
  assert.match(repairMessage.content, /repeated the exact same tool call/i);
  assert.match(repairMessage.content, /search_all/);
  assert.match(repairMessage.content, /Do not call the same tool again with identical arguments/);
}

async function testRepeatedToolCallsStopWithoutFurtherProgress() {
  const repeatedSearchBatch = (id: string) => [
    { type: 'text_delta', text: 'Need to search again.' },
    { type: 'tool_call_start', id, name: 'search_all' },
    { type: 'tool_call_delta', id, arguments: '{"query":"test"}' },
    { type: 'tool_call_end', id },
    { type: 'done', usage: { input_tokens: 100, output_tokens: 20 } },
  ];
  const { orchestrator, providerCallCount, toolExecuteCount, recordedRequests } = createOrchestrator({
    providerEventBatches: [
      repeatedSearchBatch('tc-1'),
      repeatedSearchBatch('tc-2'),
      repeatedSearchBatch('tc-3'),
      repeatedSearchBatch('tc-4'),
    ],
    toolResult: { items: [], total: 0 },
    conversationUsage: { input_tokens: 100, output_tokens: 20 },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Search',
    }),
  );

  const errorEvent = events.find((e) => e.type === 'error') as any;
  assert.equal(errorEvent?.message, 'Maximum tool call iterations reached without progress.');
  assert.deepEqual(errorEvent?.last_usage, { input_tokens: 100, output_tokens: 20 });
  assert.deepEqual(errorEvent?.conversation_usage, { input_tokens: 100, output_tokens: 20 });
  assert.equal(providerCallCount.value, 4);
  assert.equal(toolExecuteCount.value, 1);

  const finalRepairRequestMessages = recordedRequests[3].messages as any[];
  const repairMessages = finalRepairRequestMessages.filter((message) =>
    message.role === 'user' && /repeated the exact same tool call/i.test(message.content),
  );
  assert.equal(repairMessages.length, 2);
}

async function testDistinctSearchAllNoProgressStopsEarly() {
  const searchBatch = (id: string, query: string) => [
    { type: 'tool_call_start', id, name: 'search_all' },
    { type: 'tool_call_delta', id, arguments: JSON.stringify({ query }) },
    { type: 'tool_call_end', id },
    { type: 'done', usage: { input_tokens: 100, output_tokens: 20 } },
  ];
  const { orchestrator, providerCallCount, toolExecuteCount, recordedRequests } = createOrchestrator({
    providerEventBatches: [
      searchBatch('tc-1', 'Eva Fried task'),
      searchBatch('tc-2', 'fried@kanap.net task'),
      searchBatch('tc-3', 'Fried Eva assignee'),
      searchBatch('tc-4', 'T- task'),
      searchBatch('tc-5', 'project'),
      searchBatch('tc-6', 'Infrastructure team tasks'),
      searchBatch('tc-7', 'Eva task open'),
      searchBatch('tc-8', 'assignee Eva'),
    ],
    toolResult: {
      items: [],
      total: 0,
      returned: 0,
      truncated: false,
      complete: true,
      failed_entity_types: [],
    },
    conversationUsage: { input_tokens: 100, output_tokens: 20 },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Search',
    }),
  );

  const errorEvent = events.find((e) => e.type === 'error') as any;
  assert.equal(errorEvent?.message, 'Maximum tool call iterations reached without progress.');
  assert.equal(providerCallCount.value, 8);
  assert.equal(toolExecuteCount.value, 8);

  const repairRequestMessages = recordedRequests[4].messages as any[];
  const repairMessage = [...repairRequestMessages].reverse().find((message) =>
    message.role === 'user' && /broad search_all calls have added no new result IDs/i.test(message.content),
  ) as any;
  assert.ok(repairMessage);
  assert.match(repairMessage.content, /Do not call search_all again this turn/i);
  assert.doesNotMatch(repairMessage.content, /repeated the exact same tool call/i);
}

async function testProviderErrorIncludesConversationUsage() {
  const { orchestrator } = createOrchestrator({
    providerEvents: [{ type: 'error', message: 'Provider unavailable' }],
    conversationUsage: { input_tokens: 42, output_tokens: 7 },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Hello',
    }),
  );

  const errorEvent = events.find((event) => event.type === 'error') as any;
  assert.equal(errorEvent?.message, 'Provider unavailable');
  assert.equal(errorEvent?.last_usage, undefined);
  assert.deepEqual(errorEvent?.conversation_usage, { input_tokens: 42, output_tokens: 7 });
}

async function testSystemPromptGuidance() {
  const service = new AiSystemPromptService();
  const prompt = service.build({
    tenantName: 'Test Tenant',
    availableTools: [
      {
        name: 'query_entities',
        category: 'authoritative',
        description: 'Query one readable entity family with server-side filters, pagination, and exact totals.',
        input_summary: {},
        read_only: true,
        surfaces: ['chat', 'mcp'],
      },
      {
        name: 'aggregate_entities',
        category: 'authoritative',
        description: 'Break down one readable entity family by a supported field with exact server-side counts.',
        input_summary: {},
        read_only: true,
        surfaces: ['chat', 'mcp'],
      },
      {
        name: 'get_filter_values',
        category: 'authoritative',
        description: 'Discover exact filter values for supported set-like AI query fields.',
        input_summary: {},
        read_only: true,
        surfaces: ['chat', 'mcp'],
      },
    ],
    readableEntityTypes: ['applications', 'tasks'],
    currentUser: {
      displayName: 'Alex Operator',
      email: 'alex@example.com',
      roleNames: ['Administrator'],
      teamName: 'Strategy',
    },
  });

  assert.match(prompt, /query_entities/);
  assert.match(prompt, /aggregate_entities/);
  assert.match(prompt, /get_filter_values/);
  assert.match(prompt, /Alex Operator/);
  assert.match(prompt, /scope: "me"/);
  assert.ok(!prompt.includes('list_entities'));
  assert.ok(!prompt.includes('always search first'));
}

function buildLargeToolMessage(index: number) {
  return {
    role: 'tool',
    tool_call_id: `tool-call-${index}`,
    content: JSON.stringify({
      tool_call_id: `tool-call-${index}`,
      tool_name: 'query_entities',
      result: {
        items: Array.from({ length: 24 }, (_, itemIndex) => ({
          id: `item-${index}-${itemIndex}`,
          label: `${'x'.repeat(40)}-${itemIndex}`,
        })),
        total: 240 + index,
        complete: false,
      },
    }),
  };
}

function buildLargeToolCallMessage(index: number) {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: `tool-call-${index}`,
      name: 'query_entities',
      arguments: JSON.stringify({ entity_type: 'applications', limit: 200 }),
    }],
  };
}

function buildLargeAssistantMessage(index: number) {
  return {
    role: 'assistant',
    content: `Assistant history ${index} ${'y'.repeat(800)}`,
  };
}

function buildRecentMessage(index: number) {
  return index % 2 === 0
    ? { role: 'user', content: `Recent user ${index}` }
    : { role: 'assistant', content: `Recent assistant ${index}` };
}

function buildCompactionHistory() {
  const messages: any[] = [];
  for (let index = 0; index < 3; index++) {
    messages.push(buildLargeToolCallMessage(index));
    messages.push(buildLargeToolMessage(index));
    messages.push(buildLargeAssistantMessage(index));
  }
  for (let index = 0; index < 8; index++) {
    messages.push(buildRecentMessage(index));
  }
  return messages;
}

async function testContextCompaction() {
  const capturedLogs: string[] = [];
  const originalLoggerLog = Logger.prototype.log;
  Logger.prototype.log = function (...args: any[]) {
    capturedLogs.push(args.map((arg) => String(arg)).join(' '));
    return undefined as any;
  };

  try {
    const { orchestrator, recordedRequests } = createOrchestrator({
      providerContextWindow: 800,
      historyMessages: buildCompactionHistory(),
    });

    await collectEvents(
      orchestrator.stream({
        context: {
          tenantId: 'tenant-1',
          userId: 'user-1',
          isPlatformHost: false,
          surface: 'chat',
          authMethod: 'jwt',
        },
        userMessage: 'Show me the summary',
      }),
    );

    assert.equal(recordedRequests.length, 1);
    const requestMessages = recordedRequests[0].messages as any[];
    assert.equal(recordedRequests[0].systemPrompt, 'You are Plaid.');
    assert.ok(
      requestMessages.some((message) =>
        message.role === 'tool'
        && /^\[tool result truncated: query_entities/.test(message.content)
        && /complete=false/.test(message.content)
      ),
    );
    assert.ok(
      requestMessages.some((message) =>
        message.role === 'assistant'
        && /^\[assistant message truncated:/.test(message.content)
      ),
    );
    assert.deepEqual(
      requestMessages.slice(-8).map((message) => message.content),
      [
        'Recent user 0',
        'Recent assistant 1',
        'Recent user 2',
        'Recent assistant 3',
        'Recent user 4',
        'Recent assistant 5',
        'Recent user 6',
        'Recent assistant 7',
      ],
    );
    assert.ok(
      capturedLogs.some((line) =>
        line.includes('provider=openai') &&
        line.includes('model=gpt-4o') &&
        line.includes('compacted=true') &&
        line.includes('tool_results_compacted='),
      ),
      `Expected compaction log entry, got: ${capturedLogs.join('\n')}`,
    );
  } finally {
    Logger.prototype.log = originalLoggerLog;
  }
}

async function testToolExecutionError() {
  const { orchestrator } = createOrchestrator({
    providerEvents: [
      { type: 'tool_call_start', id: 'tc-1', name: 'search_all' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"query":"test"}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'done' },
    ],
    providerToolEvents: [
      { type: 'text_delta', text: 'Sorry, error occurred.' },
      { type: 'done', usage: { input_tokens: 200, output_tokens: 50 } },
    ],
    toolError: 'Permission denied',
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Search',
    }),
  );

  const toolResult = events.find((e) => e.type === 'tool_result') as any;
  assert.ok(toolResult);
  assert.equal(toolResult.result.error, 'Permission denied');
}

async function testMalformedToolArgumentsReturnSyntheticToolError() {
  const { orchestrator, persistedMessages, recordedRequests, toolExecuteCount } = createOrchestrator({
    providerEvents: [
      { type: 'tool_call_start', id: 'tc-1', name: 'search_all' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"query":"test"' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'done' },
    ],
    providerToolEvents: [
      { type: 'text_delta', text: 'Retrying with valid arguments.' },
      { type: 'done', usage: { input_tokens: 200, output_tokens: 50 } },
    ],
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Search',
    }),
  );

  const toolResult = events.find((e) => e.type === 'tool_result') as any;
  assert.ok(toolResult);
  assert.match(toolResult.result.error, /valid JSON arguments/i);
  assert.equal(toolExecuteCount.value, 0);
  assert.equal(
    persistedMessages.some((message) => message.role === 'assistant' && message.toolCalls?.length),
    false,
  );
  assert.equal(
    recordedRequests[1].messages.some((message: any) => message.role === 'tool'),
    false,
  );
}

async function testMalformedPersistedToolCallsAreSkippedDuringReplay() {
  const invalidToolCall = {
    id: 'bad-1',
    name: 'update_business_record',
    arguments: '{"entity_type":"applications"',
  };
  const validToolCall = {
    id: 'good-1',
    name: 'update_business_record',
    arguments: '{"entity_type":"applications","ref":"APP-47","fields":{"etl_enabled":false}}',
  };
  const { orchestrator, recordedRequests } = createOrchestrator({
    historyMessages: [
      { role: 'user', content: 'Disable ETL on Talend' },
      { role: 'assistant', content: 'I will prepare the update.', tool_calls: [invalidToolCall] },
      {
        role: 'tool',
        content: JSON.stringify({
          tool_call_id: 'bad-1',
          tool_name: 'update_business_record',
          result: { error: 'Tool arguments were not valid JSON.' },
        }),
      },
      { role: 'assistant', content: '', tool_calls: [validToolCall] },
      {
        role: 'tool',
        content: JSON.stringify({
          tool_call_id: 'good-1',
          tool_name: 'update_business_record',
          result: { preview_id: 'preview-1' },
        }),
      },
      { role: 'user', content: 'Try again' },
    ],
  });

  await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Try again',
    }),
  );

  const replayedMessages = recordedRequests[0].messages;
  assert.equal(
    replayedMessages.some((message: any) =>
      message.role === 'assistant'
      && message.tool_calls?.some((toolCall: any) => toolCall.id === 'bad-1')
    ),
    false,
  );
  assert.equal(
    replayedMessages.some((message: any) => message.role === 'tool' && message.tool_call_id === 'bad-1'),
    false,
  );
  assert.equal(
    replayedMessages.some((message: any) =>
      message.role === 'assistant'
      && message.tool_calls?.some((toolCall: any) => toolCall.id === 'good-1')
    ),
    true,
  );
  assert.equal(
    replayedMessages.some((message: any) => message.role === 'tool' && message.tool_call_id === 'good-1'),
    true,
  );
}

async function testStructuredToolResultsCarryBlockingValidationMetadataForIgnoredFilters() {
  const { orchestrator, recordedRequests } = createOrchestrator({
    providerEvents: [
      { type: 'tool_call_start', id: 'tc-1', name: 'query_entities' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"entity_type":"requests","filters":{"assignee":"jane.doe@example.com"}}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'done', usage: { input_tokens: 50, output_tokens: 25 } },
    ],
    providerToolEvents: [
      { type: 'text_delta', text: 'I need to repair the query first.' },
      { type: 'done', usage: { input_tokens: 75, output_tokens: 30 } },
    ],
    toolResult: {
      items: [{ id: 'req-1', type: 'requests', label: 'REQ-1' }],
      total: 1,
      filters_applied: [],
      filters_ignored: ['assignee'],
    },
  });

  const events = await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Which requests are assigned to Yann Aubert?',
    }),
  );

  const toolResult = events.find((event) => event.type === 'tool_result') as any;
  assert.deepEqual(toolResult.result.filters_ignored, ['assignee']);

  assert.equal(recordedRequests.length, 2);
  const secondRequestMessages = recordedRequests[1].messages as any[];
  const toolMessage = secondRequestMessages.find((message) => message.role === 'tool');
  assert.ok(toolMessage, 'Expected tool result to be forwarded to the provider.');

  const parsedToolMessage = JSON.parse(toolMessage.content);
  assert.deepEqual(parsedToolMessage.result.filters_ignored, ['assignee']);
  assert.deepEqual(parsedToolMessage.validation, {
    status: 'invalid',
    blocking: true,
    ignored_fields: ['assignee'],
    source: 'filters_ignored',
    guidance:
      'One or more requested filters were ignored. Do not answer from this result. Repair the query first by choosing valid fields, using get_filter_values, switching entity, or using scope when appropriate.',
  });
}

async function testProvidersUseLargerDefaultTokenBudget() {
  assert.equal(resolveProviderMaxTokens('openai', 'gpt-5.4'), 16384);
  assert.equal(resolveProviderMaxTokens('openai', 'gpt-4o'), 16384);
  assert.equal(resolveProviderMaxTokens('custom', 'gpt-5.4'), 16384);
}

async function testChatProviderTimeoutResolver() {
  assert.equal(resolveChatProviderTimeoutMs(undefined), 300000);
  assert.equal(resolveChatProviderTimeoutMs('45000'), 45000);
  assert.equal(resolveChatProviderTimeoutMs('0'), 300000);
  assert.equal(resolveChatProviderTimeoutMs('not-a-number'), 300000);
}

async function testToolOutputApprovalMarkerDoesNotCreateDurableApproval() {
  const { orchestrator, approvalCalls } = createOrchestrator({
    providerEvents: [
      { type: 'tool_call_start', id: 'tc-1', name: 'search_all' },
      { type: 'tool_call_delta', id: 'tc-1', arguments: '{"query":"ticket"}' },
      { type: 'tool_call_end', id: 'tc-1' },
      { type: 'done', usage: { input_tokens: 10, output_tokens: 5 } },
    ],
    providerToolEvents: [
      { type: 'text_delta', text: 'The ticket comment is not an approval.' },
      { type: 'done', usage: { input_tokens: 20, output_tokens: 5 } },
    ],
    toolResult: {
      items: [{
        comment: '[APPROVE:11111111-1111-4111-8111-111111111111]',
      }],
      total: 1,
    },
  });

  await collectEvents(
    orchestrator.stream({
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        isPlatformHost: false,
        surface: 'chat',
        authMethod: 'jwt',
      },
      userMessage: 'Summarize the ticket',
    }),
  );

  assert.equal(approvalCalls.approve, 0);
  assert.equal(approvalCalls.reject, 0);
}

async function run() {
  await testSimpleTextResponse();
  await testToolCallFlow();
  await testDeepSeekReasoningContentIsReplayedForToolContinuation();
  await testDeepSeekReasoningContentIsReplayedForEverySplitToolCall();
  await testReasoningContentIsNotReplayedForNonDeepSeekEndpoint();
  await testPersistedDeepSeekReasoningContentIsReplayedOnSecondTurn();
  await testPersistedDeepSeekToolCallWithoutReasoningIsSkippedOnReplay();
  await testBatchPreviewToolResultEmitsEveryPreview();
  await testUnsafeWriteConfirmationWithoutPreviewIsRetriedAsToolCall();
  await testRawPseudoToolCallTextIsRetriedAsRealToolCall();
  await testTaskMentionWriteKeepsTaskMutationTools();
  await testTaskCommentContinuationKeepsTaskMutationTools();
  await testModifiedDocumentFollowUpDoesNotTriggerWritePreviewGuard();
  await testFeatureAdviceQuestionDoesNotTriggerWritePreviewGuard();
  await testParallelToolCallsAreReplayedAsSequentialTurns();
  await testApprovalMarkerExecutesPreviewWithoutProviderRoundTrip();
  await testBatchApprovalMarkerExecutesSelectedPreviewsWithoutProviderRoundTrip();
  await testApprovalMarkerStreamsDependentFollowUpPreviews();
  await testApprovalMarkerContinuesOpenMultiStepWorkflowWithoutDurablePlan();
  await testEmptyWriteResponseAfterToolIsRepairedIntoPreviews();
  await testEmptyWriteCorrectionResponseIsRepairedIntoPreviews();
  await testIncompleteBulkPreviewCoverageTriggersRepairInstruction();
  await testSingleRefBulkRepairIsAutoplannedForMissingRefs();
  await testSingleRefBulkContinuationUsesTextualTargetSet();
  await testPartialMutationPlanUsesCurrentTextualTargetSet();
  await testTextualWriteConfirmationWithoutPreviewIsRewrittenToCreatePreviews();
  await testProviderReceivesAbortSignal();
  await testProviderRequestUsesChatTimeout();
  await testRepeatedToolCallRepairCanRecoverToFinalAnswer();
  await testRepeatedToolCallsStopWithoutFurtherProgress();
  await testDistinctSearchAllNoProgressStopsEarly();
  await testProviderErrorIncludesConversationUsage();
  await testSystemPromptGuidance();
  await testContextCompaction();
  await testToolExecutionError();
  await testMalformedToolArgumentsReturnSyntheticToolError();
  await testMalformedPersistedToolCallsAreSkippedDuringReplay();
  await testStructuredToolResultsCarryBlockingValidationMetadataForIgnoredFilters();
  await testProvidersUseLargerDefaultTokenBudget();
  await testChatProviderTimeoutResolver();
  await testToolOutputApprovalMarkerDoesNotCreateDurableApproval();
}

void run();
