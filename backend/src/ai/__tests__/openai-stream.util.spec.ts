import * as assert from 'node:assert/strict';

// The stream checks a tenant endpoint before the call (multi-tenant mode). The
// endpoints below are stand-ins for the fake SDK: allowlisted, so none of them
// is resolved.
process.env.SSRF_ALLOWED_HOSTS = 'api.deepseek.com,openrouter.ai,local-llm.test,openrouter.example';

const Module = require('node:module');
const originalLoad = Module._load;

const state: {
  requests: any[];
  chunks: any[];
  createErrors: any[];
} = {
  requests: [],
  chunks: [],
  createErrors: [],
};

Module._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === 'openai') {
    return {
      default: class FakeOpenAI {
        constructor() {
          return {
            chat: {
              completions: {
                create: async (payload: any) => {
                  state.requests.push({ ...payload });
                  const error = state.createErrors.shift();
                  if (error) {
                    throw error;
                  }
                  return {
                    async *[Symbol.asyncIterator]() {
                      for (const chunk of state.chunks) {
                        if (chunk instanceof Error) {
                          throw chunk;
                        }
                        yield chunk;
                      }
                    },
                  };
                },
              },
            },
          };
        }
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  getOpenAiSystemPromptRole,
  isOpenAiReasoningModel,
  openaiCompatibleStream,
} = require('../providers/openai-stream.util');

Module._load = originalLoad;

async function collectEvents(gen: AsyncGenerator<any>) {
  const events: any[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function resetState(chunks: any[]) {
  state.requests.length = 0;
  state.chunks = chunks;
  state.createErrors = [];
}

async function testReasoningModelsPreferDeveloperRole() {
  resetState([
    {
      choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }],
    },
  ]);

  const events = await collectEvents(openaiCompatibleStream({
    providerId: 'openai',
    model: 'gpt-5.4',
    apiKey: 'test-key',
    endpointUrl: null,
    systemPrompt: 'Be precise.',
    systemPromptRole: 'developer',
    messages: [{ role: 'user', content: 'Hello' }],
    tools: [],
    maxTokens: 128,
  }));

  assert.equal(state.requests[0].messages[0].role, 'developer');
  assert.equal(state.requests[0].max_completion_tokens, 128);
  assert.equal(state.requests[0].parallel_tool_calls, undefined);
  assert.equal(events.at(-1)?.type, 'done');
}

async function testLengthFinishReasonWithPendingToolCallEmitsError() {
  resetState([
    {
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'tc-1', function: { name: 'search_all' } }],
        },
        finish_reason: null,
      }],
    },
    {
      choices: [{
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '{"query":"crm"' } }],
        },
        finish_reason: 'length',
      }],
    },
  ]);

  const events = await collectEvents(openaiCompatibleStream({
    providerId: 'openai',
    model: 'gpt-5.4',
    apiKey: 'test-key',
    endpointUrl: null,
    systemPrompt: 'Use tools.',
    systemPromptRole: 'developer',
    messages: [{ role: 'user', content: 'Search for CRM' }],
    tools: [{ name: 'search_all', description: 'Search', parameters: { type: 'object' } }],
    maxTokens: 128,
  }));

  assert.deepEqual(events, [
    { type: 'error', message: 'Model output was truncated before the tool call completed.' },
  ]);
  assert.equal(state.requests[0].parallel_tool_calls, false);
}

async function testCompletedNativeToolCallIsEmitted() {
  resetState([
    {
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 'tc-1', function: { name: 'search_all' } }],
        },
        finish_reason: null,
      }],
    },
    {
      choices: [{
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '{"query":"crm"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
    },
  ]);

  const events = await collectEvents(openaiCompatibleStream({
    providerId: 'openai',
    model: 'gpt-5.4',
    apiKey: 'test-key',
    endpointUrl: null,
    systemPrompt: 'Use tools.',
    systemPromptRole: 'developer',
    messages: [{ role: 'user', content: 'Search for CRM' }],
    tools: [{ name: 'search_all', description: 'Search', parameters: { type: 'object' } }],
    maxTokens: 128,
  }));

  assert.deepEqual(events, [
    { type: 'tool_call_start', id: 'tc-1', name: 'search_all' },
    { type: 'tool_call_delta', id: 'tc-1', arguments: '{"query":"crm"}' },
    { type: 'tool_call_end', id: 'tc-1' },
    { type: 'done', usage: undefined, finish_reason: 'tool_calls' },
  ]);
  assert.equal(state.requests[0].parallel_tool_calls, false);
}

async function testReasoningContentDeltasAreEmittedButNotText() {
  resetState([
    {
      choices: [{
        delta: { reasoning_content: 'private reasoning' },
        finish_reason: null,
      }],
    },
    {
      choices: [{ delta: { content: 'public answer' }, finish_reason: 'stop' }],
    },
  ]);

  const events = await collectEvents(openaiCompatibleStream({
    providerId: 'custom',
    model: 'deepseek-v4-pro',
    apiKey: 'test-key',
    endpointUrl: 'https://api.deepseek.com',
    systemPrompt: 'Use tools.',
    messages: [{ role: 'user', content: 'Hello' }],
    tools: [],
    maxTokens: 128,
  }));

  assert.deepEqual(events, [
    { type: 'reasoning_delta', text: 'private reasoning' },
    { type: 'text_delta', text: 'public answer' },
    { type: 'done', usage: undefined, finish_reason: 'stop' },
  ]);
}

async function testAssistantReasoningContentIsPassedThroughWhenPresent() {
  resetState([
    {
      choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }],
    },
  ]);

  await collectEvents(openaiCompatibleStream({
    providerId: 'custom',
    model: 'deepseek-v4-pro',
    apiKey: 'test-key',
    endpointUrl: 'https://api.deepseek.com',
    systemPrompt: 'Use tools.',
    messages: [{
      role: 'assistant',
      content: '',
      reasoning_content: 'previous reasoning',
      tool_calls: [{ id: 'tc-1', name: 'search_all', arguments: '{"query":"crm"}' }],
    }],
    tools: [],
    maxTokens: 128,
  }));

  assert.equal(state.requests[0].messages[1].reasoning_content, 'previous reasoning');
}

async function testAssistantReasoningContentIsNotSentToOtherEndpoints() {
  resetState([
    {
      choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }],
    },
  ]);

  await collectEvents(openaiCompatibleStream({
    providerId: 'custom',
    model: 'deepseek-v4-pro',
    apiKey: 'test-key',
    endpointUrl: 'https://openrouter.ai/api/v1',
    systemPrompt: 'Use tools.',
    messages: [{
      role: 'assistant',
      content: '',
      reasoning_content: 'previous reasoning',
      tool_calls: [{ id: 'tc-1', name: 'search_all', arguments: '{"query":"crm"}' }],
    }],
    tools: [],
    maxTokens: 128,
  }));

  assert.equal(Object.prototype.hasOwnProperty.call(state.requests[0].messages[1], 'reasoning_content'), false);
}

async function testUnsupportedParallelToolCallsFallback() {
  resetState([
    {
      choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }],
    },
  ]);
  const unsupportedError = new Error('Unknown parameter: parallel_tool_calls') as Error & { status?: number };
  unsupportedError.status = 400;
  state.createErrors = [unsupportedError];

  const events = await collectEvents(openaiCompatibleStream({
    providerId: 'custom',
    model: 'qwen',
    apiKey: 'test-key',
    endpointUrl: 'http://local-llm.test/v1',
    systemPrompt: 'Use tools.',
    messages: [{ role: 'user', content: 'Search for CRM' }],
    tools: [{ name: 'search_all', description: 'Search', parameters: { type: 'object' } }],
    maxTokens: 128,
  }));

  assert.equal(state.requests.length, 2);
  assert.equal(state.requests[0].parallel_tool_calls, false);
  assert.equal(Object.prototype.hasOwnProperty.call(state.requests[1], 'parallel_tool_calls'), false);
  assert.equal(events.at(-1)?.type, 'done');
}

async function testXmlStyleToolCallCreateErrorIsRecovered() {
  resetState([]);
  state.createErrors = [
    new Error(
      'Failed to parse input at pos 1212: <tool_call> <function=get_entity_detail> <parameter=entity_id> 886238bf-08e2-4bba-bae5-d2085920d121 </parameter> <parameter=entity_type> capex_items </parameter> </function> </tool_call>',
    ),
  ];

  const events = await collectEvents(openaiCompatibleStream({
    providerId: 'custom',
    model: 'qwen3.6-27b',
    apiKey: 'test-key',
    endpointUrl: 'http://local-llm.test/v1',
    systemPrompt: 'Use tools.',
    messages: [{ role: 'user', content: 'Show CAPEX details' }],
    tools: [{ name: 'get_entity_detail', description: 'Details', parameters: { type: 'object' } }],
    maxTokens: 128,
  }));

  assert.deepEqual(events, [
    { type: 'tool_call_start', id: 'xml-tool-call-1', name: 'get_entity_detail' },
    {
      type: 'tool_call_delta',
      id: 'xml-tool-call-1',
      arguments: JSON.stringify({
        entity_id: '886238bf-08e2-4bba-bae5-d2085920d121',
        entity_type: 'capex_items',
      }),
    },
    { type: 'tool_call_end', id: 'xml-tool-call-1' },
  ]);
}

async function testXmlStyleToolCallStreamErrorIsRecovered() {
  resetState([
    new Error(
      'Failed to parse input at pos 5857: <tool_call> <function=search_all> <parameter=query> Remplacement infra Duppigheim </parameter> <parameter=entity_types> ["tasks", "documents"] </parameter> </function> </tool_call>',
    ),
  ]);

  const events = await collectEvents(openaiCompatibleStream({
    providerId: 'custom',
    model: 'qwen3.6-27b',
    apiKey: 'test-key',
    endpointUrl: 'http://local-llm.test/v1',
    systemPrompt: 'Use tools.',
    messages: [{ role: 'user', content: 'Search related work' }],
    tools: [{ name: 'search_all', description: 'Search', parameters: { type: 'object' } }],
    maxTokens: 128,
  }));

  assert.deepEqual(events, [
    { type: 'tool_call_start', id: 'xml-tool-call-1', name: 'search_all' },
    {
      type: 'tool_call_delta',
      id: 'xml-tool-call-1',
      arguments: JSON.stringify({
        query: 'Remplacement infra Duppigheim',
        entity_types: ['tasks', 'documents'],
      }),
    },
    { type: 'tool_call_end', id: 'xml-tool-call-1' },
  ]);
}

async function testXmlStyleToolCallStreamErrorDiscardsPartialNativeToolCall() {
  resetState([
    {
      choices: [{
        delta: {
          content: 'I will prepare the update.',
          tool_calls: [{ index: 0, id: 'native-1', function: { name: 'update_business_record' } }],
        },
        finish_reason: null,
      }],
    },
    {
      choices: [{
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '{"entity_type":"applications"' } }],
        },
        finish_reason: null,
      }],
    },
    new Error(
      'Failed to parse tool call arguments as JSON: <tool_call> <function=update_business_record> <parameter=entity_type> applications </parameter> <parameter=ref> APP-47 </parameter> <parameter=fields> {"etl_enabled":false} </parameter> </function> </tool_call>',
    ),
  ]);

  const events = await collectEvents(openaiCompatibleStream({
    providerId: 'custom',
    model: 'qwen3.6-27b',
    apiKey: 'test-key',
    endpointUrl: 'http://local-llm.test/v1',
    systemPrompt: 'Use tools.',
    messages: [{ role: 'user', content: 'Disable ETL on Talend' }],
    tools: [{ name: 'update_business_record', description: 'Update', parameters: { type: 'object' } }],
    maxTokens: 128,
  }));

  assert.deepEqual(events, [
    { type: 'text_delta', text: 'I will prepare the update.' },
    { type: 'tool_call_start', id: 'xml-tool-call-1', name: 'update_business_record' },
    {
      type: 'tool_call_delta',
      id: 'xml-tool-call-1',
      arguments: JSON.stringify({
        entity_type: 'applications',
        ref: 'APP-47',
        fields: { etl_enabled: false },
      }),
    },
    { type: 'tool_call_end', id: 'xml-tool-call-1' },
  ]);
}

async function testReasoningModelHelpers() {
  assert.equal(isOpenAiReasoningModel('gpt-5.4'), true);
  assert.equal(isOpenAiReasoningModel('o3'), true);
  assert.equal(isOpenAiReasoningModel('gpt-4o'), false);
  assert.equal(getOpenAiSystemPromptRole('gpt-5.4'), 'developer');
  assert.equal(getOpenAiSystemPromptRole('gpt-4o'), 'system');
}

async function testReasoningEffortIsSentOnlyWhenRequested() {
  const baseParams = {
    providerId: 'custom',
    model: 'xiaomi/mimo-v2.5',
    apiKey: 'test-key',
    endpointUrl: 'https://openrouter.example/api/v1',
    systemPrompt: 'Be precise.',
    messages: [{ role: 'user', content: 'Hello' }],
    tools: [],
    maxTokens: 128,
  };

  resetState([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
  await collectEvents(openaiCompatibleStream({ ...baseParams, reasoningEffort: 'low' }));
  assert.equal(state.requests[0].reasoning_effort, 'low');

  // Tenant-provided configurations never set the field — the request must not carry it.
  resetState([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
  await collectEvents(openaiCompatibleStream({ ...baseParams }));
  assert.equal('reasoning_effort' in state.requests[0], false);

  resetState([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
  await collectEvents(openaiCompatibleStream({ ...baseParams, reasoningEffort: null }));
  assert.equal('reasoning_effort' in state.requests[0], false);
}

async function run() {
  await testReasoningModelsPreferDeveloperRole();
  await testLengthFinishReasonWithPendingToolCallEmitsError();
  await testCompletedNativeToolCallIsEmitted();
  await testReasoningContentDeltasAreEmittedButNotText();
  await testAssistantReasoningContentIsPassedThroughWhenPresent();
  await testAssistantReasoningContentIsNotSentToOtherEndpoints();
  await testUnsupportedParallelToolCallsFallback();
  await testXmlStyleToolCallCreateErrorIsRecovered();
  await testXmlStyleToolCallStreamErrorIsRecovered();
  await testXmlStyleToolCallStreamErrorDiscardsPartialNativeToolCall();
  await testReasoningModelHelpers();
  await testReasoningEffortIsSentOnlyWhenRequested();
}

void run();
