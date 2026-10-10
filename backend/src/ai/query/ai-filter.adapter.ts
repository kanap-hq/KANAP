import {
  AiAdaptedFilters,
  AiDateFilterValue,
  AiEntityFilterRegistry,
  AiFilterValue,
  AiNumberFilterValue,
  AiSetExcludeFilterValue,
} from './ai-filter.types';

/**
 * Set columns whose list understands a set filter in exclude mode: every column of the OPEX and CAPEX
 * lists (SQL list engine), and the application lifecycle (`{ not: ['retired'] }` is the scope of the
 * Applications list and of the Compliance tile).
 */
const EXCLUDE_SET_COLUMNS: Partial<Record<string, 'all' | Set<string>>> = {
  spend_items: 'all',
  capex_items: 'all',
  applications: new Set(['lifecycle']),
};

function acceptsExcludeMode(entityType: string, gridColumn: string): boolean {
  const columns = EXCLUDE_SET_COLUMNS[entityType];
  return columns === 'all' || (!!columns && columns.has(gridColumn));
}

function isBlankDateValue(value: AiFilterValue): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => entry === null);
}

function isExcludeSetValue(value: AiFilterValue): value is AiSetExcludeFilterValue {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as any).not);
}

function isNumberFilterValue(value: AiFilterValue): value is AiNumberFilterValue {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as any).op === 'string' && typeof (value as any).value === 'number';
}

function isDateFilterValue(value: AiFilterValue): value is AiDateFilterValue {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as any).op === 'string' && typeof (value as any).value === 'string';
}

function adaptNumberFilter(raw: AiNumberFilterValue) {
  switch (raw.op) {
    case 'eq':
      return { filterType: 'number', type: 'equals', filter: raw.value };
    case 'gt':
      return { filterType: 'number', type: 'greaterThan', filter: raw.value };
    case 'gte':
      return { filterType: 'number', type: 'greaterThanOrEqual', filter: raw.value };
    case 'lt':
      return { filterType: 'number', type: 'lessThan', filter: raw.value };
    case 'lte':
      return { filterType: 'number', type: 'lessThanOrEqual', filter: raw.value };
    case 'between':
      if (typeof raw.valueTo !== 'number') return null;
      return {
        filterType: 'number',
        type: 'inRange',
        filter: raw.value,
        filterTo: raw.valueTo,
      };
    default:
      return null;
  }
}

function adaptDateFilter(raw: AiDateFilterValue) {
  switch (raw.op) {
    case 'eq':
      return { filterType: 'date', type: 'equals', dateFrom: raw.value };
    case 'before':
      return { filterType: 'date', type: 'lessThan', dateFrom: raw.value };
    case 'after':
      return { filterType: 'date', type: 'greaterThan', dateFrom: raw.value };
    case 'between':
      if (!raw.valueTo) return null;
      return {
        filterType: 'date',
        type: 'inRange',
        dateFrom: raw.value,
        dateTo: raw.valueTo,
      };
    default:
      return null;
  }
}

/**
 * Both filters on one column: an identical filter once, two date filters as an
 * AND model (the end of validity lists compile every condition of it). Any
 * other pair cannot be expressed as one grid filter: null.
 */
function combineSameColumn(existing: any, next: any): any | null {
  if (JSON.stringify(existing) === JSON.stringify(next)) return existing;
  if (existing.filterType !== 'date' || next.filterType !== 'date') return null;
  const conditions = existing.operator === 'AND' && Array.isArray(existing.conditions) ? existing.conditions : [existing];
  return { filterType: 'date', operator: 'AND', conditions: [...conditions, next] };
}

export function adaptFilters(
  registry: AiEntityFilterRegistry,
  aiFilters?: Record<string, AiFilterValue>,
): AiAdaptedFilters {
  const filters: Record<string, any> = {};
  const applied = new Set<string>();
  const ignored = new Set<string>();

  if (!aiFilters || typeof aiFilters !== 'object') {
    return { filters, applied: [], ignored: [] };
  }

  for (const [fieldName, rawValue] of Object.entries(aiFilters)) {
    const field = registry.fields[fieldName];
    if (!field) {
      ignored.add(fieldName);
      continue;
    }

    let adapted: any = null;
    if (field.type === 'set' && isExcludeSetValue(rawValue)) {
      // `{ not: [...] }`: every value but these. Only lists that know the exclude mode take it.
      // A value outside the field's declared values matches no line: leaving it out excludes the same lines.
      const values = rawValue.not.filter((value) => value === null || typeof value === 'string');
      const allowed = Array.isArray(field.values) ? new Set(field.values) : null;
      if (acceptsExcludeMode(registry.entityType, field.grid)) {
        adapted = { filterType: 'set', mode: 'exclude', values: allowed ? values.filter((value) => allowed.has(value)) : values };
      }
    } else if (field.type === 'set') {
      const values = Array.isArray(rawValue)
        ? rawValue.filter((value) => value === null || typeof value === 'string')
        : typeof rawValue === 'string'
          ? [rawValue]
          : [];
      if (values.length > 0) {
        const allowed = Array.isArray(field.values) ? new Set(field.values) : null;
        const filteredValues = allowed
          ? values.filter((value) => allowed.has(value))
          : values;
        if (filteredValues.length > 0) {
          adapted = { filterType: 'set', values: filteredValues };
        }
      }
    } else if (field.type === 'text') {
      if (typeof rawValue === 'string' && rawValue.trim()) {
        adapted = { filterType: 'text', type: 'contains', filter: rawValue.trim() };
      }
    } else if (field.type === 'number') {
      if (isNumberFilterValue(rawValue)) {
        adapted = adaptNumberFilter(rawValue);
      }
    } else if (field.type === 'date') {
      if (isDateFilterValue(rawValue)) {
        adapted = adaptDateFilter(rawValue);
      } else if (field.blankable && isBlankDateValue(rawValue)) {
        adapted = { filterType: 'date', type: 'blank' };
      }
    }

    if (!adapted) {
      ignored.add(fieldName);
      continue;
    }

    // Two fields on the same column (an alias and its field) must both apply,
    // or the later one is reported as ignored: never overwrite silently.
    const existing = filters[field.grid];
    if (existing) {
      const combined = combineSameColumn(existing, adapted);
      if (!combined) {
        ignored.add(fieldName);
        continue;
      }
      adapted = combined;
    }

    filters[field.grid] = adapted;
    applied.add(fieldName);
  }

  return {
    filters,
    applied: Array.from(applied),
    ignored: Array.from(ignored),
  };
}

export function getAppliedFilterNames(
  registry: AiEntityFilterRegistry,
  aiFilters?: Record<string, AiFilterValue>,
): string[] {
  return adaptFilters(registry, aiFilters).applied;
}
