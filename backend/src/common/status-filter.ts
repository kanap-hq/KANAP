import { Brackets, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { normalizeAgFilterModel } from './ag-grid-filtering';
import { StatusState } from './status';

type DateInput = Date | string | number | undefined | null;

const DEFAULT_DISABLED_AT_COLUMN = 'disabled_at';

export interface StatusFilterPeriod {
  start?: DateInput;
  end?: DateInput;
}

export type StatusFilterOptions =
  | {
      alias: string;
      column?: string;
      disabledAtColumn?: string;
      explicitStatus: StatusState | null;
      includeDisabled?: boolean;
      asOf?: DateInput;
      period?: StatusFilterPeriod;
      /** The status column filter ticks no value: nothing matches (see `extractStatusFilterFromAgModel`). */
      matchNone?: boolean;
    }
  | {
      alias: string;
      column?: string;
      disabledAtColumn?: string;
      explicitStatus?: undefined;
      includeDisabled?: boolean;
      asOf?: DateInput;
      period?: StatusFilterPeriod;
      matchNone?: boolean;
    };

export interface StatusWhereFragment {
  sql: string;
  params: Record<string, unknown>;
}

function coerceDate(value: DateInput): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildParamBase(alias: string): string {
  return alias.replace(/[^\w]/g, '_');
}

export function buildStatusWhereFragment(opts: StatusFilterOptions): StatusWhereFragment | null {
  if (opts.matchNone) {
    return { sql: '1 = 0', params: {} };
  }
  const disabledColumn = `${opts.alias}.${opts.disabledAtColumn ?? DEFAULT_DISABLED_AT_COLUMN}`;
  const paramBase = buildParamBase(opts.alias);

  const explicit = opts.explicitStatus ?? null;
  // "All" lifts only the default scope: an explicit status (query or status column filter) still applies.
  if (opts.includeDisabled && !explicit) {
    return null;
  }

  const periodStart = opts.period ? coerceDate(opts.period.start) : null;
  const periodEnd = opts.period ? coerceDate(opts.period.end) : null;
  const asOf = coerceDate(opts.asOf ?? periodEnd) ?? new Date();

  if (!explicit && periodStart) {
    return {
      sql: `(${disabledColumn} IS NULL OR ${disabledColumn} >= :${paramBase}_period_start)`,
      params: { [`${paramBase}_period_start`]: periodStart },
    };
  }

  if (explicit === StatusState.DISABLED) {
    return {
      sql: `(${disabledColumn} IS NOT NULL AND ${disabledColumn} <= :${paramBase}_as_of)`,
      params: { [`${paramBase}_as_of`]: asOf },
    };
  }

  return {
    sql: `(${disabledColumn} IS NULL OR ${disabledColumn} > :${paramBase}_as_of)`,
    params: { [`${paramBase}_as_of`]: asOf },
  };
}

export function applyStatusFilter<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  opts: StatusFilterOptions,
): SelectQueryBuilder<T> {
  const fragment = buildStatusWhereFragment(opts);
  if (!fragment) {
    return qb;
  }

  return qb.andWhere(
    new Brackets((expr) => {
      expr.where(fragment.sql, fragment.params);
    }),
  );
}

function parseStatusValue(value: unknown): StatusState | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === StatusState.ENABLED) return StatusState.ENABLED;
  if (normalized === StatusState.DISABLED) return StatusState.DISABLED;
  return undefined;
}

/**
 * Reads the grid's status column filter out of the filter model. A set filter
 * whose values hold no status (the checklist's Clear sends `values: []`)
 * matches nothing, like any other empty set filter (`1=0` in the generic
 * engine): `matchNone` is then true and the caller must return no row (list,
 * ids, totals and filter values alike).
 */
export function extractStatusFilterFromAgModel(filters: any): {
  status?: StatusState;
  matchNone?: true;
  sanitizedFilters: Record<string, any> | undefined;
} {
  if (!filters || typeof filters !== 'object') {
    return { sanitizedFilters: filters };
  }
  if (!Object.prototype.hasOwnProperty.call(filters, 'status')) {
    return { sanitizedFilters: filters };
  }
  const { status, ...rest } = filters;
  const model = normalizeAgFilterModel(status);
  if (!model || typeof model !== 'object') {
    return { sanitizedFilters: rest };
  }
  if (Array.isArray(model.values)) {
    const rawValues: unknown[] = model.values;
    let parsed = rawValues
      .map((value) => parseStatusValue(value))
      .filter((val): val is StatusState => val !== undefined);
    // Exclude mode (the user unticked values from "all"): the statuses kept are the others.
    if (model.mode === 'exclude') parsed = [StatusState.ENABLED, StatusState.DISABLED].filter((state) => !parsed.includes(state));
    if (parsed.length === 0) {
      return { matchNone: true, sanitizedFilters: rest as Record<string, any> | undefined };
    }
    const first: StatusState = parsed[0];
    const allSame = parsed.every((v) => v === first);
    if (allSame) {
      return { status: first, sanitizedFilters: rest as Record<string, any> | undefined };
    }
    return { sanitizedFilters: rest as Record<string, any> | undefined };
  }
  const raw = model.filter ?? model.value ?? model.text ?? model.status;
  const parsed = parseStatusValue(raw);
  if (parsed !== undefined) {
    const statusValue: StatusState = parsed;
    return { status: statusValue, sanitizedFilters: rest as Record<string, any> | undefined };
  }
  return { sanitizedFilters: rest as Record<string, any> | undefined };
}
