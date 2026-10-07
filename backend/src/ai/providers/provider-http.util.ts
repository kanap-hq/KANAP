import { APIError as AnthropicApiError } from '@anthropic-ai/sdk';
import { Features } from '../../config/features';
import { isAbortError } from './streaming.util';

const MAX_PROVIDER_ERROR_DETAIL_LENGTH = 300;
const GENERIC_PROVIDER_ERROR = 'AI provider request failed.';
const UNEXPECTED_PROVIDER_RESPONSE = 'The AI provider returned an unexpected response.';

// Request options for the provider SDK clients. In multi-tenant mode a redirect is
// returned to the SDK as is (never followed) and reported as an error, like the GLPI
// and PRTG clients. Single-tenant installations keep the default behaviour.
export function providerFetchOptions(): { redirect: 'manual' } | undefined {
  return Features.SINGLE_TENANT ? undefined : { redirect: 'manual' };
}

export class AiProviderRequestError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'AiProviderRequestError';
  }
}

function truncateDetail(value: string): string {
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > MAX_PROVIDER_ERROR_DETAIL_LENGTH
    ? `${text.slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH)}...`
    : text;
}

function httpStatusOf(error: object): number | null {
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : null;
}

// The provider's own error text, read from a structured JSON payload only:
// `{ "error": { "message": "..." } }` (OpenAI-compatible) or `{ "error": "..." }`.
// The OpenAI SDK keeps the `error` member of the parsed body on `error.error`, so a
// string there is a JSON field. The Anthropic SDK keeps the whole body there, which
// is raw text when the body was not JSON: only its parsed object form is read.
function structuredDetailOf(error: object): string | null {
  const payload = (error as { error?: unknown }).error;
  const candidates: unknown[] = [];
  if (payload && typeof payload === 'object') {
    const record = payload as { message?: unknown; error?: unknown };
    candidates.push(record.message);
    if (record.error && typeof record.error === 'object') {
      candidates.push((record.error as { message?: unknown }).message);
    } else {
      candidates.push(record.error);
    }
  } else if (!(error instanceof AnthropicApiError)) {
    candidates.push(payload);
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return truncateDetail(candidate);
    }
  }
  return null;
}

// Message shown to administrators (provider test, chat) for a failed provider call.
// It keeps the HTTP status and the provider's structured error message, truncated,
// and never repeats the raw body of a response.
export function describeProviderError(error: unknown): string {
  if (typeof error === 'string') {
    return truncateDetail(error) || GENERIC_PROVIDER_ERROR;
  }
  if (!error || typeof error !== 'object') {
    return GENERIC_PROVIDER_ERROR;
  }
  const status = httpStatusOf(error);
  const detail = structuredDetailOf(error);
  if (status !== null) {
    if (status >= 300 && status < 400) {
      return `The AI provider answered with a redirect (HTTP ${status}), which is not followed. `
        + 'Check the provider endpoint URL.';
    }
    return detail
      ? `AI provider request failed (HTTP ${status}): ${detail}`
      : `AI provider request failed (HTTP ${status}).`;
  }
  if (detail) {
    return `AI provider request failed: ${detail}`;
  }
  const payload = (error as { error?: unknown }).error;
  if (payload !== undefined && payload !== null) {
    return UNEXPECTED_PROVIDER_RESPONSE;
  }
  if (error instanceof SyntaxError) {
    return UNEXPECTED_PROVIDER_RESPONSE;
  }
  if (error instanceof Error && error.message.trim()) {
    return truncateDetail(error.message);
  }
  return GENERIC_PROVIDER_ERROR;
}

// Error rethrown by the provider adapters. Abort errors pass through unchanged so
// callers keep recognising a cancelled request.
export function toProviderError(error: unknown): unknown {
  if (isAbortError(error) || error instanceof AiProviderRequestError) {
    return error;
  }
  const status = error && typeof error === 'object' ? httpStatusOf(error) : null;
  return new AiProviderRequestError(describeProviderError(error), status);
}
