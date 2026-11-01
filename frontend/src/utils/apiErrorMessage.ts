import i18next, { type TFunction } from 'i18next';
import { refusalUsages, usageTotal, type DeleteFailure } from './deleteRefusal';
import { moduleRightLabel, rightLevelLabel } from './permissionLabels';

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
  /** Which sentence of `DATA_ACCESS_LIMITED` this is (`errors:dataAccess.*`, hidden links aside). */
  reason?: unknown;
  /** The applications an asset delete refusal names. */
  applications?: unknown;
  /** The connections an asset delete refusal names (reference and name). */
  connections?: unknown;
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

/**
 * The sentences of a refused data access (403 `DATA_ACCESS_LIMITED`), by the server's English text:
 * one code carries several messages, each translated here (`errors:dataAccess.*`). A message not
 * listed shows as the server wrote it.
 */
const DATA_ACCESS_MESSAGE_KEYS: Record<string, string> = {
  'This item is outside your data access.': 'outside',
  'This line is read only in your access.': 'readOnlyLine',
  'This contract is read only in your access.': 'readOnlyContract',
  'This company or cost center is not part of your access.': 'placement',
  'This action is reserved to people with access to all data.': 'reserved',
  'The chargeback of this company is outside your data access.': 'chargebackCompany',
  'This task is read only in your access.': 'readOnlyTask',
  'Only someone who can modify the line or contract of this task can delete it.': 'taskDelete',
  'This change would take the line out of your access. Keep yourself as an owner, or ask someone with access to its company.': 'leavesAccess',
};
/** `BL-12 is read only in your access.` (budget file). */
const DATA_ACCESS_READ_ONLY_REF = /^(\S+) is read only in your access\.$/;
/** `OPX-12 is no longer available since the export.` (budget file: deleted, or out of the person's access). */
const DATA_ACCESS_NO_LONGER_AVAILABLE = /^(\S+) is no longer available since the export\.$/;
/**
 * `This application is linked to 3 lines outside your access.`: a refused delete. Its sentence is
 * the delete check's refusal (`errors:APPLICATION_HIDDEN_LINES`, and the asset's, technology's,
 * project's and request's).
 */
const DATA_ACCESS_HIDDEN_LINES = /^This (application|asset|technology|project|request) is linked to (\d+) lines? outside your access\.$/;
/** `This application is linked to 2 contracts outside your access.` (lot 5, contracts counted too). */
const DATA_ACCESS_HIDDEN_CONTRACTS = /^This (application|asset|technology) is linked to (\d+) contracts? outside your access\.$/;
/** `This application is linked to 1 line and 2 contracts outside your access.` */
const DATA_ACCESS_HIDDEN_LINKS = /^This (application|asset|technology) is linked to (\d+) lines? and (\d+) contracts? outside your access\.$/;

type Translate = (key: string, options?: Record<string, unknown>) => string;

const HIDDEN_LINK_OWNERS = new Set(['application', 'asset', 'technology', 'project', 'request']);

/**
 * The sentence of a delete refused for hidden links, by the owner and both counts:
 * `errors:<OWNER>_HIDDEN_LINKS` when both are counted, else the noun alone. Null for an unknown
 * owner or no count.
 */
function hiddenLinksSentence(owner: string, lines: number, contracts: number, message: string, t: Translate): string | null {
  const noun = owner.toLowerCase();
  if (!HIDDEN_LINK_OWNERS.has(noun)) return null;
  const key = noun.toUpperCase();
  if (lines > 0 && contracts > 0) {
    return t(`errors:${key}_HIDDEN_LINKS`, {
      lines: t('errors:hiddenLinks.line', { count: lines }),
      contracts: t('errors:hiddenLinks.contract', { count: contracts }),
      defaultValue: message,
    });
  }
  if (contracts > 0) return t(`errors:${key}_HIDDEN_CONTRACTS`, { count: contracts, defaultValue: message });
  if (lines > 0) return t(`errors:${key}_HIDDEN_LINES`, { count: lines, defaultValue: message });
  return null;
}

/** The reasons whose sentence is a plain `errors:dataAccess.*` key. */
const DATA_ACCESS_REASON_KEYS: Record<string, string> = {
  outside: 'outside',
  readOnlyLine: 'readOnlyLine',
  readOnlyContract: 'readOnlyContract',
  placement: 'placement',
  reserved: 'reserved',
  chargebackCompany: 'chargebackCompany',
  readOnlyTask: 'readOnlyTask',
  taskDelete: 'taskDelete',
  leavesAccess: 'leavesAccess',
};

/**
 * A refusal by its `reason` and `params`: null for an unknown reason or a missing value, so an
 * older API (no reason) keeps the English sentence path below.
 */
function dataAccessReasonSentence(reason: string, params: Record<string, unknown>, message: string, t: Translate): string | null {
  if (reason === 'hiddenLinks') {
    return hiddenLinksSentence(
      stringifyErrorValue(params.owner),
      Number(params.lines ?? 0),
      Number(params.contracts ?? 0),
      message,
      t,
    );
  }
  if (reason === 'readOnlyRef') {
    const ref = stringifyErrorValue(params.ref);
    return ref ? t('errors:dataAccess.readOnlyRef', { ref, defaultValue: message }) : null;
  }
  const key = DATA_ACCESS_REASON_KEYS[reason];
  return key ? t(`errors:dataAccess.${key}`, { ...params, defaultValue: message }) : null;
}

/**
 * A data access sentence of the server in the screen language: a refusal (`DATA_ACCESS_LIMITED`)
 * or a budget file row error of the same words. Null when the sentence is none of them.
 */
export function dataAccessSentence(message: string, t: Translate): string | null {
  const key = DATA_ACCESS_MESSAGE_KEYS[message];
  if (key) return t(`errors:dataAccess.${key}`, { defaultValue: message });
  const readOnly = DATA_ACCESS_READ_ONLY_REF.exec(message);
  if (readOnly) return t('errors:dataAccess.readOnlyRef', { ref: readOnly[1], defaultValue: message });
  const gone = DATA_ACCESS_NO_LONGER_AVAILABLE.exec(message);
  if (gone) return t('errors:dataAccess.noLongerAvailable', { ref: gone[1], defaultValue: message });
  const both = DATA_ACCESS_HIDDEN_LINKS.exec(message);
  if (both) return hiddenLinksSentence(both[1], Number(both[2]), Number(both[3]), message, t);
  const contracts = DATA_ACCESS_HIDDEN_CONTRACTS.exec(message);
  if (contracts) return hiddenLinksSentence(contracts[1], 0, Number(contracts[2]), message, t);
  const hidden = DATA_ACCESS_HIDDEN_LINES.exec(message);
  if (hidden) return hiddenLinksSentence(hidden[1], Number(hidden[2]), 0, message, t);
  return null;
}

function dataAccessRefusalMessage(message: string, t: TFunction): string {
  return dataAccessSentence(message, t)
    || message
    || t('errors:dataAccess.outside', { defaultValue: 'This item is outside your data access.' });
}

/** A refusal for data outside the person's access (403 `DATA_ACCESS_LIMITED`). */
export function isDataAccessRefusal(error: unknown): boolean {
  const response = (error as ApiErrorLike | null | undefined)?.response;
  return response?.status === 403 && response.data?.code === 'DATA_ACCESS_LIMITED';
}

/** Names joined as a list of the screen language ("A, B and C"). */
function formatNames(names: string[], language: string): string {
  // Intl.ListFormat is in every supported browser; this TypeScript lib predates it.
  type ListFormat = new (locale: string, options: { style: string; type: string }) => { format: (list: readonly string[]) => string };
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormat }).ListFormat;
  if (!ListFormat) return names.join(', ');
  try {
    return new ListFormat(language, { style: 'long', type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

export function getApiErrorMessage(error: unknown, t: TFunction, fallback: string): string {
  const apiError = error as ApiErrorLike | null | undefined;
  const payload = apiError?.response?.data;
  const payloadMessage = stringifyErrorValue(payload?.message);
  const status = apiError?.response?.status;
  // Axios names every failure itself ("Network Error", "Request failed with status code 502").
  // With no answer, or a 5xx, that sentence is not a message from the server.
  const clientOnly = apiError?.response == null || (typeof status === 'number' && status >= 500);
  const message = payloadMessage || (clientOnly ? '' : stringifyErrorValue(apiError?.message));

  const code = getApiErrorCode(apiError);

  // A refusal with no code of its own (Nest's "Forbidden resource", `error: 'Forbidden'`): the
  // plain sentence. A coded one (`TRIAL_EXPIRED`, `NO_ACCESS`) says why below. The code of the
  // answer only: axios gives every failed request a code of its own (`ERR_BAD_REQUEST`).
  const answerCode = getApiErrorCode({ response: apiError?.response });
  if (status === 403 && (!answerCode || answerCode === 'Forbidden')) {
    const translated = t('errors:forbidden', { defaultValue: message || fallback });
    if (typeof translated === 'string' && translated.trim()) {
      return translated;
    }
  }

  if (answerCode === 'DATA_ACCESS_LIMITED') {
    const payloadParams = payload?.params && typeof payload.params === 'object'
      ? (payload.params as Record<string, unknown>)
      : {};
    const reason = stringifyErrorValue(payload?.reason);
    const translated = (reason ? dataAccessReasonSentence(reason, payloadParams, payloadMessage, t) : null)
      || dataAccessRefusalMessage(payloadMessage, t);
    if (typeof translated === 'string' && translated.trim()) {
      return translated;
    }
  }

  // No answer, or a 5xx with no message and no code of its own: the screen's fallback.
  // A coded 5xx (`DATA_ACCESS_UNAVAILABLE`, `MARKDOWN_UNAVAILABLE`) still says why, below.
  if (clientOnly && !payloadMessage && !answerCode) {
    return fallback;
  }

  if (code) {
    const variant = stringifyErrorValue(payload?.variant);
    const usages = Array.isArray(payload?.usages) ? (payload.usages as DeleteFailure['usages']) : null;
    const applications = Array.isArray(payload?.applications)
      ? payload.applications.map((name) => String(name ?? '')).filter(Boolean)
      : undefined;
    const connections = Array.isArray(payload?.connections)
      ? payload.connections.map((name) => String(name ?? '')).filter(Boolean)
      : undefined;
    // The language of `t` (a fixed one), else the interface's.
    const language = (t as { lng?: string }).lng || i18next.resolvedLanguage || i18next.language || 'en';
    const params = payload?.params && typeof payload.params === 'object' ? { ...(payload.params as Record<string, unknown>) } : {};
    // A field the sentence names (`rto_minutes`) is shown as the screen names it (`errors:fields.*`).
    if (typeof params.field === 'string' && params.field) {
      params.field = t(`errors:fields.${params.field}`, { defaultValue: params.field });
    }
    // An environment the sentence names (`pre_prod`) is shown by its name (Pre-production).
    if (typeof params.environment === 'string' && params.environment) {
      params.environment = t(`it:pages.applications.environments.${params.environment}.name`, { defaultValue: params.environment });
    }
    // A family the sentence names (`applications`, `interface_bindings`) is shown by its plural name.
    if (typeof params.family === 'string' && params.family) {
      params.family = t(`errors:families.${params.family}`, { defaultValue: params.family });
    }
    // Modules the sentence names (`['applications', 'infrastructure']`) are shown as the roles screen
    // shows them, in a list written in the language of the screen.
    if (Array.isArray(params.resources)) {
      const labels = params.resources
        .filter((resource): resource is string => typeof resource === 'string' && resource !== '')
        .map((resource) => moduleRightLabel(t, resource));
      params.resources = formatNames(labels, language);
    }
    // A missing module right names its module and level as the roles screen shows them.
    if (code === 'MODULE_RIGHT_REQUIRED') {
      if (typeof params.resource === 'string' && params.resource) {
        params.resource = moduleRightLabel(t, params.resource);
      }
      if (typeof params.level === 'string' && params.level) {
        params.level = rightLevelLabel(t, params.level);
      }
    }
    const translated = t(`errors:${code}`, {
      ...params,
      defaultValue: message || fallback,
      ...(variant ? { context: variant } : {}),
      ...(usages ? { ...usageTotal(usages), usages: refusalUsages(usages, applications, t, language, connections) } : {}),
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
