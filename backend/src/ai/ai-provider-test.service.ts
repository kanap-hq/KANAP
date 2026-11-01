import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { assertPublicHttpTarget } from '../common/ssrf-guard';
import { AiSecretCipherService } from './ai-secret-cipher.service';
import { AiSettingsService } from './ai-settings.service';
import {
  PROVIDER_TEST_MAX_RETRIES,
  PROVIDER_TEST_MAX_TOKENS,
  PROVIDER_TEST_TIMEOUT_MS,
  PROVIDER_TEST_USAGE_GRACE_MS,
} from './provider-test.constants';
import { AiProviderRegistry } from './providers/ai-provider-registry.service';
import {
  AiProviderSettingsSnapshot,
  AiProviderTestResult,
  AiReasoningEffort,
  AiStreamEvent,
} from './providers/ai-provider.types';
import { reasoningEffortToSend } from './providers/reasoning-effort.capability';

export type AiProviderTestInput = {
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_endpoint_url?: string | null;
  llm_api_key?: string | null;
  // The registry model's reasoning effort, sent as a chat call would send it (not at all when the
  // model does not accept it), so the test shows a provider that refuses the value.
  reasoning_effort?: AiReasoningEffort | null;
};

function normalizeNullableString(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

@Injectable()
export class AiProviderTestService {
  constructor(
    private readonly settingsService: AiSettingsService,
    private readonly cipher: AiSecretCipherService,
    private readonly providerRegistry: AiProviderRegistry,
  ) {}

  async testProvider(
    tenantId: string,
    input: AiProviderTestInput,
    // skipStoredFallback tests the input exactly as given (registry entries carry
    // their own credentials); by default missing fields fall back to the tenant's
    // stored settings so the legacy ad-hoc settings test keeps working.
    opts?: { manager?: EntityManager; skipStoredFallback?: boolean },
  ): Promise<AiProviderTestResult> {
    const startedAt = Date.now();
    const currentSettings = opts?.skipStoredFallback
      ? null
      : await this.settingsService.find(tenantId, { manager: opts?.manager });
    const provider = normalizeNullableString(input.llm_provider) ?? currentSettings?.llm_provider ?? null;
    const model = normalizeNullableString(input.llm_model) ?? currentSettings?.llm_model ?? null;
    const endpointUrl = normalizeNullableString(input.llm_endpoint_url) ?? currentSettings?.llm_endpoint_url ?? null;

    let apiKey = normalizeNullableString(input.llm_api_key);
    if (!apiKey && currentSettings?.llm_api_key_encrypted) {
      try {
        apiKey = this.cipher.decrypt(currentSettings.llm_api_key_encrypted);
      } catch (error) {
        return this.fail({
          provider,
          model,
          startedAt,
          message: this.getErrorMessage(error),
          validationErrors: [this.getErrorMessage(error)],
        });
      }
    }

    if (endpointUrl) {
      try {
        await assertPublicHttpTarget(endpointUrl);
      } catch (error) {
        return this.fail({
          provider,
          model,
          startedAt,
          message: this.getErrorMessage(error),
          validationErrors: [this.getErrorMessage(error)],
        });
      }
    }

    const snapshot: AiProviderSettingsSnapshot = {
      llm_provider: provider,
      llm_model: model,
      llm_endpoint_url: endpointUrl,
      has_llm_api_key: !!apiKey,
    };

    const validationErrors = this.providerRegistry.validate(snapshot);
    if (validationErrors.length > 0) {
      return {
        ok: false,
        provider,
        model,
        latency_ms: null,
        message: 'Provider settings are incomplete.',
        validation_errors: validationErrors,
      };
    }

    const adapter = this.providerRegistry.get(provider);
    if (!adapter) {
      return {
        ok: false,
        provider,
        model,
        latency_ms: null,
        message: 'Provider is not configured.',
        validation_errors: ['Provider is required.'],
      };
    }

    const effortSent = reasoningEffortToSend(provider, model, input.reasoning_effort);
    try {
      const stream = adapter.createStream({
        model: model!,
        apiKey,
        endpointUrl,
        systemPrompt: 'Respond with a single word: ok.',
        messages: [{ role: 'user', content: 'Reply with ok.' }],
        tools: [],
        maxTokens: PROVIDER_TEST_MAX_TOKENS,
        timeoutMs: PROVIDER_TEST_TIMEOUT_MS,
        maxRetries: PROVIDER_TEST_MAX_RETRIES,
        reasoningEffort: effortSent,
      });

      // The answer is read to its end (a few tokens) when it comes within a short grace after the
      // first event: the usage that closes it says whether the model reasoned. A stream still open
      // after that is a success without that figure. The latency stays the time to the first event,
      // and closing the stream releases its connection.
      const iterator = (stream as AsyncIterable<AiStreamEvent>)[Symbol.asyncIterator]();
      let latencyMs: number | null = null;
      let reasoningTokens: number | null = null;
      let graceTimer: NodeJS.Timeout | undefined;
      try {
        let deadline: Promise<'grace'> | null = null;
        for (;;) {
          const next = iterator.next();
          const result = deadline ? await Promise.race([next, deadline]) : await next;
          if (result === 'grace' || result.done) break;
          const event = result.value;
          if (latencyMs === null) {
            latencyMs = Date.now() - startedAt;
            deadline = new Promise((resolve) => { graceTimer = setTimeout(() => resolve('grace'), PROVIDER_TEST_USAGE_GRACE_MS); });
          }
          if (event.type === 'error') {
            return this.fail({
              provider,
              model,
              startedAt,
              message: event.message || 'Provider test failed.',
              validationErrors: [],
            });
          }
          if (event.type === 'done') {
            reasoningTokens = event.usage?.reasoning_tokens ?? null;
            break;
          }
        }
      } finally {
        clearTimeout(graceTimer);
        await iterator.return?.(undefined).catch(() => undefined);
      }

      return {
        ok: true,
        provider,
        model,
        latency_ms: latencyMs ?? Date.now() - startedAt,
        message: 'Provider test succeeded.',
        validation_errors: [],
        reasoning_effort_sent: effortSent,
        reasoning_tokens: reasoningTokens,
      };
    } catch (error) {
      return this.fail({
        provider,
        model,
        startedAt,
        message: this.getErrorMessage(error),
        validationErrors: [],
      });
    }
  }

  private fail(input: {
    provider: string | null;
    model: string | null;
    startedAt: number;
    message: string;
    validationErrors: string[];
  }): AiProviderTestResult {
    return {
      ok: false,
      provider: input.provider,
      model: input.model,
      latency_ms: Date.now() - input.startedAt,
      message: input.message,
      validation_errors: input.validationErrors,
    };
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }
    return 'Provider test failed.';
  }
}
