import {
  DEFAULT_HORIZON,
  EndOfSupportService,
  GAP_KINDS,
  HORIZONS,
  type DeadlineRow,
  type GapRow,
  type ReportOpts,
} from '../../technologies/reports/end-of-support.service';
import type { AiApplicationsReach } from './ai-technologies.query';

/**
 * The two lists of the End of support report (`technologies/reports/end-of-support.service.ts`),
 * as the assistant and the MCP server read them: `support_gaps` (one row per record to complete)
 * and `support_deadlines` (one row per deadline inside a horizon). Both are read through the
 * screen's service, never a second formula, with the report's rights and the Business
 * Contributor's application scope (`resolveAiApplicationsReach`). The service returns complete,
 * small lists: filtering, grouping, sorting and paging happen in memory, here.
 *
 * A row never carries a raw identifier: `subject` is the business reference of the record
 * (`APP-n`, `TEC-n`) where the service has one, and its name otherwise. Identifiers stay in the
 * item's `id` only.
 */

export type SupportEntityType = 'support_gaps' | 'support_deadlines';
export type SupportRow = GapRow | DeadlineRow;

const isDeadline = (row: SupportRow): row is DeadlineRow => 'type' in row && 'date' in row;
const isGap = (row: SupportRow): row is GapRow => 'gap' in row;

const GAP_SORTS = new Set(['gap', 'subject_type', 'subject', 'subject_name', 'related', 'version']);
const DEADLINE_SORTS = new Set(['subject_type', 'subject', 'subject_name', 'date', 'state', 'version']);

/** A set filter model of the list (AG Grid): include, or exclude with `mode: 'exclude'`. */
function setMatch(value: string | null, model: any): boolean {
  if (!model || model.filterType !== 'set' || !Array.isArray(model.values)) return true;
  const values = model.values.filter((entry: unknown): entry is string => typeof entry === 'string');
  const blank = model.values.some((entry: unknown) => entry === null || entry === undefined);
  const matched = values.some((entry: string) => value != null && entry === String(value)) || (value == null && blank);
  return model.mode === 'exclude' ? !matched : matched;
}

/** The horizon the deadlines are read for: the largest value the filter keeps, the screen's default otherwise. */
export function supportHorizon(filters: Record<string, any> | undefined): number {
  const model = filters?.horizon_months;
  if (!model || model.filterType !== 'set' || !Array.isArray(model.values)) return DEFAULT_HORIZON;
  const values = model.values
    .filter((entry: unknown): entry is string => typeof entry === 'string')
    .map((entry: string) => Number(entry))
    .filter((entry: number) => (HORIZONS as readonly number[]).includes(entry));
  return values.length ? Math.max(...values) : DEFAULT_HORIZON;
}

function yearOf(date: string): string {
  return date.slice(0, 4);
}

/** A text filter of the list (contains, without case). */
function textMatch(value: string | null, model: any): boolean {
  if (!model) return true;
  const needle = String(model.filter ?? '').trim().toLowerCase();
  if (!needle) return true;
  return value != null && String(value).toLowerCase().includes(needle);
}

/** A date filter of the list, compared by day (`YYYY-MM-DD`). */
function dateMatch(value: string, model: any): boolean {
  if (!model || model.filterType !== 'date') return true;
  if (model.type === 'blank') return false;
  if (model.type === 'notBlank') return true;
  const day = value.slice(0, 10);
  const from = model.dateFrom == null ? null : String(model.dateFrom).slice(0, 10);
  const to = model.dateTo == null ? null : String(model.dateTo).slice(0, 10);
  if (model.type === 'inRange') return (!from || day >= from) && (!to || day <= to);
  if (!from) return true;
  if (model.type === 'equals') return day === from;
  if (model.type === 'lessThan') return day < from;
  if (model.type === 'lessThanOrEqual') return day <= from;
  if (model.type === 'greaterThan') return day > from;
  if (model.type === 'greaterThanOrEqual') return day >= from;
  return true;
}

function matchesSearch(row: SupportRow, q: string | undefined): boolean {
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return true;
  const values = isGap(row)
    ? [row.subject_name, row.subject_reference, row.related_name, row.version]
    : [row.item_name, row.item_reference, row.version];
  return values.some((value) => value != null && String(value).toLowerCase().includes(needle));
}

function gapFiltered(rows: GapRow[], filters: Record<string, any> | undefined): GapRow[] {
  return rows.filter((row) => setMatch(row.gap, filters?.gap)
    && setMatch(row.subject_type, filters?.subject_type)
    && textMatch(row.subject_reference ?? row.subject_name, filters?.subject)
    && textMatch(row.subject_name, filters?.subject_name)
    && textMatch(row.related_name, filters?.related)
    && textMatch(row.version, filters?.version));
}

function deadlineFiltered(rows: DeadlineRow[], filters: Record<string, any> | undefined): DeadlineRow[] {
  return rows.filter((row) => setMatch(row.type, filters?.subject_type)
    && setMatch(row.state, filters?.state)
    && setMatch(yearOf(row.date), filters?.end_of_support_year)
    && textMatch(row.item_reference ?? row.item_name, filters?.subject)
    && textMatch(row.item_name, filters?.subject_name)
    && textMatch(row.version, filters?.version)
    && dateMatch(row.date, filters?.date));
}

function compareText(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

/** The row's value on a sort field, null last. */
function gapSortValue(row: GapRow, field: string): string | number | null {
  switch (field) {
    case 'gap': return GAP_KINDS.indexOf(row.gap);
    case 'subject_type': return row.subject_type;
    case 'subject': return row.subject_reference ?? row.subject_name;
    case 'subject_name': return row.subject_name;
    case 'related': return row.related_name;
    case 'version': return row.version;
    default: return null;
  }
}

function deadlineSortValue(row: DeadlineRow, field: string): string | null {
  switch (field) {
    case 'subject_type': return row.type;
    case 'subject': return row.item_reference ?? row.item_name;
    case 'subject_name': return row.item_name;
    case 'date': return row.date;
    case 'state': return row.state;
    case 'version': return row.version;
    default: return null;
  }
}

function sortRows<T extends SupportRow>(rows: T[], sort: string | undefined, entityType: SupportEntityType): T[] {
  const [requested, requestedDirection] = String(sort ?? '').split(':');
  const field = entityType === 'support_gaps'
    ? (GAP_SORTS.has(requested) ? requested : 'gap')
    : (DEADLINE_SORTS.has(requested) ? requested : 'date');
  const direction = String(requestedDirection ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const valueOf = (row: T): string | number | null => (entityType === 'support_gaps'
    ? gapSortValue(row as GapRow, field)
    : deadlineSortValue(row as DeadlineRow, field));
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row) }))
    .sort((a, b) => {
      let order: number;
      if (typeof a.value === 'number' && typeof b.value === 'number') order = a.value - b.value;
      else order = compareText(a.value == null ? null : String(a.value), b.value == null ? null : String(b.value));
      if (order === 0) return a.index - b.index;
      return direction === 'DESC' ? -order : order;
    })
    .map((entry) => entry.row);
}

/**
 * The list window over the filtered rows. A page is at most 500 rows; the aggregate reads every
 * row (`all`), the lists being complete and small.
 */
function paged<T>(rows: T[], query: Record<string, any>, all = false): { items: T[]; total: number; page: number; limit: number } {
  const page = all ? 1 : Math.max(Number(query.page) || 1, 1);
  const limit = all ? 10_000 : Math.min(Math.max(Number(query.limit) || 25, 1), 500);
  const offset = (page - 1) * limit;
  return { items: rows.slice(offset, offset + limit), total: rows.length, page, limit };
}

export async function listAiSupportGaps(
  service: EndOfSupportService,
  opts: ReportOpts,
  applications: AiApplicationsReach,
  query: Record<string, any>,
  readAll = false,
): Promise<{ items: GapRow[]; total: number; page: number; limit: number }> {
  const report = await service.gaps(opts, applications);
  const rows = gapFiltered(report.items, query.filters).filter((row) => matchesSearch(row, query.q));
  return paged(sortRows(rows, query.sort, 'support_gaps'), query, readAll);
}

export async function listAiSupportDeadlines(
  service: EndOfSupportService,
  opts: ReportOpts,
  applications: AiApplicationsReach,
  query: Record<string, any>,
  readAll = false,
): Promise<{ items: DeadlineRow[]; total: number; page: number; limit: number }> {
  const report = await service.deadlines({ horizon_months: supportHorizon(query.filters) }, opts, applications);
  const rows = deadlineFiltered(report.items, query.filters).filter((row) => matchesSearch(row, query.q));
  return paged(sortRows(rows, query.sort, 'support_deadlines'), query, readAll);
}

/** The group key of a support row, for the in-memory aggregate. */
export function supportGroupValue(entityType: SupportEntityType, row: SupportRow, groupBy: string): string | null {
  if (isGap(row)) {
    if (groupBy === 'gap') return row.gap;
    if (groupBy === 'subject_type') return row.subject_type;
    return null;
  }
  if (groupBy === 'subject_type') return row.type;
  if (groupBy === 'state') return row.state;
  if (groupBy === 'end_of_support_year') return yearOf(row.date);
  return null;
}

export type SupportAggregateGroup =
  | { key: string | null; count: number }
  | { key: string | null; value: number | string | null };

/**
 * count, or min/max of the deadline date, per group of the filtered rows (the lists are small:
 * the aggregate is in memory, as the list is).
 */
export function aggregateSupportRows(
  entityType: SupportEntityType,
  rows: SupportRow[],
  groupBy: string,
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max',
  metric: string | null,
): SupportAggregateGroup[] {
  const groups = new Map<string | null, SupportRow[]>();
  for (const row of rows) {
    const key = supportGroupValue(entityType, row, groupBy);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  if (fn === 'count' || !metric) {
    return [...groups.entries()]
      .map(([key, entries]) => ({ key, count: entries.length }))
      .sort((a, b) => b.count - a.count || (a.key == null ? 1 : b.key == null ? -1 : a.key.localeCompare(b.key)));
  }
  const values = [...groups.entries()].map(([key, entries]) => {
    const dates = entries
      .filter((row): row is DeadlineRow => isDeadline(row))
      .map((row) => row.date)
      .filter((date): date is string => !!date)
      .sort();
    const value = dates.length === 0 ? null : fn === 'min' ? dates[0] : dates[dates.length - 1];
    return { key, value };
  });
  return values.sort((a, b) => {
    if (a.value == null || b.value == null) {
      if (a.value != null) return -1;
      if (b.value != null) return 1;
    } else if (a.value !== b.value) {
      return fn === 'min' ? String(a.value).localeCompare(String(b.value)) : String(b.value).localeCompare(String(a.value));
    }
    if (a.key == null) return b.key == null ? 0 : 1;
    if (b.key == null) return -1;
    return a.key.localeCompare(b.key);
  });
}

/** The metrics the two families take: none on the gaps, the deadline date on the deadlines. */
export function supportMetricType(entityType: SupportEntityType, metric: string): 'date' | null {
  return entityType === 'support_deadlines' && metric === 'date' ? 'date' : null;
}
