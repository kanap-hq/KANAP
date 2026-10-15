import type { TFunction } from 'i18next';

type ApiErrorPayload = {
  message?: unknown;
  code?: unknown;
  error?: unknown;
  /** Variant of the message for this installation (`onprem`): the `errors:<code>_<variant>` key. */
  variant?: unknown;
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

function getApiErrorCode(apiError: ApiErrorLike | null | undefined): string {
  const payload = apiError?.response?.data;
  return (
    stringifyErrorValue(payload?.code) ||
    stringifyErrorValue(payload?.error) ||
    stringifyErrorValue(apiError?.code) ||
    stringifyErrorValue(apiError?.error)
  );
}

export function getApiErrorMessage(error: unknown, t: TFunction, fallback: string): string {
  const apiError = error as ApiErrorLike | null | undefined;
  const payload = apiError?.response?.data;
  const message = stringifyErrorValue(payload?.message) || stringifyErrorValue(apiError?.message);
  const code = getApiErrorCode(apiError);

  if (code) {
    const variant = stringifyErrorValue(payload?.variant);
    const translated = t(`errors:${code}`, { defaultValue: message || fallback, ...(variant ? { context: variant } : {}) });
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

/**
 * `getApiErrorMessage` for a failed save of a document's text. A text over the
 * size limit gets a message that says what to do with the document, also when
 * the save is automatic.
 */
export function getDocumentSaveErrorMessage(error: unknown, t: TFunction, fallback: string): string {
  if (getApiErrorCode(error as ApiErrorLike | null | undefined) === 'MARKDOWN_TOO_LARGE') {
    const translated = t('errors:MARKDOWN_TOO_LARGE_DOCUMENT', { defaultValue: '' });
    if (typeof translated === 'string' && translated.trim()) {
      return translated;
    }
  }
  return getApiErrorMessage(error, t, fallback);
}
