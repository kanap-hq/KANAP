import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { fold, ICU_COLLATION } from '../list-engine/sql-fragments';

/**
 * Reference lookups: the search behind every picker that offers rows of a
 * reference table (suppliers, accounts, companies, users, dimension values,
 * contracts...). A picker asks for a page of 20 to 50 rows matching what the
 * user typed, and once, by ids, for the rows already chosen: never the whole
 * table (the pickers used to load the first 1,000 rows and filter them in the
 * browser, so the 1,001st supplier could never be picked).
 *
 * Matching folds accents and case on both sides like the list engine's quick
 * search (`fold`, decision Q2): "societe" finds "Société". Rows whose label
 * starts with the text come first, then rows where a word starts with it,
 * then the others; each group in ICU order of the label.
 *
 * Every statement carries `tenant_id = $1` besides RLS. Table, column and
 * scope expressions come from the spec (code), never from the request.
 */

/** A bound parameter: returns its placeholder (`$n`). */
export type Bind = (value: unknown, cast?: string) => string;

export interface LookupSpec {
  /** Table read, aliased `t`. */
  table: string;
  /** Output field → SQL expression over `t`. Must include `id`. */
  columns: Record<string, string>;
  /** The label: sort key, and the field whose start ranks first. */
  label: string;
  /** Further expressions whose start ranks first (e.g. a last name besides "first last"). */
  prefixes?: string[];
  /** Every expression the text is searched in (the label is searched too). */
  search?: string[];
  /** Sort keys after the rank (default: the label, ICU order); `t.id` breaks ties. */
  sort?: string[];
  /** The rows offered when searching (lifecycle): an id lookup ignores it, so a disabled chosen row still shows. */
  offered?: string;
  /** Default and maximum page sizes. */
  defaultLimit?: number;
  maxLimit?: number;
}

export interface LookupRequest {
  /** Searched text; blank lists the first rows. */
  q?: string | null;
  /** Rows by id (hydration of chosen values): no search, no scope, no lifecycle. */
  ids?: string[] | null;
  limit?: number | null;
  /** Further predicates of a search (a company's chart, a dimension...). */
  scope?: Array<(bind: Bind) => string>;
}

export interface LookupResult<T> {
  items: T[];
  /** More rows match than the page holds: the picker says to type more. */
  has_more: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LOOKUP_MAX_IDS = 100;
export const LOOKUP_MAX_TEXT = 100;

/** `ids` as a query string gives it: `a,b` or repeated `ids=a&ids=b`. Invalid ids are dropped. */
export function parseLookupIds(raw: unknown): string[] | null {
  if (raw == null || raw === '') return null;
  const parts = (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter((v) => UUID_RE.test(v));
  const unique = Array.from(new Set(parts.map((v) => v.toLowerCase())));
  if (unique.length > LOOKUP_MAX_IDS) throw new BadRequestException(`At most ${LOOKUP_MAX_IDS} ids per lookup.`);
  return unique;
}

/** The request's own fields: `q`, `ids`, `limit`. */
export function parseLookupRequest(query: any): LookupRequest {
  const q = query?.q == null ? '' : String(query.q).trim().slice(0, LOOKUP_MAX_TEXT);
  const limitRaw = Number(query?.limit);
  return {
    q,
    ids: parseLookupIds(query?.ids),
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : null,
  };
}

function sortKeys(spec: LookupSpec): string[] {
  return [...(spec.sort ?? [`${spec.label} COLLATE ${ICU_COLLATION}`]), 't.id'];
}

export async function runLookup<T = Record<string, unknown>>(
  manager: EntityManager,
  tenantId: string,
  spec: LookupSpec,
  request: LookupRequest,
): Promise<LookupResult<T>> {
  if (!tenantId) throw new BadRequestException('Tenant context is required.');
  const params: unknown[] = [];
  const bind: Bind = (value, cast) => {
    params.push(value);
    return cast ? `$${params.length}::${cast}` : `$${params.length}`;
  };
  const select = Object.entries(spec.columns)
    .map(([key, expr]) => `${expr} AS "${key.replace(/"/g, '')}"`)
    .join(', ');
  const where = [`t.tenant_id = ${bind(tenantId, 'uuid')}`];

  const ids = request.ids;
  if (ids) {
    if (ids.length === 0) return { items: [], has_more: false };
    where.push(`t.id = ANY(${bind(ids, 'uuid[]')})`);
    const rows = await manager.query(
      `SELECT ${select} FROM ${spec.table} t WHERE ${where.join(' AND ')} ORDER BY ${sortKeys(spec).join(', ')}`,
      params,
    );
    return { items: rows as T[], has_more: false };
  }

  const maxLimit = spec.maxLimit ?? 50;
  const limit = Math.min(Math.max(1, request.limit ?? spec.defaultLimit ?? 30), maxLimit);
  if (spec.offered) where.push(`(${spec.offered})`);
  for (const predicate of request.scope ?? []) where.push(`(${predicate(bind)})`);

  const order: string[] = [];
  const text = (request.q ?? '').trim();
  if (text) {
    // One folded needle per statement (an InitPlan), as the list engine does.
    const needle = `(SELECT ${fold(bind(text, 'text'))})`;
    const searched = [spec.label, ...(spec.search ?? [])];
    where.push(`(${searched.map((expr) => `strpos(${fold(`coalesce(${expr}, '')`)}, ${needle}) > 0`).join(' OR ')})`);
    const starts = [spec.label, ...(spec.prefixes ?? [])]
      .map((expr) => `starts_with(${fold(`coalesce(${expr}, '')`)}, ${needle})`)
      .join(' OR ');
    const wordStart = `strpos(${fold(`coalesce(${spec.label}, '')`)}, ' ' || ${needle}) > 0`;
    order.push(`CASE WHEN ${starts} THEN 0 WHEN ${wordStart} THEN 1 ELSE 2 END`);
  }
  order.push(...sortKeys(spec));

  const rows: T[] = await manager.query(
    `SELECT ${select} FROM ${spec.table} t WHERE ${where.join(' AND ')} ORDER BY ${order.join(', ')} LIMIT ${bind(limit + 1, 'int')}`,
    params,
  );
  return { items: rows.slice(0, limit), has_more: rows.length > limit };
}

/** Lifecycle of the tables with `disabled_at`: offered while not disabled yet. */
export const ACTIVE_BY_DISABLED_AT = '(t.disabled_at IS NULL OR t.disabled_at > now())';
