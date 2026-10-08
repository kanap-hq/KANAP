import { FindOperator, Raw } from 'typeorm';
import { compileAgFilterCondition, createParamNameGenerator, normalizeAgFilterModel } from './ag-grid-filtering';

export enum StatusState {
  ENABLED = 'enabled',
  DISABLED = 'disabled',
}

export const STATUS_STATES = [StatusState.ENABLED, StatusState.DISABLED] as const;

export type StatusStateValue = (typeof STATUS_STATES)[number];
export type DisabledAtInput = Date | string | number | null | undefined;

export function isEnabled(status: unknown): status is StatusState.ENABLED {
  return String(status).toLowerCase() === StatusState.ENABLED;
}

export function isDisabled(status: unknown): status is StatusState.DISABLED {
  return String(status).toLowerCase() === StatusState.DISABLED;
}

export function normalizeStatus(status: unknown): StatusState {
  return isDisabled(status) ? StatusState.DISABLED : StatusState.ENABLED;
}

export function coerceDisabledAt(value: DisabledAtInput): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value as any);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isActiveAt(disabledAt: DisabledAtInput, asOf: Date = new Date()): boolean {
  const disabledDate = coerceDisabledAt(disabledAt);
  if (!disabledDate) return true;
  return disabledDate.getTime() > asOf.getTime();
}

export function deriveStatusFromDisabledAt(disabledAt: DisabledAtInput, asOf: Date = new Date()): StatusState {
  return isActiveAt(disabledAt, asOf) ? StatusState.ENABLED : StatusState.DISABLED;
}

export function normalizeDisabledAtInput(value: DisabledAtInput): Date | null {
  const date = coerceDisabledAt(value);
  return date ? new Date(date) : null;
}

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// A full timestamp: calendar day, T, hours to seconds, optional fraction, Z or ±HH:mm.
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?([Zz]|[+-]\d{2}:\d{2})$/;

function invalidCsvEndOfValidity(text: string): Error {
  return new Error(`Invalid disabled_at '${text}'. Use YYYY-MM-DD or a full ISO date and time.`);
}

/**
 * The end of validity for a bare calendar day: noon UTC of that day, so the
 * day and the year read the same from UTC-11 to UTC+11 (the UI shows it in
 * the browser's local time, the summary masks years by its UTC year).
 */
export function endOfValidityFromDate(ymd: string): Date {
  const match = YMD_PATTERN.exec(String(ymd ?? '').trim());
  if (!match) throw new Error(`Invalid date '${ymd}'. Use YYYY-MM-DD.`);
  const [, y, m, d] = match;
  const date = new Date(`${y}-${m}-${d}T12:00:00.000Z`);
  // Date rolls 2026-02-30 over to March: refuse anything that is not a real calendar day.
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d)) {
    throw new Error(`Invalid date '${ymd}'. Use YYYY-MM-DD.`);
  }
  return date;
}

/**
 * Parse an end of validity from an API body or the AI: a bare YYYY-MM-DD
 * becomes noon UTC of that day, a full timestamp is kept as given, empty
 * means no end. Throws on anything else.
 *
 * CSV cells do not use this. The fallback below is `new Date(text)`, which
 * reads `01/03/2027` as January 3 and rolls a day that does not exist.
 * Files call `parseCsvEndOfValidity`.
 */
export function parseEndOfValidityInput(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid end of validity.');
    return new Date(value);
  }
  const text = String(value).trim();
  if (text === '') return null;
  if (YMD_PATTERN.test(text)) return endOfValidityFromDate(text);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date '${text}'. Use YYYY-MM-DD or an ISO date and time.`);
  return parsed;
}

/**
 * An end-of-validity cell from a CSV file. Empty means no end. A bare
 * YYYY-MM-DD is noon UTC of that day. A full ISO timestamp (Z or ±HH:mm)
 * is kept. Anything else throws a row error that names the format.
 */
export function parseCsvEndOfValidity(value: unknown): Date | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw invalidCsvEndOfValidity(String(value));
  const text = value.trim();
  if (text === '') return null;
  // PostgreSQL has no year 0, so a cell of 0000 would fail at load as a database error.
  if (text.startsWith('0000')) throw invalidCsvEndOfValidity(text);
  if (YMD_PATTERN.test(text)) {
    try {
      return endOfValidityFromDate(text);
    } catch {
      throw invalidCsvEndOfValidity(text);
    }
  }
  const match = ISO_TIMESTAMP.exec(text);
  if (!match) throw invalidCsvEndOfValidity(text);
  const [, y, m, d, h, min, s, , zone] = match;
  if (Number(h) > 23 || Number(min) > 59 || Number(s) > 59) throw invalidCsvEndOfValidity(text);
  if (zone !== 'Z' && zone !== 'z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) throw invalidCsvEndOfValidity(text);
  }
  // Date rolls 2027-02-30 over to March. Refuse a day that is not real before trusting it.
  const probe = new Date(`${y}-${m}-${d}T12:00:00.000Z`);
  if (
    Number.isNaN(probe.getTime())
    || probe.getUTCFullYear() !== Number(y)
    || probe.getUTCMonth() + 1 !== Number(m)
    || probe.getUTCDate() !== Number(d)
  ) {
    throw invalidCsvEndOfValidity(text);
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw invalidCsvEndOfValidity(text);
  return parsed;
}

function isBlankInput(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function parseNamedEndOfValidity(field: string, value: unknown): Date | null {
  try {
    return parseEndOfValidityInput(value);
  } catch (err) {
    throw new Error(`${field}: ${(err as Error).message}`);
  }
}

/**
 * The end of validity of an API body, parsed like every other server input
 * (a bare day is noon UTC, a full timestamp is kept). The deprecated
 * `effective_end` (one release) fills it only when no `disabled_at` is given,
 * and a blank value never clears it. Returns the `disabled_at` to write:
 * undefined when the body sets none, null or blank when it clears it.
 * Throws, naming the field, on a value that is not a date.
 */
export function resolveEndOfValidityAlias(disabledAt: DisabledAtInput, effectiveEnd: unknown): DisabledAtInput {
  if (!isBlankInput(disabledAt)) {
    return typeof disabledAt === 'number' ? disabledAt : parseNamedEndOfValidity('disabled_at', disabledAt);
  }
  if (isBlankInput(effectiveEnd)) return disabledAt;
  return parseNamedEndOfValidity('effective_end', effectiveEnd);
}

/**
 * `none`: the status column filter ticks no value, so the list holds no line.
 * `activeSince`: no end of validity, or one on or after that instant.
 * `endedBefore`: an end of validity before that instant (the complement of `activeSince`).
 */
export type LifecycleScope = 'active' | 'inactive' | 'none' | { activeSince: Date } | { endedBefore: Date } | null;

const ALIAS_TOKEN = '__disabled_at__';

/**
 * `where.disabled_at` for the item lists: the lifecycle scope AND the grid's
 * own date filter on the end of validity. Both target the same column, so
 * assigning one after the other would silently drop the first.
 */
export function disabledAtWhere(scope: LifecycleScope, gridFilter?: unknown): FindOperator<any> | undefined {
  const parts: string[] = [];
  const params: Record<string, unknown> = {};
  if (scope === 'active') {
    parts.push(`${ALIAS_TOKEN} IS NULL OR ${ALIAS_TOKEN} > NOW()`);
  } else if (scope === 'inactive') {
    parts.push(`${ALIAS_TOKEN} IS NOT NULL AND ${ALIAS_TOKEN} <= NOW()`);
  } else if (scope === 'none') {
    parts.push('1 = 0');
  } else if (scope && 'activeSince' in scope) {
    parts.push(`${ALIAS_TOKEN} IS NULL OR ${ALIAS_TOKEN} >= :period_start`);
    params.period_start = scope.activeSince;
  } else if (scope && 'endedBefore' in scope) {
    parts.push(`${ALIAS_TOKEN} IS NOT NULL AND ${ALIAS_TOKEN} < :ended_before`);
    params.ended_before = scope.endedBefore;
  }
  // A combined model (two conditions from the grid, or two AI filters on the
  // same column) applies every condition with its own operator.
  const raw = gridFilter as any;
  const combined = raw && typeof raw === 'object' && Array.isArray(raw.conditions) && raw.conditions.length > 0
    && (raw.operator === 'AND' || raw.operator === 'OR');
  const models: any[] = combined ? raw.conditions : [normalizeAgFilterModel(gridFilter)];
  const nextParam = createParamNameGenerator('end_of_validity_');
  const compiledParts: string[] = [];
  for (const model of models) {
    // Only a date filter makes sense on a timestamp; a text filter would not compile in SQL.
    if (!model || typeof model !== 'object' || model.filterType !== 'date') continue;
    const compiled = compileAgFilterCondition(model, { expression: ALIAS_TOKEN }, nextParam);
    if (compiled) {
      compiledParts.push(compiled.sql);
      Object.assign(params, compiled.params);
    }
  }
  if (compiledParts.length === 1) parts.push(compiledParts[0]);
  else if (compiledParts.length > 1) parts.push(compiledParts.map((part) => `(${part})`).join(raw.operator === 'OR' ? ' OR ' : ' AND '));
  if (parts.length === 0) return undefined;
  const sql = parts.map((part) => `(${part})`).join(' AND ');
  return Raw((alias) => sql.split(ALIAS_TOKEN).join(alias), params);
}

interface ResolveLifecycleArgs {
  currentDisabledAt?: Date | null;
  nextDisabledAt?: DisabledAtInput;
  nextStatus?: unknown;
  nowFactory?: () => Date;
}

export function resolveLifecycleState({
  currentDisabledAt = null,
  nextDisabledAt,
  nextStatus,
  nowFactory,
}: ResolveLifecycleArgs): { status: StatusState; disabled_at: Date | null } {
  const now = nowFactory ? nowFactory() : new Date();
  let disabledAt: Date | null;

  if (nextDisabledAt !== undefined) {
    disabledAt = normalizeDisabledAtInput(nextDisabledAt);
  } else if (nextStatus !== undefined) {
    const normalizedStatus = normalizeStatus(nextStatus);
    if (normalizedStatus === StatusState.ENABLED) {
      disabledAt = null;
    } else {
      // Disabled without a date: a date already passed stays, otherwise the end of validity is now
      // (a future date would leave the record enabled).
      const current = currentDisabledAt ? new Date(currentDisabledAt) : null;
      disabledAt = current && current.getTime() <= now.getTime() ? current : now;
    }
  } else {
    disabledAt = currentDisabledAt ? new Date(currentDisabledAt) : null;
  }

  const status = deriveStatusFromDisabledAt(disabledAt, now);
  return { status, disabled_at: disabledAt };
}

/** Sets `where.disabled_at` for an item list: the lifecycle scope AND the grid's filter on that column. */
export function applyDisabledAtWhere(where: Record<string, any>, scope: LifecycleScope, filters: any): void {
  const condition = disabledAtWhere(scope, filters?.disabled_at);
  if (condition) where.disabled_at = condition;
  else delete where.disabled_at;
}

/** The summary views keep, by default, the items still active at the start of the first year shown. */
export function summaryScope(includeDisabled: boolean, lifecycleStatus: StatusState | null, periodStart: Date): LifecycleScope {
  if (includeDisabled) return null;
  if (lifecycleStatus === StatusState.DISABLED) return 'inactive';
  if (lifecycleStatus === StatusState.ENABLED) return 'active';
  return { activeSince: periodStart };
}
