import { BadRequestException } from '@nestjs/common';
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
 * A person KANAP names by an email only, because they have no first or last name, as the assistant
 * and the MCP server name them: never the email (AGENTS.md, names only), never null, which would
 * read as nobody (the budget holder of a cost center, a person in a record's history).
 */
export const AI_PERSON_WITHOUT_NAME = '(person without a name)';

/**
 * The two lists of the End of support report (`technologies/reports/end-of-support.service.ts`),
 * as the assistant and the MCP server read them: `support_gaps` (one row per record to complete)
 * and `support_deadlines` (one row per deadline inside a horizon). Both are read through the
 * screen's service, never a second formula, with the report's rights and the Business
 * Contributor's application scope (`resolveAiApplicationsReach`). The service returns complete,
 * small lists: filtering, grouping, sorting and paging happen in memory, here.
 *
 * A row never carries a raw identifier: `subject` is the business reference of the record
 * (`APP-n`, `AST-n`, `TEC-n`) where the record has one, and its name otherwise. The service has
 * no reference for an asset, so the few missing ones are read here, after the service, before the
 * filters and the sort (the report's route does not need them). Identifiers stay in the item's
 * `id` only.
 */

export type SupportEntityType = 'support_gaps' | 'support_deadlines';
/** A gap row, with the other end's business reference read for the card. */
export type AiSupportGapRow = GapRow & { related_reference: string | null };
export type SupportRow = AiSupportGapRow | DeadlineRow;

/**
 * The sentence a result and its two registries share when the caller does not read applications:
 * the report leaves those rows out and its application counts are null, which is not "none".
 */
export const APPLICATIONS_UNREAD_NOTE =
  'Application rows are left out and application counts are null because you do not read applications: this is not "none".';

/** The sorts the in-memory list applies, and the fields it filters on (compared with the registries). */
export const GAP_SORTS = new Set(['gap', 'subject_type', 'subject', 'subject_name', 'related', 'version']);
export const DEADLINE_SORTS = new Set(['subject_type', 'subject', 'subject_name', 'version', 'date', 'state']);
export const GAP_FILTER_FIELDS = [
  'gap', 'subject_type', 'subject', 'subject_name', 'related', 'related_type', 'version',
] as const;
export const DEADLINE_FILTER_FIELDS = [
  'subject_type', 'subject', 'subject_name', 'version', 'date', 'state', 'end_of_support_year',
  'horizon_months', 'server_count', 'servers', 'application_count', 'applications', 'milestone',
  'standard_support_end', 'extended_support_end',
] as const;

const isDeadline = (row: SupportRow): row is DeadlineRow => 'type' in row && 'date' in row;
const isGap = (row: SupportRow): row is AiSupportGapRow => 'gap' in row;

/** A set filter model of the list (AG Grid): include, or exclude with `mode: 'exclude'`. */
export function setMatch(value: string | null, model: any): boolean {
  if (!model || model.filterType !== 'set' || !Array.isArray(model.values)) return true;
  const values = model.values.filter((entry: unknown): entry is string => typeof entry === 'string');
  const blank = model.values.some((entry: unknown) => entry === null || entry === undefined);
  const matched = values.some((entry: string) => value != null && entry === String(value)) || (value == null && blank);
  return model.mode === 'exclude' ? !matched : matched;
}

/**
 * The horizon the deadlines are read for: the screen's default, or exactly one of its values. A
 * set of several horizons cannot be read as one list, so it is refused rather than guessed.
 */
export function supportHorizon(filters: Record<string, any> | undefined): number {
  const model = filters?.horizon_months;
  if (!model || model.filterType !== 'set' || !Array.isArray(model.values)) return DEFAULT_HORIZON;
  const values = model.values
    .filter((entry: unknown): entry is string => typeof entry === 'string')
    .map((entry: string) => Number(entry))
    .filter((entry: number) => (HORIZONS as readonly number[]).includes(entry));
  if (values.length > 1) throw new BadRequestException('horizon_months takes one value: 6, 12, 24 or 36.');
  return values.length ? values[0] : DEFAULT_HORIZON;
}

function yearOf(date: string): string {
  return date.slice(0, 4);
}

/** A text filter of the list (contains, without case). */
export function textMatch(value: string | null, model: any): boolean {
  if (!model) return true;
  const needle = String(model.filter ?? '').trim().toLowerCase();
  if (!needle) return true;
  return value != null && String(value).toLowerCase().includes(needle);
}

/** A server, application or technology reference, as the screens and the cards write it. */
const REFERENCE_RE = /^(?:APP|AST|TEC)-\d+$/i;

/**
 * The `subject` and `related` filters: a reference (`APP-1`, `AST-12`, `TEC-3`, without case)
 * compares exactly with the record's reference, so `APP-1` never keeps `APP-12`; any other value
 * contains, on the name.
 */
function subjectMatch(reference: string | null, name: string | null, model: any): boolean {
  if (!model) return true;
  const needle = String(model.filter ?? '').trim();
  if (!needle) return true;
  if (REFERENCE_RE.test(needle)) {
    return reference != null && reference.toLowerCase() === needle.toLowerCase();
  }
  return name != null && String(name).toLowerCase().includes(needle.toLowerCase());
}

/** A number filter of the list (AG Grid model), against a nullable count. */
export function numberMatch(value: number | null, model: any): boolean {
  if (!model || model.filterType !== 'number') return true;
  if (model.type === 'blank') return value == null;
  if (model.type === 'notBlank') return value != null;
  const number = value == null ? null : Number(value);
  if (number == null || !Number.isFinite(number)) return false;
  const from = model.filter == null ? null : Number(model.filter);
  const to = model.filterTo == null ? null : Number(model.filterTo);
  if (model.type === 'inRange') return (from == null || number >= from) && (to == null || number <= to);
  if (from == null) return true;
  if (model.type === 'equals') return number === from;
  if (model.type === 'lessThan') return number < from;
  if (model.type === 'lessThanOrEqual') return number <= from;
  if (model.type === 'greaterThan') return number > from;
  if (model.type === 'greaterThanOrEqual') return number >= from;
  return true;
}

/** A date filter of the list, compared by day (`YYYY-MM-DD`); a null date only matches a blank filter. */
export function dateMatch(value: string | null, model: any): boolean {
  if (!model || model.filterType !== 'date') return true;
  if (model.operator === 'AND' && Array.isArray(model.conditions)) {
    return model.conditions.every((condition: any) => dateMatch(value, condition));
  }
  if (model.type === 'blank') return value == null;
  if (model.type === 'notBlank') return value != null;
  if (value == null) return false;
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
    ? [row.subject_name, row.subject_reference, row.related_reference, row.related_name, row.version]
    : [row.item_name, row.item_reference, row.version];
  return values.some((value) => value != null && String(value).toLowerCase().includes(needle));
}

function gapFiltered(rows: AiSupportGapRow[], filters: Record<string, any> | undefined): AiSupportGapRow[] {
  return rows.filter((row) => setMatch(row.gap, filters?.gap)
    && setMatch(row.subject_type, filters?.subject_type)
    && subjectMatch(row.subject_reference, row.subject_name, filters?.subject)
    && textMatch(row.subject_name, filters?.subject_name)
    && subjectMatch(row.related_reference, row.related_name, filters?.related)
    && setMatch(row.related_type, filters?.related_type)
    && textMatch(row.version, filters?.version));
}

function deadlineFiltered(rows: DeadlineRow[], filters: Record<string, any> | undefined): DeadlineRow[] {
  return rows.filter((row) => setMatch(row.type, filters?.subject_type)
    && setMatch(row.state, filters?.state)
    && setMatch(yearOf(row.date), filters?.end_of_support_year)
    && subjectMatch(row.item_reference, row.item_name, filters?.subject)
    && textMatch(row.item_name, filters?.subject_name)
    && textMatch(row.version, filters?.version)
    && dateMatch(row.date, filters?.date)
    && numberMatch(row.server_count, filters?.server_count)
    && textMatch(row.servers.map((server) => server.name).join(', '), filters?.servers)
    && numberMatch(row.application_count, filters?.application_count)
    && textMatch((row.applications ?? []).map((application) => application.name).join(', '), filters?.applications)
    && setMatch(row.milestone, filters?.milestone)
    && dateMatch(row.standard_support_end, filters?.standard_support_end)
    && dateMatch(row.extended_support_end, filters?.extended_support_end));
}

export function compareText(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

/** The row's value on a sort field, null last. */
function gapSortValue(row: AiSupportGapRow, field: string): string | number | null {
  switch (field) {
    case 'gap': return GAP_KINDS.indexOf(row.gap);
    case 'subject_type': return row.subject_type;
    case 'subject': return row.subject_reference ?? row.subject_name;
    case 'subject_name': return row.subject_name;
    case 'related': return row.related_reference ?? row.related_name;
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
    ? gapSortValue(row as AiSupportGapRow, field)
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
export function paged<T>(rows: T[], query: Record<string, any>, all = false): { items: T[]; total: number; page: number; limit: number } {
  const page = all ? 1 : Math.max(Number(query.page) || 1, 1);
  const limit = all ? 10_000 : Math.min(Math.max(Number(query.limit) || 25, 1), 500);
  const offset = (page - 1) * limit;
  return { items: rows.slice(offset, offset + limit), total: rows.length, page, limit };
}

/** The references of the assets and applications the service returned without one. */
async function readReferences(opts: ReportOpts, assetIds: string[], applicationIds: string[]): Promise<{
  assets: Map<string, string>;
  applications: Map<string, string>;
}> {
  const assets = Array.from(new Set(assetIds.filter((id): id is string => !!id)));
  const applications = Array.from(new Set(applicationIds.filter((id): id is string => !!id)));
  if (assets.length === 0 && applications.length === 0) return { assets: new Map(), applications: new Map() };
  // One statement, two unions; an empty `ANY` matches nothing.
  const rows: Array<{ kind: 'asset' | 'application'; id: string; ref: string }> = await opts.manager.query(
    `SELECT 'asset' AS kind, id, asset_reference AS ref
       FROM assets
      WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND asset_reference IS NOT NULL
     UNION ALL
     SELECT 'application' AS kind, id, sequential_id AS ref
       FROM applications
      WHERE tenant_id = $1 AND id = ANY($3::uuid[]) AND sequential_id IS NOT NULL`,
    [opts.tenantId, assets, applications],
  );
  return {
    assets: new Map(rows.filter((row) => row.kind === 'asset').map((row) => [row.id, row.ref])),
    applications: new Map(rows.filter((row) => row.kind === 'application').map((row) => [row.id, row.ref])),
  };
}

/** The other end of a gap, when it has one, with its business reference where the table holds one. */
function relatedReference(row: GapRow, references: { assets: Map<string, string>; applications: Map<string, string> }): string | null {
  if (!row.related_id) return null;
  if (row.related_type === 'asset') return references.assets.get(row.related_id) ?? null;
  if (row.related_type === 'application') return references.applications.get(row.related_id) ?? null;
  return null;
}

/** The gaps, with the references the service leaves to the screens (an asset's, a related record's). */
async function gapsWithReferences(
  service: EndOfSupportService,
  opts: ReportOpts,
  applications: AiApplicationsReach,
): Promise<AiSupportGapRow[]> {
  const report = await service.gaps(opts, applications);
  const references = await readReferences(
    opts,
    [
      ...report.items.filter((row) => row.subject_type === 'asset').map((row) => row.subject_id),
      ...report.items.filter((row) => row.related_type === 'asset').map((row) => row.related_id ?? ''),
    ],
    [
      ...report.items.filter((row) => row.subject_type === 'application').map((row) => row.subject_id),
      ...report.items.filter((row) => row.related_type === 'application').map((row) => row.related_id ?? ''),
    ],
  );
  return report.items.map((row) => ({
    ...row,
    subject_reference: row.subject_reference
      ?? (row.subject_type === 'asset' ? references.assets.get(row.subject_id) ?? null : null)
      ?? (row.subject_type === 'application' ? references.applications.get(row.subject_id) ?? null : null),
    related_reference: relatedReference(row, references),
  }));
}

/** The deadlines, with the hardware subjects' asset references. */
async function deadlinesWithReferences(
  service: EndOfSupportService,
  opts: ReportOpts,
  applications: AiApplicationsReach,
  horizon: number,
): Promise<{ report: Awaited<ReturnType<EndOfSupportService['deadlines']>>; items: DeadlineRow[] }> {
  const report = await service.deadlines({ horizon_months: horizon }, opts, applications);
  const references = await readReferences(
    opts,
    report.items.filter((row) => row.type === 'hardware' && row.item_reference == null).map((row) => row.item_id ?? ''),
    [],
  );
  return {
    report,
    items: report.items.map((row) => ({
      ...row,
      item_reference: row.item_reference
        ?? (row.type === 'hardware' ? references.assets.get(row.item_id ?? '') ?? null : null),
    })),
  };
}

export async function listAiSupportGaps(
  service: EndOfSupportService,
  opts: ReportOpts,
  applications: AiApplicationsReach,
  query: Record<string, any>,
  readAll = false,
): Promise<{ items: AiSupportGapRow[]; total: number; page: number; limit: number; applications_visible: boolean }> {
  const rows = await gapsWithReferences(service, opts, applications);
  const filtered = gapFiltered(rows, query.filters).filter((row) => matchesSearch(row, query.q));
  return { ...paged(sortRows(filtered, query.sort, 'support_gaps'), query, readAll), applications_visible: !!applications };
}

export async function listAiSupportDeadlines(
  service: EndOfSupportService,
  opts: ReportOpts,
  applications: AiApplicationsReach,
  query: Record<string, any>,
  readAll = false,
): Promise<{ items: DeadlineRow[]; total: number; page: number; limit: number; applications_visible: boolean }> {
  const { report, items } = await deadlinesWithReferences(service, opts, applications, supportHorizon(query.filters));
  const filtered = deadlineFiltered(items, query.filters).filter((row) => matchesSearch(row, query.q));
  return { ...paged(sortRows(filtered, query.sort, 'support_deadlines'), query, readAll), applications_visible: report.applications_visible };
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
