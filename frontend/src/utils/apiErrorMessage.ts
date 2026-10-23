import i18next, { type TFunction } from 'i18next';
import { refusalCounts, usageTotal, type DeleteFailure } from './deleteRefusal';

type ApiErrorPayload = {
  message?: unknown;
  code?: unknown;
  error?: unknown;
  /** Variant of the message for this installation (`onprem`): the `errors:<code>_<variant>` key. */
  variant?: unknown;
  /** A refused delete: what still uses the record, counted per kind (`{{usages}}` in the message). */
  usages?: unknown;
  /** Values the refusal's sentence names besides the counts (a frozen column and its year). */
  params?: unknown;
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

/** A refusal for a name another record already has (409 `duplicate`): pages show it under the name field. */
export function isDuplicateError(error: unknown): boolean {
  const response = (error as ApiErrorLike | null | undefined)?.response;
  return response?.status === 409 && response.data?.code === 'duplicate';
}

export function getApiErrorMessage(error: unknown, t: TFunction, fallback: string): string {
  const apiError = error as ApiErrorLike | null | undefined;
  const payload = apiError?.response?.data;
  const message = stringifyErrorValue(payload?.message) || stringifyErrorValue(apiError?.message);
  const status = apiError?.response?.status;

  // A refusal with no code of its own (Nest's "Forbidden resource"): the plain sentence.
  if (status === 403 && !stringifyErrorValue(payload?.code)) {
    const translated = t('errors:forbidden', { defaultValue: message || fallback });
    if (typeof translated === 'string' && translated.trim()) {
      return translated;
    }
  }

  const code = getApiErrorCode(apiError);

  if (code) {
    const variant = stringifyErrorValue(payload?.variant);
    const usages = Array.isArray(payload?.usages) ? (payload.usages as DeleteFailure['usages']) : null;
    // The language of `t` (a fixed one), else the interface's.
    const language = (t as { lng?: string }).lng || i18next.resolvedLanguage || i18next.language || 'en';
    const params = payload?.params && typeof payload.params === 'object' ? (payload.params as Record<string, unknown>) : {};
    const translated = t(`errors:${code}`, {
      ...params,
      defaultValue: message || fallback,
      ...(variant ? { context: variant } : {}),
      ...(usages ? { ...usageTotal(usages), usages: refusalCounts({ usages }, t, language) } : {}),
    });
    if (typeof translated === 'string' && translated.trim()) {
      return translated;
    }
  }

  // A rate limit answers with no code of its own (ThrottlerException).
  if (status === 429) {
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
