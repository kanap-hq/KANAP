import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { assertPublicHttpTarget } from '../../../common/ssrf-guard';
import { AiExecutionContextWithManager } from '../../ai.types';
import { LlmTokenPrices } from '../../ai-llm-cost.util';
import { AiModelResolverService } from '../../ai-model-resolver.service';
import { BUILTIN_REASONING_EFFORT } from '../../platform/platform-ai-config.service';
import { AiProviderRegistry } from '../../providers/ai-provider-registry.service';
import { AiProviderAdapter, AiProviderId, AiProviderImageAttachment, AiStreamEvent } from '../../providers/ai-provider.types';

export type AgentLlmRuntime = {
  source: 'builtin' | 'custom';
  provider: AiProviderAdapter;
  providerId: string;
  model: string;
  apiKey: string | null;
  endpointUrl: string | null;
  // Registry entry backing this runtime; null on the builtin path.
  modelConfigId: string | null;
  supportsVision: boolean;
  // Per-model timeout; null falls back to the caller's per-stage env default.
  modelTimeoutMs: number | null;
  // €/Mtok prices of the resolved model; null/0 = free (local, self-hosted, builtin).
  priceInputEurPerMtok: number | null;
  priceOutputEurPerMtok: number | null;
};

export type AgentJsonModelResult = {
  text: string;
  runtime: AgentLlmRuntime;
  usage: { input_tokens: number; output_tokens: number } | null;
  latencyMs: number;
  // Provider finish reason for the completion ('length' = truncated at max_tokens,
  // 'stop' = natural end, etc.). null when the provider did not report one.
  finishReason: string | null;
  // True when the per-call timeout aborted the stream before the model finished.
  // Provider adapters end the stream silently on abort, so without this flag a
  // timeout is indistinguishable from a genuine empty/partial model response.
  timedOut: boolean;
  timeoutMs: number;
};

export type AgentStructuredJsonFailureKind = 'empty_body' | 'invalid_json' | 'schema_invalid' | 'truncated' | 'timeout';

export type AgentStructuredJsonFailure = {
  kind: AgentStructuredJsonFailureKind;
  message: string;
};

export type AgentStructuredJsonAttempt = {
  attempt: number;
  text: string | null;
  usage: AgentJsonModelResult['usage'];
  latencyMs: number;
  failure: AgentStructuredJsonFailure | null;
};

export type AgentStructuredJsonMetadata = {
  taskName: string;
  retry_attempted: boolean;
  json_parse_failed: boolean;
  json_retry_attempted: boolean;
  json_retry_failed: boolean;
  attempts: AgentStructuredJsonAttempt[];
  failure: AgentStructuredJsonFailure | null;
};

export type AgentStructuredJsonModelSuccess<T> = {
  ok: true;
  value: T;
  text: string;
  runtime: AgentLlmRuntime;
  usage: AgentJsonModelResult['usage'];
  latencyMs: number;
  metadata: AgentStructuredJsonMetadata;
};

export type AgentStructuredJsonModelFailure = {
  ok: false;
  value: null;
  text: string | null;
  runtime: AgentLlmRuntime | null;
  usage: AgentJsonModelResult['usage'];
  latencyMs: number;
  metadata: AgentStructuredJsonMetadata;
};

export type AgentStructuredJsonModelResult<T> =
  | AgentStructuredJsonModelSuccess<T>
  | AgentStructuredJsonModelFailure;

export function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function aggregateUsage(
  left: AgentJsonModelResult['usage'],
  right: AgentJsonModelResult['usage'],
): AgentJsonModelResult['usage'] {
  if (!left) return right;
  if (!right) return left;
  return {
    input_tokens: left.input_tokens + right.input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
  };
}

function formatStructuredJsonError(error: unknown): AgentStructuredJsonFailure {
  if (error instanceof SyntaxError) {
    return { kind: 'invalid_json', message: error.message };
  }
  if (error instanceof z.ZodError) {
    return { kind: 'schema_invalid', message: error.issues.slice(0, 4).map((issue) => issue.message).join('; ') };
  }
  return { kind: 'invalid_json', message: error instanceof Error ? error.message : String(error || 'Invalid JSON.') };
}

function parseStructuredJson<T>(text: string, schema: z.ZodType<T>): { value: T } | { failure: AgentStructuredJsonFailure } {
  const normalized = stripJsonFence(text);
  if (!normalized.trim()) {
    return { failure: { kind: 'empty_body', message: 'Model returned an empty JSON body.' } };
  }
  try {
    return { value: schema.parse(JSON.parse(normalized)) };
  } catch (error) {
    return { failure: formatStructuredJsonError(error) };
  }
}

// When a parse fails AND the provider reported finish_reason=length, the real cause is
// max_tokens truncation (the model never got to emit/close its JSON), not a malformed
// response — relabel it explicitly so logs and audit metadata name the actual problem
// and operators know to raise the token budget rather than chase a "bad model" ghost.
function annotateTruncation<T>(
  parsed: { value: T } | { failure: AgentStructuredJsonFailure },
  finishReason: string | null,
  maxTokens: number,
  taskName: string,
): { value: T } | { failure: AgentStructuredJsonFailure } {
  if ('value' in parsed || finishReason !== 'length') {
    return parsed;
  }
  if (parsed.failure.kind !== 'empty_body' && parsed.failure.kind !== 'invalid_json') {
    return parsed;
  }
  return {
    failure: {
      kind: 'truncated',
      message: `Model output truncated at max_tokens=${maxTokens} (finish_reason=length) for task "${taskName}"; increase the token budget for this call.`,
    },
  };
}

@Injectable()
export class AiAgentLlmClient {
  constructor(
    private readonly modelResolver: AiModelResolverService,
    private readonly providerRegistry: AiProviderRegistry,
  ) {}

  async resolveRuntime(context: AiExecutionContextWithManager): Promise<AgentLlmRuntime | null> {
    const resolved = await this.modelResolver.tryResolve(
      context.tenantId,
      context.agentId
        ? { type: 'agent', agentId: context.agentId }
        : { type: 'chat' },
      context.manager,
    );
    if (!resolved) return null;
    if (resolved.source === 'registry' && !resolved.apiKey && resolved.provider !== 'ollama' && resolved.provider !== 'custom') {
      return null;
    }
    const provider = this.providerRegistry.get(resolved.provider);
    if (!provider) return null;
    if (resolved.source === 'registry' && resolved.endpointUrl) {
      await assertPublicHttpTarget(resolved.endpointUrl);
    }
    return {
      source: resolved.source === 'builtin' ? 'builtin' : 'custom',
      provider,
      providerId: resolved.provider,
      model: resolved.model,
      apiKey: resolved.apiKey,
      endpointUrl: resolved.endpointUrl,
      modelConfigId: resolved.configId,
      supportsVision: resolved.supportsVision,
      modelTimeoutMs: resolved.timeoutMs,
      priceInputEurPerMtok: resolved.priceInputEurPerMtok,
      priceOutputEurPerMtok: resolved.priceOutputEurPerMtok,
    };
  }

  // Prices-only lookup for pre-flight cost projections: no provider adapter,
  // no key decryption, no SSRF/DNS round-trip. Null when no model resolves.
  async resolvePrices(context: AiExecutionContextWithManager): Promise<LlmTokenPrices | null> {
    const resolved = await this.modelResolver.tryResolve(
      context.tenantId,
      context.agentId
        ? { type: 'agent', agentId: context.agentId }
        : { type: 'chat' },
      context.manager,
      { withSecrets: false },
    );
    if (!resolved) return null;
    return {
      priceInputEurPerMtok: resolved.priceInputEurPerMtok,
      priceOutputEurPerMtok: resolved.priceOutputEurPerMtok,
    };
  }

  async callJsonModel(
    context: AiExecutionContextWithManager,
    input: {
      systemPrompt: string;
      userPayload: Record<string, unknown>;
      runtime?: AgentLlmRuntime | null;
      images?: AiProviderImageAttachment[] | null;
      maxTokens: number;
      timeoutEnvName: string;
      defaultTimeoutMs: number;
    },
  ): Promise<AgentJsonModelResult | null> {
    const runtime = input.runtime === undefined ? await this.resolveRuntime(context) : input.runtime;
    if (!runtime) return null;

    // Per-model timeout from the registry wins; per-stage env vars stay as fallback.
    const timeoutMs = runtime.modelTimeoutMs
      ?? parsePositiveIntEnv(process.env[input.timeoutEnvName], input.defaultTimeoutMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    let text = '';
    let usage: AgentJsonModelResult['usage'] = null;
    let finishReason: string | null = null;
    try {
      const stream = runtime.provider.createStream({
        providerId: runtime.providerId as AiProviderId,
        model: runtime.model,
        apiKey: runtime.apiKey,
        endpointUrl: runtime.endpointUrl,
        endpointSource: runtime.source === 'builtin' ? 'platform' : 'tenant',
        systemPrompt: input.systemPrompt,
        messages: [{
          role: 'user',
          content: JSON.stringify(input.userPayload),
          images: input.images ?? null,
        }],
        tools: [],
        maxTokens: input.maxTokens,
        timeoutMs,
        maxRetries: 1,
        signal: controller.signal,
        reasoningEffort: runtime.source === 'builtin' ? BUILTIN_REASONING_EFFORT : null,
      });

      for await (const event of stream) {
        switch (event.type) {
          case 'text_delta':
            text += event.text;
            break;
          case 'done':
            usage = event.usage ?? usage;
            finishReason = event.finish_reason ?? finishReason;
            break;
          case 'error':
            throw new Error(event.message || 'Model stream returned an error.');
          default:
            break;
        }
      }
    } catch (error) {
      // A timeout abort can surface as a throw (abort during request setup) instead of
      // a silent stream end; report it as a timeout rather than a model error.
      if (!controller.signal.aborted) {
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
    return {
      text: text.trim(),
      runtime,
      usage,
      latencyMs: Date.now() - started,
      finishReason,
      timedOut: controller.signal.aborted,
      timeoutMs,
    };
  }

  async callStructuredJsonModel<T>(
    context: AiExecutionContextWithManager,
    input: {
      taskName: string;
      systemPrompt: string;
      userPayload: Record<string, unknown>;
      schema: z.ZodType<T>;
      runtime?: AgentLlmRuntime | null;
      images?: AiProviderImageAttachment[] | null;
      maxTokens: number;
      // Optional env var to override maxTokens at runtime (e.g. when a verbose/reasoning
      // model truncates with finish_reason=length). Falls back to maxTokens when unset.
      maxTokensEnvName?: string;
      timeoutEnvName: string;
      defaultTimeoutMs: number;
    },
  ): Promise<AgentStructuredJsonModelResult<T> | null> {
    const attempts: AgentStructuredJsonAttempt[] = [];
    let usage: AgentJsonModelResult['usage'] = null;
    let totalLatencyMs = 0;
    let runtime: AgentLlmRuntime | null = null;
    let text: string | null = null;
    let lastFailure: AgentStructuredJsonFailure | null = null;
    const effectiveMaxTokens = input.maxTokensEnvName
      ? parsePositiveIntEnv(process.env[input.maxTokensEnvName], input.maxTokens)
      : input.maxTokens;

    for (let index = 0; index < 2; index += 1) {
      const attempt = index + 1;
      // After a timeout the model never produced a complete answer, so there is no
      // format to repair — resend the original payload instead of telling the model
      // (wrongly) that its previous output was malformed.
      const repairPayload = attempt === 1 || lastFailure?.kind === 'timeout'
        ? input.userPayload
        : {
          ...input.userPayload,
          repair_instruction: 'return only JSON matching the schema, no prose, no markdown',
          previous_format_error: lastFailure,
        };
      const response = await this.callJsonModel(context, {
        systemPrompt: input.systemPrompt,
        userPayload: repairPayload,
        maxTokens: effectiveMaxTokens,
        runtime: input.runtime,
        images: input.images,
        timeoutEnvName: input.timeoutEnvName,
        defaultTimeoutMs: input.defaultTimeoutMs,
      });
      if (!response) {
        return null;
      }
      runtime = response.runtime;
      text = response.text;
      usage = aggregateUsage(usage, response.usage);
      totalLatencyMs += response.latencyMs;

      // A timed-out call yields whatever partial text had streamed before the abort
      // (often nothing while a reasoning model is still thinking). Parsing it would
      // mislabel the timeout as an empty/malformed model response — classify honestly.
      const parsed: { value: T } | { failure: AgentStructuredJsonFailure } = response.timedOut
        ? {
          failure: {
            kind: 'timeout',
            message: `LLM call timed out after ${response.timeoutMs}ms for task "${input.taskName}" before completing its output; increase ${input.timeoutEnvName} to allow more time.`,
          },
        }
        : annotateTruncation(
          parseStructuredJson(response.text, input.schema),
          response.finishReason,
          effectiveMaxTokens,
          input.taskName,
        );
      if ('value' in parsed) {
        attempts.push({
          attempt,
          text: response.text,
          usage: response.usage,
          latencyMs: response.latencyMs,
          failure: null,
        });
        return {
          ok: true,
          value: parsed.value,
          text: response.text,
          runtime: response.runtime,
          usage,
          latencyMs: totalLatencyMs,
          metadata: {
            taskName: input.taskName,
            retry_attempted: attempt > 1,
            json_parse_failed: attempts.some((entry) => !!entry.failure),
            json_retry_attempted: attempt > 1,
            json_retry_failed: false,
            attempts,
            failure: null,
          },
        };
      }

      lastFailure = parsed.failure;
      attempts.push({
        attempt,
        text: response.text,
        usage: response.usage,
        latencyMs: response.latencyMs,
        failure: parsed.failure,
      });
    }

    return {
      ok: false,
      value: null,
      text,
      runtime,
      usage,
      latencyMs: totalLatencyMs,
      metadata: {
        taskName: input.taskName,
        retry_attempted: attempts.length > 1,
        json_parse_failed: attempts.some((entry) => !!entry.failure),
        json_retry_attempted: attempts.length > 1,
        json_retry_failed: true,
        attempts,
        failure: lastFailure,
      },
    };
  }
}
