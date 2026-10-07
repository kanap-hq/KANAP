import type { TFunction } from 'i18next';

type ApiErrorPayload = {
  message?: unknown;
  code?: unknown;
  error?: unknown;
};

type ApiErrorLike = {
  message?: unknown;
  code?: unknown;
  error?: unknown;
  response?: {
    status?: number;
    data?: ApiErrorPayload;
  };
};

function stringifyErrorValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map(stringifyErrorValue).filter(Boolean).join(' ');
  }

  return '';
}

export function getApiErrorMessage(error: unknown, t: TFunction, fallback: string): string {
  const apiError = error as ApiErrorLike | null | undefined;
  const payload = apiError?.response?.data;
  const message = stringifyErrorValue(payload?.message) || stringifyErrorValue(apiError?.message);
  const code =
    stringifyErrorValue(payload?.code) ||
    stringifyErrorValue(payload?.error) ||
    stringifyErrorValue(apiError?.code) ||
    stringifyErrorValue(apiError?.error);

  if (code) {
    const translated = t(`errors:${code}`, { defaultValue: message || fallback });
    if (typeof translated === 'string' && translated.trim()) {
      return translated;
    }
  }

  // A rate limit answers with no code of its own (ThrottlerException).
  if (apiError?.response?.status === 429) {
    const translated = t('errors:rate_limited', { defaultValue: fallback });
    if (typeof translated === 'string' && translated.trim()) {
      return translated;
    }
  }

  if (message) {
    return message;
  }

  return fallback;
}
