import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { openValidatedFetch, ValidatedFetchTarget } from '../../common/pinned-fetch';
import { AiStreamEvent, AiStreamParams, AiSystemPromptRole } from './ai-provider.types';
import { isAbortError } from './streaming.util';
import { providerFetchOptions, toProviderError } from './provider-http.util';

const logger = new Logger('OpenAiCompatibleStream');

function toUsage(usage?: { prompt_tokens?: number | null; completion_tokens?: number | null } | null) {
  if (!usage) {
    return undefined;
  }
  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
  };
}

function isUnsupportedParallelToolCallsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybeError = error as { message?: string; status?: number };
  const message = String(maybeError.message || '').toLowerCase();
  return maybeError.status === 400
    && message.includes('parallel_tool_calls')
    && (
      message.includes('unsupported')
      || message.includes('unknown')
      || message.includes('unrecognized')
      || message.includes('extra')
      || message.includes('not permitted')
    );
}

function extractErrorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; error?: unknown; body?: unknown };
    return [
      typeof candidate.message === 'string' ? candidate.message : '',
      typeof candidate.error === 'string' ? candidate.error : '',
      typeof candidate.body === 'string' ? candidate.body : '',
    ].filter(Boolean).join('\n');
  }
  return '';
}

function parseToolParameterValue(rawValue: string): unknown {
  const value = rawValue.trim();
  if (!value) {
    return '';
  }
  if (/^[\[{]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  return value;
}

function parseXmlStyleToolCallsFromText(text: string): Array<{ id: string; name: string; arguments: string }> {
  const calls: Array<{ id: string; name: string; arguments: string }> = [];
  const toolCallPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let toolCallMatch: RegExpExecArray | null;
  let index = 0;

  while ((toolCallMatch = toolCallPattern.exec(text)) !== null) {
    const toolCallBody = toolCallMatch[1] || '';
    const functionMatch = toolCallBody.match(/<function=([A-Za-z0-9_.-]+)>([\s\S]*?)<\/function>/i);
    if (!functionMatch) {
      continue;
    }

    const [, name, functionBody] = functionMatch;
    const args: Record<string, unknown> = {};
    const parameterPattern = /<parameter=([A-Za-z0-9_.-]+)>([\s\S]*?)<\/parameter>/gi;
    let parameterMatch: RegExpExecArray | null;
    while ((parameterMatch = parameterPattern.exec(functionBody || '')) !== null) {
      args[parameterMatch[1]] = parseToolParameterValue(parameterMatch[2] || '');
    }

    calls.push({
      id: `xml-tool-call-${++index}`,
      name,
      arguments: JSON.stringify(args),
    });
  }

  return calls;
}

function shouldReplayReasoningContent(endpointUrl: string | null): boolean {
  if (!endpointUrl) {
    return false;
  }
  try {
    return new URL(endpointUrl).hostname.toLowerCase() === 'api.deepseek.com';
  } catch {
    return false;
  }
}

async function* emitXmlStyleToolCallsFromError(
  error: unknown,
  params: AiStreamParams,
): AsyncGenerator<AiStreamEvent> {
  const parsedCalls = parseXmlStyleToolCallsFromText(extractErrorText(error));
  if (parsedCalls.length === 0) {
    throw toProviderError(error);
  }

  logger.warn(
    `provider=${params.providerId ?? 'unknown'} model=${params.model} recovered_xml_style_tool_calls=${parsedCalls.length}`,
  );

  for (const call of parsedCalls) {
    yield { type: 'tool_call_start', id: call.id, name: call.name };
    yield { type: 'tool_call_delta', id: call.id, arguments: call.arguments };
    yield { type: 'tool_call_end', id: call.id };
  }
}

export function isOpenAiReasoningModel(model: string): boolean {
  const normalized = String(model || '').trim().toLowerCase();
  return normalized.startsWith('gpt-5')
    || normalized.startsWith('o1')
    || normalized.startsWith('o3')
    || normalized.startsWith('o4');
}

export function getOpenAiSystemPromptRole(model: string): AiSystemPromptRole {
  return isOpenAiReasoningModel(model) ? 'developer' : 'system';
}

export async function* openaiCompatibleStream(params: AiStreamParams): AsyncGenerator<AiStreamEvent> {
  // A tenant endpoint is checked here, right before the call, and the SDK then
  // connects to the addresses validated (multi-tenant mode). The dispatcher is
  // released when the stream ends, fails or is abandoned.
  const transport = params.endpointUrl && params.endpointSource !== 'platform'
    ? await openValidatedFetch(params.endpointUrl)
    : null;
  try {
    yield* streamCompletion(params, transport);
  } finally {
    await transport?.close();
  }
}

async function* streamCompletion(
  params: AiStreamParams,
  transport: ValidatedFetchTarget | null,
): AsyncGenerator<AiStreamEvent> {
  const replayReasoningContent = shouldReplayReasoningContent(params.endpointUrl);
  const fetchOptions = providerFetchOptions();
  const client = new OpenAI({
    apiKey: params.apiKey || 'unused',
    ...(params.endpointUrl ? { baseURL: params.endpointUrl } : {}),
    timeout: params.timeoutMs ?? 120_000,
    maxRetries: params.maxRetries ?? 2,
    ...(fetchOptions ? { fetchOptions } : {}),
    ...(transport?.dispatcher ? { fetch: transport.fetch } : {}),
  });

  const tools: OpenAI.ChatCompletionTool[] = params.tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as any,
    },
  }));

  const systemPromptRole = params.systemPromptRole ?? 'system';
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    systemPromptRole === 'developer'
      ? { role: 'developer', content: params.systemPrompt }
      : { role: 'system', content: params.systemPrompt },
  ];

  for (const msg of params.messages) {
    if (msg.role === 'user') {
      const hasImages = Array.isArray(msg.images) && msg.images.length > 0;
      if (hasImages) {
        // OpenAI-compatible vision format: content array with image_url + text parts.
        // Most OpenAI-compatible servers (Qwen-VL, llama.cpp, vLLM, etc.) accept this.
        const parts: OpenAI.ChatCompletionContentPart[] = msg.images!.map((img) => ({
          type: 'image_url' as const,
          image_url: {
            url: `data:${img.mime_type || 'image/png'};base64,${img.base64_data}`,
          },
        }));
        if (msg.content) {
          parts.push({ type: 'text', text: msg.content });
        }
        messages.push({ role: 'user', content: parts });
      } else {
        messages.push({ role: 'user', content: msg.content });
      }
    } else if (msg.role === 'assistant') {
      const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam & { reasoning_content?: string } = {
        role: 'assistant',
        content: msg.content || null,
      };
      if (replayReasoningContent && msg.reasoning_content) {
        assistantMsg.reasoning_content = msg.reasoning_content;
      }
      if (msg.tool_calls?.length) {
        assistantMsg.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      messages.push(assistantMsg);
    } else if (msg.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: msg.tool_call_id || '',
        content: msg.content,
      });
    }
  }

  const request: Record<string, unknown> = {
    model: params.model,
    messages,
    ...(tools.length > 0 ? { tools } : {}),
    stream: true,
  };
  if (tools.length > 0 && params.parallelToolCalls !== true) {
    request.parallel_tool_calls = false;
  }
  request[params.maxTokensParam ?? 'max_completion_tokens'] = params.maxTokens;
  if (params.reasoningEffort) {
    // OpenAI-style field; OpenRouter accepts it as an alias for reasoning.effort.
    request.reasoning_effort = params.reasoningEffort;
  }

  let stream: Awaited<ReturnType<typeof client.chat.completions.create>>;
  try {
    stream = await client.chat.completions.create(
      request as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
      params.signal ? { signal: params.signal } : undefined,
    );
  } catch (error) {
    if (request.parallel_tool_calls === false && isUnsupportedParallelToolCallsError(error)) {
      delete request.parallel_tool_calls;
      try {
        stream = await client.chat.completions.create(
          request as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
          params.signal ? { signal: params.signal } : undefined,
        );
      } catch (retryError) {
        yield* emitXmlStyleToolCallsFromError(retryError, params);
        return;
      }
    } else {
      yield* emitXmlStyleToolCallsFromError(error, params);
      return;
    }
  }
  if (params.debugTrace) {
    yield { type: 'debug_trace', name: 'provider_stream_opened' };
  }

  const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();
  let emittedDone = false;
  let firstRawChunkSeen = false;
  let firstTextDeltaSeen = false;
  let firstToolDeltaSeen = false;

  const emitPendingNativeToolCalls = function* (): Generator<AiStreamEvent> {
    const orderedCalls = [...pendingToolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, pending]) => pending);

    for (const pending of orderedCalls) {
      yield { type: 'tool_call_start', id: pending.id, name: pending.name };
      if (pending.args) {
        yield { type: 'tool_call_delta', id: pending.id, arguments: pending.args };
      }
      yield { type: 'tool_call_end', id: pending.id };
    }
    pendingToolCalls.clear();
  };

  try {
    for await (const chunk of stream) {
      if (params.debugTrace && !firstRawChunkSeen) {
        firstRawChunkSeen = true;
        yield { type: 'debug_trace', name: 'provider_first_raw_chunk' };
      }

      const choice = chunk.choices?.[0];
      if (!choice) {
        continue;
      }

      const delta = choice.delta;
      const reasoningContent = typeof (delta as { reasoning_content?: unknown } | undefined)?.reasoning_content === 'string'
        ? (delta as { reasoning_content: string }).reasoning_content
        : '';
      if (reasoningContent) {
        yield { type: 'reasoning_delta', text: reasoningContent };
      }

      if (delta?.content) {
        if (params.debugTrace && !firstTextDeltaSeen) {
          firstTextDeltaSeen = true;
          yield { type: 'debug_trace', name: 'provider_first_text_delta' };
        }
        yield { type: 'text_delta', text: delta.content };
      }

      if (delta?.tool_calls) {
        if (params.debugTrace && !firstToolDeltaSeen) {
          firstToolDeltaSeen = true;
          yield { type: 'debug_trace', name: 'provider_first_tool_delta' };
        }
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (tc.id) {
            pendingToolCalls.set(idx, { id: tc.id, name: tc.function?.name || '', args: '' });
          }
          if (tc.function?.name) {
            const pending = pendingToolCalls.get(idx);
            if (pending && !pending.name) {
              pending.name = tc.function.name;
            }
          }
          if (tc.function?.arguments) {
            const pending = pendingToolCalls.get(idx);
            if (pending) {
              pending.args += tc.function.arguments;
            } else {
              logger.warn(
                `provider=${params.providerId ?? 'unknown'} model=${params.model} tool_call_arguments_without_id index=${idx}`,
              );
            }
          }
        }
      }

      if (choice.finish_reason === 'length') {
        logger.warn(
          `provider=${params.providerId ?? 'unknown'} model=${params.model} finish_reason=length pending_tool_calls=${pendingToolCalls.size}`,
        );
        if (pendingToolCalls.size > 0) {
          yield {
            type: 'error',
            message: 'Model output was truncated before the tool call completed.',
          };
          return;
        }
        yield { type: 'done', usage: toUsage(chunk.usage), finish_reason: 'length' };
        emittedDone = true;
        continue;
      }

      if (choice.finish_reason && !['tool_calls', 'stop', 'function_call'].includes(choice.finish_reason)) {
        logger.warn(
          `provider=${params.providerId ?? 'unknown'} model=${params.model} finish_reason=${choice.finish_reason} pending_tool_calls=${pendingToolCalls.size}`,
        );
      }

      if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop' || choice.finish_reason === 'function_call') {
        if (params.debugTrace && (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call')) {
          for (const pending of [...pendingToolCalls.values()]) {
            yield {
              type: 'debug_trace',
              name: 'provider_tool_call_completed',
              tool_name: pending.name || null,
            };
          }
        }
        yield* emitPendingNativeToolCalls();

        yield {
          type: 'done',
          usage: toUsage(chunk.usage),
          finish_reason: choice.finish_reason,
        };
        emittedDone = true;
      }
    }
  } catch (error) {
    if (params.signal?.aborted || isAbortError(error)) {
      return;
    }
    yield* emitXmlStyleToolCallsFromError(error, params);
    return;
  }

  // Ensure done is always emitted even if no finish_reason was seen
  if (!emittedDone) {
    if (pendingToolCalls.size > 0) {
      logger.warn(
        `provider=${params.providerId ?? 'unknown'} model=${params.model} stream_ended_without_finish_reason pending_tool_calls=${pendingToolCalls.size}`,
      );
      yield {
        type: 'error',
        message: 'Model output ended before the tool call completed.',
      };
      return;
    }
    yield { type: 'done' };
  }
}
