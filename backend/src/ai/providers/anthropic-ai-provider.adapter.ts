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
import { describeProviderError, providerFetchOptions, toProviderError } from './provider-http.util';

// Models that accept `output_config.effort`: Opus 4.5 and later, Sonnet 4.6 and later,
// Fable and Mythos. Haiku, Sonnet 4.5 and older models reject the field with a 400.
export function anthropicModelSupportsEffort(model: string): boolean {
  const id = model.trim().toLowerCase().replace(/^anthropic\./, '');
  if (/^claude-(fable|mythos)-/.test(id)) return true;
  const match = /^claude-(opus|sonnet)-(\d+)(?:-(\d+))?/.exec(id);
  if (!match) return false;
  const major = Number(match[2]);
  // A long numeric suffix is a snapshot date (claude-opus-4-20250514), not a minor version.
  const minor = match[3] && match[3].length <= 2 ? Number(match[3]) : 0;
  const version = major + minor / 10;
  return match[1] === 'opus' ? version >= 4.5 : version >= 4.6;
}

export function anthropicOutputConfig(
  model: string,
  effort: AiReasoningEffort | null | undefined,
): { output_config: { effort: AiReasoningEffort } } | Record<string, never> {
  return effort && anthropicModelSupportsEffort(model) ? { output_config: { effort } } : {};
}

@Injectable()
export class AnthropicAiProviderAdapter implements AiProviderAdapter {
  private readonly logger = new Logger(AnthropicAiProviderAdapter.name);

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
      system: params.systemPrompt,
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
