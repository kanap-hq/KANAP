import { BadRequestException } from '@nestjs/common';
import { EntityMetadata, ILike, In, Not, Raw } from 'typeorm';
import { compileAgFilterCondition, normalizeAgFilterModel, setFilterMode } from './ag-grid-filtering';
import { StatusState } from './status';

export type Sort = { field: string; direction: 'ASC' | 'DESC' };

/** Cap for paginated reads driven by a UI grid. */
export const MAX_LIST_LIMIT = 1000;

/**
 * Higher bound for the paths that legitimately ask for the whole set: CSV exports, the
 * "select all" id lists, and the filter-value lists behind a column filter. Those go
 * through the list parser with an explicit large `limit`, which the list cap silently
 * reduced to 1000 rows. It stays bounded on purpose: an unbounded read is a memory risk
 * on a large tenant, and the flag that selects this parser is set server-side, so a
 * client cannot raise the ceiling from a query string.
 */
export const MAX_EXPORT_LIMIT = 50_000;

function parsePaginationWithCap(query: any, defaultSort: Sort, maxLimit: number) {
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit ?? '20', 10) || 20));
  // A page past every list still answers an empty page, but `skip` stays an exact integer (a page
  // such as 1e24 would make it 1e27, which no OFFSET reads).
  const page = Math.min(Math.max(1, parseInt(query.page ?? '1', 10) || 1), Math.floor(Number.MAX_SAFE_INTEGER / limit));
  const sortParam: string = query.sort ?? `${defaultSort.field}:${defaultSort.direction}`;
  const [field, dirRaw] = String(sortParam).split(':');
  const direction = String(dirRaw ?? defaultSort.direction).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const statusRaw = query.status?.toString();
  const status: StatusState | undefined =
    statusRaw && (statusRaw === StatusState.ENABLED || statusRaw === StatusState.DISABLED)
      ? (statusRaw as StatusState)
      : undefined;
  const q: string | undefined = query.q?.toString();
  let filters: any = undefined;
  if (query.filters) {
    try {
      const raw = typeof query.filters === 'string' ? JSON.parse(query.filters) : query.filters;
      if (raw && typeof raw === 'object') filters = raw;
    } catch {
      // ignore malformed filters
    }
  }
  return { page, limit, skip: (page - 1) * limit, sort: { field, direction } as Sort, status, q, filters };
}

export function parsePagination(query: any, defaultSort: Sort = { field: 'created_at', direction: 'DESC' }) {
  return parsePaginationWithCap(query, defaultSort, MAX_LIST_LIMIT);
}

/**
 * Same parsing with the export bound. Use it for exports, "select all" ids and
 * filter-value lists — anything that must see every matching row rather than one page.
 * Always select it with a server-side flag, never from the request query.
 */
export function parseExportPagination(query: any, defaultSort: Sort = { field: 'created_at', direction: 'DESC' }) {
  return parsePaginationWithCap(query, defaultSort, MAX_EXPORT_LIMIT);
}

/**
 * The list query a CSV export follows. `rows=list` (the export dialog's default): the list's
 * search, column filters, Show scope, sort and extra parameters, every page up to the export
 * bound. Anything else: `undefined`, the whole register (the API's default, kept for scripts).
 * The service reads its rows through its own list query with the export bound
 * (`parseExportPagination`), so the file holds exactly what the list shows.
 */
export function exportListQuery(query: any): Record<string, unknown> | undefined {
  if (String(query?.rows ?? '') !== 'list') return undefined;
  const { scope: _scope, language: _language, rows: _rows, page: _page, limit: _limit, ...list } = query ?? {};
  return { ...list, page: '1', limit: String(MAX_EXPORT_LIMIT) };
}

/**
 * Rows read by id (`id = ANY(:ids)`), put back in the order of `ids`: the order of the list they
 * were taken from (`listIds`), so an export reads in the screen's order.
 */
export function inIdOrder<T extends { id: string }>(rows: T[], ids: readonly string[]): T[] {
  const position = new Map(ids.map((id, index) => [String(id), index] as const));
  return [...rows].sort((a, b) => (position.get(String(a.id)) ?? 0) - (position.get(String(b.id)) ?? 0));
}

/**
 * Names of the bound parameters of the set filters below. A where clause built here can be
 * merged with another one, or spread into several OR branches of one query, so each name is
 * unique in the process; the branches of one clause share the same operator, name and value.
 */
let setFilterParamSeq = 0;

// Build a TypeORM-compatible where clause from AG Grid Text Filter model (single condition only)
// Supports: contains, notContains, equals, notEqual, startsWith, endsWith
export function buildWhereFromAgFilters(filters: any, allowedFields?: string[]): Record<string, any> {
  const where: Record<string, any> = {};
  if (!filters || typeof filters !== 'object') return where;
  for (const [field, cfg] of Object.entries(filters)) {
    // If allowlist provided, skip fields not allowed (e.g., virtual/denormalized)
    if (Array.isArray(allowedFields) && allowedFields.length > 0 && !allowedFields.includes(field)) {
      continue;
    }
    let model: any = cfg;
    // If newer model with operator+conditions, pick the first condition
    if (model && model.operator && Array.isArray(model.conditions) && model.conditions.length > 0) {
      model = model.conditions[0];
    }
    // A date model (the grid's date filter): by day, as the lists compiled in SQL read it.
    if (model?.filterType === 'date') {
      const column = '__date_filter_column__';
      const compiled = compileAgFilterCondition(model, { expression: column }, () => `date_filter_value_${++setFilterParamSeq}`);
      if (compiled) where[field] = Raw((alias) => compiled.sql.split(column).join(alias), compiled.params);
      continue;
    }
    const type = (model?.type ?? model?.filterType ?? 'contains') as string;
    // Handle Set filter (multi-select): the ticked values only (exclude mode answers 400 rather than
    // returning the values the user unticked).
    if (type === 'set' && Array.isArray(model?.values)) {
      if (setFilterMode(model) === 'exclude') {
        throw new BadRequestException(`The filter on "${field}" cannot exclude values on this list: send the values to keep instead.`);
      }
      const allValues: any[] = model.values;
      const nonNullValues: any[] = allValues.filter((v: any) => v !== null && v !== undefined);
      const hasNull = allValues.some((v: any) => v === null || v === undefined);

      // Empty array means "match nothing"
      if (allValues.length === 0) {
        where[field] = Raw(() => '1=0');
        continue;
      }

      // Build condition: IN clause for non-null values, OR IS NULL if null is selected.
      // The values are bound parameters, as with In() below.
      if (nonNullValues.length > 0 && hasNull) {
        const param = `set_filter_values_${++setFilterParamSeq}`;
        where[field] = Raw((alias) => `(${alias} IN (:...${param}) OR ${alias} IS NULL)`, { [param]: nonNullValues });
      } else if (nonNullValues.length > 0) {
        where[field] = In(nonNullValues);
      } else if (hasNull) {
        // Only null selected
        where[field] = Raw((alias) => `${alias} IS NULL`);
      }
      continue;
    }
    const valRaw = model?.filter ?? model?.value ?? (Array.isArray(model?.values) ? model.values[0] : undefined);
    // For blank/notBlank, value is not required
    const requiresValue = !(type === 'blank' || type === 'notBlank');
    if (requiresValue && (valRaw == null || valRaw === '')) continue;
    const val = valRaw != null ? String(valRaw) : '';
    switch (type) {
      case 'equals':
        where[field] = val;
        break;
      case 'notEqual':
        where[field] = Not(val);
        break;
      case 'startsWith':
        where[field] = ILike(`${val}%`);
        break;
      case 'endsWith':
        where[field] = ILike(`%${val}`);
        break;
      case 'notContains':
        where[field] = Not(ILike(`%${val}%`));
        break;
      case 'blank': {
        // Optimize for id-like fields to keep indexes usable; otherwise use a safe text cast.
        const isIdLike = field === 'id' || field.endsWith('_id');
        where[field] = Raw((alias) => (isIdLike ? `${alias} IS NULL` : `NULLIF(${alias}::text, '') IS NULL`));
        break;
      }
      case 'notBlank': {
        const isIdLike = field === 'id' || field.endsWith('_id');
        where[field] = Raw((alias) => (isIdLike ? `${alias} IS NOT NULL` : `NULLIF(${alias}::text, '') IS NOT NULL`));
        break;
      }
      case 'contains':
      default:
        where[field] = ILike(`%${val}%`);
        break;
    }
  }
  return where;
}

const DATE_COLUMN_TYPES = new Set(['date', 'timestamp', 'timestamptz', 'timestamp with time zone', 'timestamp without time zone']);
const BOOLEAN_COLUMN_TYPES = new Set(['boolean', 'bool']);
const NUMBER_COLUMN_TYPES = new Set(['int', 'int2', 'int4', 'int8', 'integer', 'smallint', 'bigint', 'numeric', 'decimal', 'real', 'double precision', 'float', 'float4', 'float8', 'number']);

/**
 * For a list that hands its column filters to TypeORM (`buildWhereFromAgFilters`), checked before:
 * a filter on a field the entity has no column for answers 400 (TypeORM fails the request with a
 * 500), and so does a model the column's type cannot take: on a date, anything but a date model,
 * a set or a blank check; on a boolean or a number, a text search (the database has no ILIKE on
 * them; a number takes an exact value).
 */
export function assertEntityFilterFields(filters: unknown, metadata: EntityMetadata): void {
  if (!filters || typeof filters !== 'object') return;
  for (const [field, raw] of Object.entries(filters as Record<string, any>)) {
    const column = metadata.columns.find((candidate) => candidate.propertyName === field);
    if (!column) throw new BadRequestException(`Unknown filter column "${field}".`);
    const type = (typeof column.type === 'function' ? column.type.name : String(column.type)).toLowerCase();
    const model = normalizeAgFilterModel(raw);
    if (!model || typeof model !== 'object') continue;
    const kind = String(model.type ?? model.filterType ?? 'contains');
    if (kind === 'set' || model.filterType === 'set' || kind === 'blank' || kind === 'notBlank') continue;
    if (DATE_COLUMN_TYPES.has(type) && model.filterType !== 'date') {
      throw new BadRequestException(`The filter on "${field}" takes a date: send a date model ("filterType": "date").`);
    }
    if (BOOLEAN_COLUMN_TYPES.has(type) && kind !== 'equals' && kind !== 'notEqual') {
      throw new BadRequestException(`The filter on "${field}" takes yes or no: send a set of values.`);
    }
    const value = model.filter ?? model.value;
    if (NUMBER_COLUMN_TYPES.has(type) && !((kind === 'equals' || kind === 'notEqual') && value != null && value !== '' && Number.isFinite(Number(value)))) {
      throw new BadRequestException(`The filter on "${field}" takes a number: send a set of values or an exact number.`);
    }
  }
}
