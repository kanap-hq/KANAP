import { BadRequestException } from '@nestjs/common';
import { ILike, In, Not, Raw } from 'typeorm';
import { setFilterMode } from './ag-grid-filtering';
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

      // Build condition: IN clause for non-null values, OR IS NULL if null is selected
      if (nonNullValues.length > 0 && hasNull) {
        where[field] = Raw((alias) => `(${alias} IN (${nonNullValues.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ')}) OR ${alias} IS NULL)`);
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
