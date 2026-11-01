import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  AiProviderAdapter,
  AiProviderDescriptor,
  AiProviderSettingsSnapshot,
  AiReasoningEffort,
  AiStreamEvent,
  AiStreamParams,
} from './ai-provider.types';
import { isAbortError, parseToolCallArguments } from './streaming.util';
import { LlmCacheCostFactors } from '../ai-llm-cost.util';
import { describeProviderError, providerFetchOptions, toProviderError } from './provider-http.util';
import { anthropicModelSupportsEffort, reasoningEffortToSend } from './reasoning-effort.capability';

// Which models take which effort lives in reasoning-effort.capability.ts; a level the model does
// not accept is not sent (the configuration refuses it, and the usage records what was sent).
export { anthropicModelSupportsEffort };

export function anthropicOutputConfig(
  model: string,
  effort: AiReasoningEffort | null | undefined,
): { output_config: { effort: AiReasoningEffort } } | Record<string, never> {
  const sent = reasoningEffortToSend('anthropic', model, effort);
  return sent ? { output_config: { effort: sent } } : {};
}

// Anthropic's 5-minute ephemeral cache (the `cache_control` below): a read costs 0.1 and a write 1.25 times the input price.
export const ANTHROPIC_CACHE_COST_FACTORS: LlmCacheCostFactors = { read: 0.1, write: 1.25 };

/**
 * The system prompt as Anthropic text blocks. The request renders tools, then system, then
 * messages; an explicit breakpoint at the end of the cacheable prefix caches the tools and the
 * fixed part of the prompt, which the next turn and the next conversation read even though the
 * rest (the person, the clock) differs. With the automatic breakpoint on the last message, a
 * request uses two of the four breakpoints Anthropic allows.
 */
export function anthropicSystemBlocks(
  systemPrompt: string,
  cacheablePrefix: string | undefined,
): string | Anthropic.TextBlockParam[] {
  if (!cacheablePrefix || !systemPrompt.startsWith(cacheablePrefix)) {
    return systemPrompt;
  }
  const rest = systemPrompt.slice(cacheablePrefix.length).replace(/^\s+/, '');
  return [
    { type: 'text', text: cacheablePrefix, cache_control: { type: 'ephemeral' } },
    ...(rest ? [{ type: 'text' as const, text: rest }] : []),
  ];
}

@Injectable()
export class AnthropicAiProviderAdapter implements AiProviderAdapter {
  private readonly logger = new Logger(AnthropicAiProviderAdapter.name);

  readonly cacheCostFactors = ANTHROPIC_CACHE_COST_FACTORS;

  readonly descriptor: AiProviderDescriptor = {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Anthropic Messages API with streaming and tool calling.',
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      requiresApiKey: true,
      allowsCustomEndpoint: false,
      contextWindow: 200000,
    },
  };

  validateConfiguration(settings: AiProviderSettingsSnapshot): string[] {
    const errors: string[] = [];
    if (!settings.has_llm_api_key) errors.push('API key is required.');
    if (!settings.llm_model) errors.push('Model is required.');
    return errors;
  }

  async *createStream(params: AiStreamParams): AsyncGenerator<AiStreamEvent> {
    if (params.signal?.aborted) {
      return;
    }

    const fetchOptions = providerFetchOptions();
    const client = new Anthropic({
      apiKey: params.apiKey || '',
      timeout: params.timeoutMs ?? 120_000,
      maxRetries: params.maxRetries ?? 2,
      ...(fetchOptions ? { fetchOptions } : {}),
    });

    const messages: Anthropic.MessageParam[] = [];
    for (const msg of params.messages) {
      if (msg.role === 'user') {
        const hasImages = Array.isArray(msg.images) && msg.images.length > 0;
        if (hasImages) {
          const blocks: Anthropic.ContentBlockParam[] = [];
          for (const img of msg.images!) {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: (img.mime_type || 'image/png') as Anthropic.Base64ImageSource['media_type'],
                data: img.base64_data,
              },
            });
          }
          if (msg.content) {
            blocks.push({ type: 'text', text: msg.content });
          }
          messages.push({ role: 'user', content: blocks });
        } else {
          messages.push({ role: 'user', content: msg.content });
        }
      } else if (msg.role === 'assistant') {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        if (msg.tool_calls?.length) {
          for (const tc of msg.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: parseToolCallArguments(tc.arguments),
            });
          }
        }
        messages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id || '',
              content: msg.content,
            },
          ],
        });
      }
    }

    const tools: Anthropic.Tool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const stream = client.messages.stream({
      model: params.model,
      max_tokens: params.maxTokens,
      system: anthropicSystemBlocks(params.systemPrompt, params.systemPromptCacheablePrefix),
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...anthropicOutputConfig(params.model, params.reasoningEffort),
      // Automatic prompt caching: the breakpoint follows the last block, so each tool
      // round reads the system prompt, tools and history written by the previous one.
      cache_control: { type: 'ephemeral' },
    }, params.signal ? { signal: params.signal } : undefined);
    if (params.debugTrace) {
      yield { type: 'debug_trace', name: 'provider_stream_opened' };
    }

    let currentToolId: string | null = null;
    let currentToolName: string | null = null;
    let firstRawChunkSeen = false;
    let firstTextDeltaSeen = false;
    let firstToolDeltaSeen = false;

    try {
      for await (const event of stream) {
        if (params.debugTrace && !firstRawChunkSeen) {
          firstRawChunkSeen = true;
          yield { type: 'debug_trace', name: 'provider_first_raw_chunk' };
        }

        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'tool_use') {
              currentToolId = block.id;
              currentToolName = block.name;
              if (params.debugTrace && !firstToolDeltaSeen) {
                firstToolDeltaSeen = true;
                yield {
                  type: 'debug_trace',
                  name: 'provider_first_tool_delta',
                  tool_name: block.name,
                };
              }
              yield { type: 'tool_call_start', id: block.id, name: block.name };
            }
            break;
          }
          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              if (params.debugTrace && !firstTextDeltaSeen) {
                firstTextDeltaSeen = true;
                yield { type: 'debug_trace', name: 'provider_first_text_delta' };
              }
              yield { type: 'text_delta', text: delta.text };
            } else if (delta.type === 'input_json_delta' && currentToolId) {
              if (params.debugTrace && !firstToolDeltaSeen) {
                firstToolDeltaSeen = true;
                yield {
                  type: 'debug_trace',
                  name: 'provider_first_tool_delta',
                  tool_name: currentToolName,
                };
              }
              yield { type: 'tool_call_delta', id: currentToolId, arguments: delta.partial_json };
            }
            break;
          }
          case 'content_block_stop': {
            if (currentToolId) {
              if (params.debugTrace) {
                yield {
                  type: 'debug_trace',
                  name: 'provider_tool_call_completed',
                  tool_name: currentToolName,
                };
              }
              yield { type: 'tool_call_end', id: currentToolId };
              currentToolId = null;
              currentToolName = null;
            }
            break;
          }
          case 'message_delta': {
            if (event.delta?.stop_reason === 'end_turn' || event.delta?.stop_reason === 'tool_use') {
              // Usage comes from message_delta
            }
            break;
          }
          default:
            break;
        }
      }
    } catch (error) {
      if (params.signal?.aborted || isAbortError(error)) {
        return;
      }
      throw toProviderError(error);
    }

    if (params.signal?.aborted) {
      return;
    }

    try {
      const finalMessage = await stream.finalMessage();
      const uncachedInput = finalMessage.usage?.input_tokens ?? 0;
      const cacheWrite = finalMessage.usage?.cache_creation_input_tokens ?? 0;
      const cacheRead = finalMessage.usage?.cache_read_input_tokens ?? 0;
      const outputTokens = finalMessage.usage?.output_tokens ?? 0;
      this.logger.log(
        `model=${params.model} input_uncached=${uncachedInput} cache_write=${cacheWrite} `
        + `cache_read=${cacheRead} output=${outputTokens}`,
      );
      yield {
        type: 'done',
        usage: {
          // The whole prompt, cached or not: callers read input_tokens as the prompt size.
          input_tokens: uncachedInput + cacheWrite + cacheRead,
          output_tokens: outputTokens,
          cache_read_input_tokens: cacheRead,
          cache_write_input_tokens: cacheWrite,
        },
        // Normalise Anthropic's stop_reason to the OpenAI-style finish_reason the
        // structured-JSON helper inspects: a max_tokens stop is a length truncation.
        finish_reason: finalMessage.stop_reason === 'max_tokens'
          ? 'length'
          : (finalMessage.stop_reason ?? undefined),
      };
    } catch (error) {
      if (params.signal?.aborted || isAbortError(error)) {
        return;
      }
      yield {
        type: 'error',
        message: describeProviderError(error),
      };
    }
  }
}
