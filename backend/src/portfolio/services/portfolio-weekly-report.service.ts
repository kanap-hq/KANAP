import { Injectable } from '@nestjs/common';
import AdmZip = require('adm-zip');
import { EntityManager } from 'typeorm';
import { neutralizeCsvFormulaValue } from '../../common/csv/csv-export.service';
import { normalizeReportTimeZone } from '../../common/report-period';
import {
  projectProjectTeamPredicates,
  pushSetFilter,
  pushSetFilterExpr,
  requestProjectTeamPredicates,
  taskProjectTeamPredicates,
  timeEntryProjectTeamFilters,
} from './portfolio-report-filters';

export type WeeklyReportQuery = {
  tenantId: string;
  startDate: string;
  endDate: string;
  /** IANA zone of the viewer: the period and every event day are read in it. */
  timeZone?: string;
  sourceIds?: string[];
  categoryIds?: string[];
  streamIds?: string[];
  taskTypeIds?: string[];
  /**
   * Status reached: the status left by the last status event of the period (a creation, or an
   * update that changed the status). An item with no status event in the period matches none.
   */
  statuses?: string[];
  /**
   * Projects and teams: tasks hanging off the projects or assigned to a team member, the
   * projects themselves or the ones a member is involved in, the requests linked to the
   * projects or involving a member. The logged time follows them too.
   */
  projectIds?: string[];
  teamIds?: string[];
  /**
   * The objects the report covers. The others are not queried and come back as empty lists,
   * and the exports leave their blocks out. Empty means all three.
   */
  entities?: WeeklyEntity[];
  /** `person` adds the by-person reading of the task lists; `type` is the historical shape. */
  groupBy?: WeeklyGroupBy;
};

export type WeeklyGroupBy = 'type' | 'person';

export const WEEKLY_ENTITIES = ['request', 'project', 'task'] as const;
export type WeeklyEntity = (typeof WEEKLY_ENTITIES)[number];

/** Whether the report covers an object: every object when none is named. */
const covers = (query: WeeklyReportQuery, entity: WeeklyEntity): boolean =>
  !query.entities || query.entities.length === 0 || query.entities.includes(entity);

const emptyLists = <TRow>(): WeeklyLists<TRow> => ({ created: [], modified: [], closed: [] });

/** How a changed value reads: the screen and the export format each kind their own way. */
export type WeeklyChangeKind = 'text' | 'date' | 'number' | 'boolean' | 'list' | 'ref';

/**
 * One column that changed over the period: the value it held before its first change and the
 * value it held after its last one. A column back to where it started is not listed.
 *
 * Values are strings, ready to format: a day as `YYYY-MM-DD`, a number as written, a boolean as
 * `true` / `false`, a list as its item count, a text in plain words cut at 60 characters, and a
 * reference as the name of what it points to (`''` when that record no longer exists). `null`
 * is an empty value.
 */
export type WeeklyFieldChange = {
  key: string;
  before: string | null;
  after: string | null;
  kind: WeeklyChangeKind;
};

/** What changed on an item during the period, for the "modified" lists. */
export type WeeklyChangeSummary = {
  /**
   * Every status the item went through over the period, in order: the status before the first
   * move, then the status each move left. Consecutive repeats merged; empty with no status move.
   */
  statusChain: string[];
  /** Columns that actually changed, noise excluded, in key order. */
  fields: WeeklyFieldChange[];
};

/** Where a project came from: the request it was converted from, when there is one. */
export type WeeklyProjectOrigin = {
  ref: string;
  name: string;
  itemPath: string;
};

type WeeklyRowCommon = {
  /** Business reference as the lists show it (REQ-12, PRJ-3, T-4). */
  ref: string;
  itemPath: string;
  name: string;
  sourceId: string | null;
  sourceName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  streamId: string | null;
  streamName: string | null;
  /** Company name. A task with none reads its project's, like its source and category. */
  company: string | null;
  /** Current status of the live row. */
  status: string;
  /** Day the item was created, whether or not that day falls in the period. */
  createdAt: string | null;
  /** Creation, last modification or closing day, depending on the list. */
  eventAt: string | null;
  /** Filled on the "modified" list only. */
  changes: WeeklyChangeSummary | null;
};

export type WeeklyProjectRow = WeeklyRowCommon & {
  projectId: string;
  priority: number | null;
  progress: number | null;
  /** The request the project was converted from, when there is one. */
  origin: WeeklyProjectOrigin | null;
  /** Raw `portfolio_projects.origin`: standard, fast_track or legacy. */
  originValue: string | null;
};

export type WeeklyTaskRow = WeeklyRowCommon & {
  taskId: string;
  taskTypeId: string | null;
  taskTypeName: string | null;
  priority: number | null;
};

export type WeeklyRequestRow = WeeklyRowCommon & {
  requestId: string;
};

export type WeeklyLists<TRow> = {
  created: TRow[];
  modified: TRow[];
  closed: TRow[];
};

/** The three task lists as one person carries them. Same rows as the by-type task section. */
export type WeeklyPersonLists = {
  created: WeeklyTaskRow[];
  modified: WeeklyTaskRow[];
  closed: WeeklyTaskRow[];
};

/** Days logged over the period, hours divided by eight, one decimal. */
export type WeeklyLoggedDays = { project: number; other: number; total: number };

export type WeeklyPerson = WeeklyPersonLists & {
  userId: string;
  name: string;
  contributorRef: string | null;
  loggedDays: WeeklyLoggedDays;
};

export type WeeklyTeamGroup = {
  teamId: string | null;
  teamName: string | null;
  members: WeeklyPerson[];
  totals: { created: number; modified: number; closed: number; loggedDays: number };
};

/**
 * Tasks and logged time read person by person. Requests and projects have several owners at
 * once, so they stay in the by-type view and never appear here.
 */
export type WeeklyByPerson = {
  teams: WeeklyTeamGroup[];
  /** Closed with no assignee, created or modified with no actor (an import, an agent). */
  unassigned: WeeklyPersonLists;
};

export type WeeklyReportResult = {
  requests: WeeklyLists<WeeklyRequestRow>;
  projects: WeeklyLists<WeeklyProjectRow>;
  tasks: WeeklyLists<WeeklyTaskRow>;
  byPerson?: WeeklyByPerson;
};

export type WeeklyFilterValues = {
  sources: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  streams: Array<{ id: string; name: string; categoryId: string | null }>;
  taskTypes: Array<{ id: string; name: string }>;
};

type ServiceOpts = { manager?: EntityManager };

type ExportResult<TContent> = {
  filename: string;
  content: TContent;
};

type SheetCellValue = string | number | null;

type XlsxSheetConfig = {
  name: string;
  headers: string[];
  rows: Array<{ cells: SheetCellValue[]; linkPath: string | null }>;
  /** 1-based column the row link is written on. Defaults to the reference column. */
  linkColumnNumber?: number;
};

/**
 * Statuses that count as "closed" per entity. Requests have no cancelled state:
 * a request leaves the funnel either converted into a project or rejected.
 */
export const CLOSED_STATUSES = {
  requests: ['converted', 'rejected'],
  projects: ['done', 'cancelled'],
  tasks: ['done', 'cancelled'],
} as const;

/**
 * Keys ignored when listing what changed on an item. `updated_at` is rewritten on
 * every save, `status` gets its own chain, and `id`, `tenant_id`, `item_number` and
 * `created_at` identify the row rather than describe it. `related_object_type` moves with
 * `related_object_id`, which carries the change under the same label. Keys starting with
 * `__` (the `__csv_managed_*` import markers) are technical too and are dropped in SQL.
 */
const CHANGE_NOISE_KEYS = [
  'updated_at',
  'created_at',
  'id',
  'tenant_id',
  'item_number',
  'status',
  'related_object_type',
];

/** Longest text a change shows before it is cut. */
const CHANGE_TEXT_MAX = 60;

/**
 * Columns that hold a reference, and the table that names it. Each table is read once per
 * report for every id met, never per row.
 */
const USER_REF_KEYS = [
  'assignee_user_id',
  'requestor_id',
  'business_sponsor_id',
  'business_lead_id',
  'it_sponsor_id',
  'it_lead_id',
  'creator_id',
  'created_by_id',
];

type RefTable = { table: string; nameSql: (alias: string) => string };

/** Display name of a user, as the by-person view shows it: names only, never an email. */
const userNameSql = (alias: string): string => `COALESCE(
          NULLIF(TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), ''),
          split_part(${alias}.email, '@', 1)
        )`;

const namedTable = (table: string, column = 'name'): RefTable => ({
  table,
  nameSql: (alias) => `${alias}.${column}`,
});

const USERS_REF: RefTable = { table: 'users', nameSql: userNameSql };

const REF_TABLES: Record<string, RefTable> = {
  ...Object.fromEntries(USER_REF_KEYS.map((key) => [key, USERS_REF])),
  source_id: namedTable('portfolio_sources'),
  category_id: namedTable('portfolio_categories'),
  stream_id: namedTable('portfolio_streams'),
  company_id: namedTable('companies'),
  department_id: namedTable('departments'),
  task_type_id: namedTable('portfolio_task_types'),
  phase_id: namedTable('portfolio_project_phases'),
  // The report lists only tasks with no parent or hanging off a project.
  related_object_id: namedTable('portfolio_projects'),
  origin_task_id: namedTable('tasks', 'title'),
};

/**
 * KANAP vocabulary for `portfolio_projects.origin`. The exports have no i18n, so they
 * carry the English labels the UI shows for the same values.
 */
const ORIGIN_EXPORT_LABELS: Record<string, string> = {
  standard: 'Request',
  fast_track: 'Fast-track',
  legacy: 'Legacy',
};

/**
 * Column shape of an export block. The three list keys mirror the on-screen lists;
 * `all` is the single sheet the XLSX writes, where every event kind shares one table.
 */
type ExportShape = 'created' | 'modified' | 'closed' | 'all';

/** Date columns of an export block, in order. */
const dateHeaders = (shape: ExportShape): string[] => {
  if (shape === 'created') return ['Created on'];
  if (shape === 'modified') return ['Modified on'];
  if (shape === 'closed') return ['Created on', 'Closed on'];
  return ['Created on', 'Date'];
};

const dateCells = (row: WeeklyRowCommon, shape: ExportShape): SheetCellValue[] => {
  if (shape === 'created') return [row.eventAt];
  if (shape === 'modified') return [row.eventAt];
  return [row.createdAt, row.eventAt];
};

const changeHeaders = (shape: ExportShape): string[] =>
  shape === 'modified' || shape === 'all' ? ['Changes'] : [];

const changeCells = (row: WeeklyRowCommon, shape: ExportShape, entity: ExportChangeEntity): SheetCellValue[] =>
  shape === 'modified' || shape === 'all' ? [formatChanges(row.changes, entity)] : [];

/** The status reached over the period, as `status_reached` resolves it in `eventCtes`. */
const STATUS_REACHED_EXPR = 'sr.status';

const BOM = '﻿';

const xmlEscape = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Escape a CSV field. Formula neutralisation comes first: this writer hand-rolls its CSV
 * instead of going through CsvExportService, so nothing else would protect a value that a
 * spreadsheet would otherwise evaluate (a leading =, +, - or @).
 */
const csvEscape = (value: unknown): string => {
  const raw = neutralizeCsvFormulaValue(String(value ?? ''));
  if (!raw.includes(';') && !raw.includes('"') && !raw.includes('\n') && !raw.includes('\r')) {
    return raw;
  }
  return `"${raw.replace(/"/g, '""')}"`;
};

const columnNumberToName = (columnNumber: number): string => {
  let num = columnNumber;
  let name = '';
  while (num > 0) {
    const remainder = (num - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    num = Math.floor((num - 1) / 26);
  }
  return name;
};

const toNumber = (value: number | string | null): number | null => {
  if (value == null) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

/**
 * English labels of the changed columns, the words the screen uses (`WeeklyReportChangeLabels.ts`
 * on the frontend, from the item history labels). The exports have no i18n, so the English
 * wording is kept here; a column missing from both maps falls back to `humanizeKey`.
 */
const PORTFOLIO_CHANGE_LABELS: Record<string, string> = {
  name: 'Name',
  purpose: 'Purpose',
  current_situation: 'Current situation',
  expected_benefits: 'Expected benefits',
  risks: 'Risks',
  feasibility_review: 'Feasibility review',
  source_id: 'Source',
  category_id: 'Category',
  stream_id: 'Stream',
  requestor_id: 'Requestor',
  target_delivery_date: 'Target delivery date',
  origin_task_id: 'Origin task',
  origin_task: 'Origin task',
  company_id: 'Company',
  department_id: 'Department',
  business_sponsor_id: 'Business sponsor',
  business_lead_id: 'Business lead',
  it_sponsor_id: 'IT sponsor',
  it_lead_id: 'IT lead',
  planned_start: 'Planned start',
  planned_end: 'Planned end',
  actual_start: 'Actual start',
  actual_end: 'Actual end',
  converted_date: 'Converted on',
  estimated_effort_it: 'IT effort',
  estimated_effort_business: 'Business effort',
  actual_effort_it: 'Actual IT effort',
  actual_effort_business: 'Actual business effort',
  execution_progress: 'Effort',
  priority_score: 'Priority score',
  priority_override: 'Priority override',
  override_value: 'Override value',
  override_justification: 'Override justification',
  criteria_values: 'Evaluation criteria',
  scheduling_mode: 'Scheduling mode',
  it_effort_allocation_mode: 'IT effort allocation mode',
  business_effort_allocation_mode: 'Business effort allocation mode',
};

const TASK_CHANGE_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  task_type_id: 'Task type',
  priority_level: 'Priority',
  creator_id: 'Requestor',
  assignee_user_id: 'Assignee',
  due_date: 'Due date',
  start_date: 'Start date',
  labels: 'Labels',
  phase_id: 'Phase',
  source_id: 'Source',
  category_id: 'Category',
  stream_id: 'Stream',
  company_id: 'Company',
  owner_ids: 'Owners',
  viewer_ids: 'Viewers',
  related_object_id: 'Related to',
  related_object_type: 'Related to',
};

type ExportChangeEntity = 'request' | 'project' | 'task';

const changeLabel = (entity: ExportChangeEntity, key: string): string =>
  (entity === 'task' ? TASK_CHANGE_LABELS[key] : PORTFOLIO_CHANGE_LABELS[key]) ?? humanizeKey(key);

const humanizeKey = (key: string): string =>
  key
    .replace(/_id$/, '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

const humanizeStatus = (status: string): string =>
  status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/**
 * One changed value in the export, the way the screen writes it but in English: the exports
 * have no i18n. Days stay `YYYY-MM-DD`, like every other date column of the export.
 */
export const formatExportChangeValue = (kind: WeeklyChangeKind, value: string | null): string => {
  if (value === null) return 'empty';
  if (kind === 'ref' && value === '') return 'unknown';
  if (kind === 'boolean') return value === 'true' ? 'Yes' : 'No';
  if (kind === 'list') return Number(value) === 1 ? '1 item' : `${value} items`;
  return value;
};

/**
 * Human readable "Changes" cell for the exports: the status chain, then one
 * "Label: before → after" per field, `;` between the parts.
 */
export const formatChanges = (changes: WeeklyChangeSummary | null, entity: ExportChangeEntity): string => {
  if (!changes) return '';
  const parts: string[] = [];
  if (changes.statusChain.length > 1) {
    parts.push(changes.statusChain.map(humanizeStatus).join(' → '));
  }
  changes.fields.forEach((field) => {
    const before = formatExportChangeValue(field.kind, field.before);
    const after = formatExportChangeValue(field.kind, field.after);
    parts.push(`${changeLabel(entity, field.key)}: ${before} → ${after}`);
  });
  return parts.join('; ');
};

/** Statuses in order, empty values dropped and consecutive repeats merged. */
const mergeStatusChain = (statuses: Array<string | null> | null): string[] => {
  const chain: string[] = [];
  (statuses ?? []).forEach((status) => {
    if (!status) return;
    if (chain[chain.length - 1] !== status) chain.push(status);
  });
  return chain;
};

/** One changed column as the SQL returns it: the raw jsonb values at the period's bounds. */
type RawFieldChange = { key: string; before: unknown; after: unknown };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Plain words out of a rich text value, cut at the change text length. */
const shortText = (value: string): string => {
  const plain = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > CHANGE_TEXT_MAX ? `${plain.slice(0, CHANGE_TEXT_MAX).trimEnd()}…` : plain;
};

/** The day a timestamp falls on in the report's zone. */
const dayInZone = (value: string, timeZone: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  // en-CA writes YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

/** The kind one audit value reads as, or `null` for an empty value, which says nothing. */
const valueKind = (key: string, value: unknown): WeeklyChangeKind | null => {
  if (value === null || value === undefined) return null;
  if (REF_TABLES[key]) return 'ref';
  if (Array.isArray(value) || typeof value === 'object') return 'list';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  const text = String(value);
  if (ISO_DAY.test(text) || ISO_TIMESTAMP.test(text)) return 'date';
  if (NUMERIC.test(text)) return 'number';
  return 'text';
};

/** One audit value as the summary carries it, given the kind of its field. */
const changeValue = (kind: WeeklyChangeKind, value: unknown, timeZone: string): string | null => {
  if (value === null || value === undefined) return null;
  if (kind === 'list') {
    if (Array.isArray(value)) return String(value.length);
    if (typeof value === 'object') return String(Object.keys(value as object).length);
  }
  if (kind === 'boolean') return value ? 'true' : 'false';
  const text = String(value);
  if (kind === 'date') return ISO_TIMESTAMP.test(text) ? dayInZone(text, timeZone) : text;
  if (kind === 'text') return shortText(text);
  return text;
};

/**
 * The summary of one field from its first "before" and last "after" audit values. A reference
 * still holds its id here: `resolveChangeRefs` swaps it for a name once every list is read.
 */
const buildFieldChange = (raw: RawFieldChange, timeZone: string): WeeklyFieldChange => {
  const kind = valueKind(raw.key, raw.before) ?? valueKind(raw.key, raw.after) ?? 'text';
  return {
    key: raw.key,
    before: changeValue(kind, raw.before, timeZone),
    after: changeValue(kind, raw.after, timeZone),
    kind,
  };
};

/** Raw shape shared by the three queries, before the entity specific columns. */
type RawEventRow = {
  record_id: string;
  name: string | null;
  item_number: number | string | null;
  source_id: string | null;
  source_name: string | null;
  category_id: string | null;
  category_name: string | null;
  stream_id: string | null;
  stream_name: string | null;
  company_name: string | null;
  status: string | null;
  live_created_day: string | null;
  created_day: string | null;
  modified_day: string | null;
  closed_day: string | null;
  update_count: number | string;
  status_chain: Array<string | null> | null;
  field_changes: RawFieldChange[] | null;
};

type RawProjectEventRow = RawEventRow & {
  priority: number | string | null;
  progress: number | string | null;
  origin_number: number | string | null;
  origin_name: string | null;
  origin_value: string | null;
};

type RawTaskEventRow = RawEventRow & {
  priority: number | string | null;
  task_type_id: string | null;
  task_type_name: string | null;
  /** Person columns, selected in person mode only. */
  creator_user_id?: string | null;
  modifier_user_ids?: string[] | null;
  closing_assignee_id?: string | null;
};

/** One task row as it lands in one of the three lists, with who carried that event. */
type TaskEntry = {
  row: WeeklyTaskRow;
  listKey: 'created' | 'modified' | 'closed';
  raw: RawTaskEventRow;
};

type PersonRow = {
  user_id: string;
  name: string | null;
  item_number: number | string | null;
  team_id: string | null;
  team_name: string | null;
};

type LoggedHoursRow = {
  user_id: string;
  project_hours: number | string | null;
  other_hours: number | string | null;
};

/** Hours to days on the KANAP eight-hour day, one decimal, never a float artefact. */
const hoursToDays = (hours: number): number => Math.round((hours / 8) * 10) / 10;

const roundDays = (days: number): number => Math.round(days * 10) / 10;

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

@Injectable()
export class PortfolioWeeklyReportService {
  async list(query: WeeklyReportQuery, opts?: ServiceOpts): Promise<WeeklyReportResult> {
    // An object the report does not cover is not queried at all.
    const requests = covers(query, 'request')
      ? await this.fetchRequestLists(query, opts)
      : emptyLists<WeeklyRequestRow>();
    const projects = covers(query, 'project')
      ? await this.fetchProjectLists(query, opts)
      : emptyLists<WeeklyProjectRow>();
    const { lists: tasks, entries } = covers(query, 'task')
      ? await this.fetchTaskLists(query, opts)
      : { lists: emptyLists<WeeklyTaskRow>(), entries: [] as TaskEntry[] };
    // The by-person lists share these row objects: resolving here names them there too.
    await this.resolveChangeRefs(
      query.tenantId,
      [...requests.modified, ...projects.modified, ...tasks.modified],
      opts,
    );
    if (query.groupBy !== 'person') return { requests, projects, tasks };

    const byPerson = await this.buildByPerson(query, entries, opts);
    return { requests, projects, tasks, byPerson };
  }

  async listFilterValues(tenantId: string, opts?: ServiceOpts): Promise<WeeklyFilterValues> {
    const mg = opts?.manager;
    if (!mg) {
      return {
        sources: [],
        categories: [],
        streams: [],
        taskTypes: [],
      };
    }

    const [sourcesRaw, categoriesRaw, streamsRaw, taskTypesRaw] = await Promise.all([
      mg.query(
        `
        SELECT id, name
        FROM portfolio_sources
        WHERE tenant_id = $1
          AND is_active = true
        ORDER BY display_order ASC, name ASC
        `,
        [tenantId],
      ),
      mg.query(
        `
        SELECT id, name
        FROM portfolio_categories
        WHERE tenant_id = $1
          AND is_active = true
        ORDER BY display_order ASC, name ASC
        `,
        [tenantId],
      ),
      mg.query(
        `
        SELECT id, name, category_id
        FROM portfolio_streams
        WHERE tenant_id = $1
          AND is_active = true
        ORDER BY display_order ASC, name ASC
        `,
        [tenantId],
      ),
      mg.query(
        `
        SELECT id, name
        FROM portfolio_task_types
        WHERE tenant_id = $1
          AND is_active = true
        ORDER BY display_order ASC, name ASC
        `,
        [tenantId],
      ),
    ]);

    return {
      sources: (sourcesRaw as Array<{ id: string; name: string }>).map((row) => ({
        id: row.id,
        name: row.name,
      })),
      categories: (categoriesRaw as Array<{ id: string; name: string }>).map((row) => ({
        id: row.id,
        name: row.name,
      })),
      streams: (streamsRaw as Array<{ id: string; name: string; category_id: string | null }>).map((row) => ({
        id: row.id,
        name: row.name,
        categoryId: row.category_id ?? null,
      })),
      taskTypes: (taskTypesRaw as Array<{ id: string; name: string }>).map((row) => ({
        id: row.id,
        name: row.name,
      })),
    };
  }

  async exportCsv(query: WeeklyReportQuery, opts?: ServiceOpts): Promise<ExportResult<string>> {
    const { requests, projects, tasks, byPerson } = await this.list(query, opts);

    const lines: string[] = [];
    const addRow = (values: unknown[]) => {
      lines.push(values.map((value) => csvEscape(value)).join(';'));
    };

    const addBlock = (heading: string, headers: string[], rows: SheetCellValue[][]) => {
      if (lines.length > 0) lines.push('');
      addRow([heading]);
      addRow(headers);
      rows.forEach((cells) => addRow(cells));
    };

    // Only the objects the report covers get blocks.
    if (covers(query, 'request')) {
      (['created', 'modified', 'closed'] as const).forEach((listKey) => {
        addBlock(
          `Requests ${listKey}`,
          this.requestHeaders(listKey),
          requests[listKey].map((row) => this.requestCells(row, listKey)),
        );
      });
    }

    if (covers(query, 'project')) {
      (['created', 'modified', 'closed'] as const).forEach((listKey) => {
        addBlock(
          `Projects ${listKey}`,
          this.projectHeaders(listKey),
          projects[listKey].map((row) => this.projectCells(row, listKey)),
        );
      });
    }

    if (!covers(query, 'task')) {
      // No task block at all.
    } else if (byPerson) {
      addBlock(
        'Tasks by person',
        this.personTaskHeaders(),
        this.personTaskRows(byPerson).map((row) => row.cells),
      );
    } else {
      (['created', 'modified', 'closed'] as const).forEach((listKey) => {
        addBlock(
          `Tasks ${listKey}`,
          this.taskHeaders(listKey),
          tasks[listKey].map((row) => this.taskCells(row, listKey)),
        );
      });
    }

    return {
      filename: this.buildFilename(query, 'csv'),
      content: BOM + lines.join('\n'),
    };
  }

  async exportXlsx(
    query: WeeklyReportQuery,
    appBaseUrl: string | null,
    opts?: ServiceOpts,
  ): Promise<ExportResult<Buffer>> {
    const { requests, projects, tasks, byPerson } = await this.list(query, opts);

    const eventLabel = { created: 'Created', modified: 'Modified', closed: 'Closed' } as const;
    const listKeys = ['created', 'modified', 'closed'] as const;

    const taskSheet: XlsxSheetConfig = byPerson
      ? {
          name: 'Tasks',
          headers: this.personTaskHeaders(),
          rows: this.personTaskRows(byPerson),
          // Team, person and list come first: the reference sits on the fourth column.
          linkColumnNumber: 4,
        }
      : {
          name: 'Tasks',
          headers: ['Event', ...this.taskHeaders('all')],
          rows: listKeys.flatMap((listKey) =>
            tasks[listKey].map((row) => ({
              cells: [eventLabel[listKey], ...this.taskCells(row, 'all')] as SheetCellValue[],
              linkPath: row.itemPath,
            })),
          ),
        };

    const requestSheet: XlsxSheetConfig = {
      name: 'Requests',
      headers: ['Event', ...this.requestHeaders('all')],
      rows: listKeys.flatMap((listKey) =>
        requests[listKey].map((row) => ({
          cells: [eventLabel[listKey], ...this.requestCells(row, 'all')] as SheetCellValue[],
          linkPath: row.itemPath,
        })),
      ),
    };
    const projectSheet: XlsxSheetConfig = {
      name: 'Projects',
      headers: ['Event', ...this.projectHeaders('all')],
      rows: listKeys.flatMap((listKey) =>
        projects[listKey].map((row) => ({
          cells: [eventLabel[listKey], ...this.projectCells(row, 'all')] as SheetCellValue[],
          linkPath: row.itemPath,
        })),
      ),
    };

    // Only the objects the report covers get a sheet.
    const sheets = [
      covers(query, 'request') ? requestSheet : null,
      covers(query, 'project') ? projectSheet : null,
      covers(query, 'task') ? taskSheet : null,
    ];
    const content = this.buildXlsx(
      sheets.filter((sheet): sheet is XlsxSheetConfig => sheet !== null),
      appBaseUrl,
    );

    return {
      filename: this.buildFilename(query, 'xlsx'),
      content,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Export cell shapes                                              */
  /* ---------------------------------------------------------------- */

  private requestHeaders(shape: ExportShape): string[] {
    return [
      'Reference',
      'Request name',
      'Source',
      'Category',
      'Stream',
      'Company',
      'Status',
      ...dateHeaders(shape),
      ...changeHeaders(shape),
    ];
  }

  private requestCells(row: WeeklyRequestRow, shape: ExportShape): SheetCellValue[] {
    return [
      row.ref,
      row.name,
      row.sourceName,
      row.categoryName,
      row.streamName,
      row.company,
      humanizeStatus(row.status),
      ...dateCells(row, shape),
      ...changeCells(row, shape, 'request'),
    ];
  }

  private projectHeaders(shape: ExportShape): string[] {
    return [
      'Reference',
      'Project name',
      'Origin',
      'Priority',
      'Source',
      'Category',
      'Stream',
      'Company',
      'Effort',
      'Status',
      ...dateHeaders(shape),
      ...changeHeaders(shape),
    ];
  }

  private projectCells(row: WeeklyProjectRow, shape: ExportShape): SheetCellValue[] {
    return [
      row.ref,
      row.name,
      this.projectOriginLabel(row),
      row.priority,
      row.sourceName,
      row.categoryName,
      row.streamName,
      row.company,
      row.progress == null ? null : `${Math.round(row.progress)}%`,
      humanizeStatus(row.status),
      ...dateCells(row, shape),
      ...changeCells(row, shape, 'project'),
    ];
  }

  /** The request a project came from, or the KANAP label of its own origin value. */
  private projectOriginLabel(row: WeeklyProjectRow): string {
    if (row.origin) return `${row.origin.ref} ${row.origin.name}`.trim();
    if (!row.originValue) return '';
    return ORIGIN_EXPORT_LABELS[row.originValue] ?? humanizeStatus(row.originValue);
  }

  /** Task columns of the by-person export: who and which list, then the usual task columns. */
  private personTaskHeaders(): string[] {
    return ['Team', 'Person', 'List', ...this.taskHeaders('all')];
  }

  /**
   * One line per person, list and task. A task two people modified is written twice, once under
   * each of them, exactly as the screen shows it.
   */
  private personTaskRows(byPerson: WeeklyByPerson): Array<{ cells: SheetCellValue[]; linkPath: string | null }> {
    const listKeys = ['created', 'modified', 'closed'] as const;
    const listLabel = { created: 'Created', modified: 'Modified', closed: 'Closed' } as const;
    const rows: Array<{ cells: SheetCellValue[]; linkPath: string | null }> = [];

    const push = (team: string, person: string, lists: WeeklyPersonLists) => {
      listKeys.forEach((listKey) => {
        lists[listKey].forEach((row) => {
          rows.push({
            cells: [team, person, listLabel[listKey], ...this.taskCells(row, 'all')] as SheetCellValue[],
            linkPath: row.itemPath,
          });
        });
      });
    };

    byPerson.teams.forEach((team) => {
      const teamName = team.teamName ?? 'No team';
      team.members.forEach((member) => push(teamName, member.name, member));
    });
    push('', 'Unassigned', byPerson.unassigned);

    return rows;
  }

  private taskHeaders(shape: ExportShape): string[] {
    return [
      'Reference',
      'Task name',
      'Task type',
      'Priority',
      'Source',
      'Category',
      'Stream',
      'Company',
      'Status',
      ...dateHeaders(shape),
      ...changeHeaders(shape),
    ];
  }

  private taskCells(row: WeeklyTaskRow, shape: ExportShape): SheetCellValue[] {
    return [
      row.ref,
      row.name,
      row.taskTypeName,
      row.priority,
      row.sourceName,
      row.categoryName,
      row.streamName,
      row.company,
      humanizeStatus(row.status),
      ...dateCells(row, shape),
      ...changeCells(row, shape, 'task'),
    ];
  }

  /* ---------------------------------------------------------------- */
  /*  Queries                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Audit CTEs shared by the three entity queries. Parameters are fixed:
   * $1 tenant, $2 start day, $3 end day, $4 time zone, $5 closed statuses, $6 noise keys.
   *
   * An item counts as closed when the last status event of the period leaves it in a
   * closed status. The creation event counts: a CSV import or an agent can create a task
   * already done or a request already rejected, and such an item never gets an update to
   * detect. Reading the last event also keeps an item reopened later out of the list.
   */
  private eventCtes(auditTable: string): string {
    return `
      period_events AS (
        SELECT al.record_id, al.action, al.before_json, al.after_json, al.created_at, al.id, al.user_id
        FROM audit_log al
        WHERE al.tenant_id = $1
          AND al.table_name = '${auditTable}'
          AND al.record_id IS NOT NULL
          AND al.action IN ('create', 'update')
          AND al.created_at >= ($2::date::timestamp AT TIME ZONE $4)
          AND al.created_at < (($3::date + 1)::timestamp AT TIME ZONE $4)
      ),
      status_moves AS (
        SELECT
          pe.record_id,
          pe.created_at,
          pe.id,
          pe.before_json->>'status' AS before_status,
          pe.after_json->>'status' AS after_status
        FROM period_events pe
        WHERE pe.action = 'update'
          AND pe.before_json->>'status' IS DISTINCT FROM pe.after_json->>'status'
      ),
      status_events AS (
        SELECT pe.record_id, pe.created_at, pe.id, pe.after_json->>'status' AS after_status
        FROM period_events pe
        WHERE pe.action = 'create'
           OR pe.before_json->>'status' IS DISTINCT FROM pe.after_json->>'status'
      ),
      status_event_last AS (
        SELECT DISTINCT ON (se.record_id) se.record_id, se.created_at, se.after_status
        FROM status_events se
        ORDER BY se.record_id, se.created_at DESC, se.id DESC
      ),
      closing AS (
        SELECT sel.record_id, sel.created_at AS closed_at
        FROM status_event_last sel
        WHERE sel.after_status = ANY($5::text[])
      ),
      -- The status reached, for the "Status reached" filter: the last event of the period that
      -- sets a status, the creation included. Same rule as the former status change report.
      status_reached AS (
        SELECT DISTINCT ON (pe.record_id) pe.record_id, pe.after_json->>'status' AS status
        FROM period_events pe
        WHERE pe.after_json->>'status' IS NOT NULL
          AND (
            pe.action = 'create'
            OR (
              pe.before_json->>'status' IS NOT NULL
              AND pe.before_json->>'status' IS DISTINCT FROM pe.after_json->>'status'
            )
          )
        ORDER BY pe.record_id, pe.created_at DESC, pe.id DESC
      ),
      -- Every status of the period in order: the one before the first move, then the one each
      -- move left. Repeats are merged when the row is shaped.
      status_chain AS (
        SELECT
          sm.record_id,
          (array_agg(sm.before_status ORDER BY sm.created_at ASC, sm.id ASC))[1:1]
            || array_agg(sm.after_status ORDER BY sm.created_at ASC, sm.id ASC) AS status_chain
        FROM status_moves sm
        GROUP BY sm.record_id
      ),
      -- One line per event and changed key. A JSON null and a missing key both read as empty.
      field_moves AS (
        SELECT
          pe.record_id,
          keys.k,
          pe.created_at,
          pe.id,
          NULLIF(pe.before_json -> keys.k, 'null'::jsonb) AS before_value,
          NULLIF(pe.after_json -> keys.k, 'null'::jsonb) AS after_value
        FROM period_events pe
        CROSS JOIN LATERAL (
          SELECT jsonb_object_keys(COALESCE(pe.before_json, '{}'::jsonb)) AS k
          UNION
          SELECT jsonb_object_keys(COALESCE(pe.after_json, '{}'::jsonb))
        ) keys
        WHERE pe.action = 'update'
          AND (pe.before_json -> keys.k) IS DISTINCT FROM (pe.after_json -> keys.k)
          AND NOT (keys.k = ANY($6::text[]))
          AND left(keys.k, 2) <> '__'
      ),
      -- Per key, the value before its first change and the value after its last one.
      field_spans AS (
        SELECT
          fm.record_id,
          fm.k,
          (array_agg(fm.before_value ORDER BY fm.created_at ASC, fm.id ASC))[1] AS before_value,
          (array_agg(fm.after_value ORDER BY fm.created_at DESC, fm.id DESC))[1] AS after_value
        FROM field_moves fm
        GROUP BY fm.record_id, fm.k
      ),
      -- A key back to its starting value did not change over the period.
      field_changes AS (
        SELECT
          fs.record_id,
          jsonb_agg(
            jsonb_build_object('key', fs.k, 'before', fs.before_value, 'after', fs.after_value)
            ORDER BY fs.k
          ) AS field_changes
        FROM field_spans fs
        WHERE fs.before_value IS DISTINCT FROM fs.after_value
        GROUP BY fs.record_id
      ),
      agg AS (
        SELECT
          pe.record_id,
          MIN(pe.created_at) FILTER (WHERE pe.action = 'create') AS created_at,
          MAX(pe.created_at) FILTER (WHERE pe.action = 'update') AS modified_at,
          COUNT(*) FILTER (WHERE pe.action = 'update') AS update_count
        FROM period_events pe
        GROUP BY pe.record_id
      )
    `;
  }

  /**
   * Who carried each event, for the by-person reading of the task lists. `creator` is the actor
   * of the creation event, `modifiers` every distinct actor of an update of the period, and
   * `closing_assignee` the assignee the closing event left on the task: the person the work was
   * on when it closed, not whoever clicked. `closing_assignee` reads exactly the row
   * `status_event_last` reads, so it always describes the event `closing` detected.
   */
  private personCtes(): string {
    return `,
      creator AS (
        SELECT DISTINCT ON (pe.record_id) pe.record_id, pe.user_id
        FROM period_events pe
        WHERE pe.action = 'create'
        ORDER BY pe.record_id, pe.created_at ASC, pe.id ASC
      ),
      modifiers AS (
        SELECT pe.record_id, array_agg(DISTINCT pe.user_id::text) AS user_ids
        FROM period_events pe
        WHERE pe.action = 'update'
          AND pe.user_id IS NOT NULL
        GROUP BY pe.record_id
      ),
      closing_assignee AS (
        SELECT DISTINCT ON (pe.record_id)
          pe.record_id,
          pe.after_json->>'assignee_user_id' AS assignee_user_id
        FROM period_events pe
        WHERE pe.action = 'create'
           OR pe.before_json->>'status' IS DISTINCT FROM pe.after_json->>'status'
        ORDER BY pe.record_id, pe.created_at DESC, pe.id DESC
      )
    `;
  }

  /** The event columns every entity query selects, given the live-row alias. */
  private eventColumns(): string {
    return `
      (a.created_at AT TIME ZONE $4)::date::text AS created_day,
      (a.modified_at AT TIME ZONE $4)::date::text AS modified_day,
      (c.closed_at AT TIME ZONE $4)::date::text AS closed_day,
      a.update_count,
      COALESCE(sch.status_chain, ARRAY[]::text[]) AS status_chain,
      COALESCE(fc.field_changes, '[]'::jsonb) AS field_changes
    `;
  }

  private eventJoins(): string {
    return `
      LEFT JOIN closing c ON c.record_id = a.record_id
      LEFT JOIN status_chain sch ON sch.record_id = a.record_id
      LEFT JOIN status_reached sr ON sr.record_id = a.record_id
      LEFT JOIN field_changes fc ON fc.record_id = a.record_id
    `;
  }

  private baseParams(query: WeeklyReportQuery, closedStatuses: readonly string[]): any[] {
    return [
      query.tenantId,
      query.startDate,
      query.endDate,
      normalizeReportTimeZone(query.timeZone),
      [...closedStatuses],
      CHANGE_NOISE_KEYS,
    ];
  }

  private async fetchRequestLists(
    query: WeeklyReportQuery,
    opts?: ServiceOpts,
  ): Promise<WeeklyLists<WeeklyRequestRow>> {
    const mg = opts?.manager;
    if (!mg) return { created: [], modified: [], closed: [] };

    const sqlParams = this.baseParams(query, CLOSED_STATUSES.requests);
    const timeZone = normalizeReportTimeZone(query.timeZone);
    const whereSql = this.buildFilterSql(
      sqlParams,
      'r',
      query,
      { taskTypes: false },
      requestProjectTeamPredicates(sqlParams, 'r', query),
    );

    const rows: RawEventRow[] = await mg.query(
      `
      WITH ${this.eventCtes('portfolio_requests')}
      SELECT
        r.id AS record_id,
        r.name,
        r.item_number,
        r.source_id,
        ps.name AS source_name,
        r.category_id,
        pc.name AS category_name,
        r.stream_id,
        pst.name AS stream_name,
        co.name AS company_name,
        r.status,
        (r.created_at AT TIME ZONE $4)::date::text AS live_created_day,
        ${this.eventColumns()}
      FROM agg a
      JOIN portfolio_requests r ON r.id = a.record_id AND r.tenant_id = $1
      ${this.eventJoins()}
      LEFT JOIN portfolio_sources ps ON ps.id = r.source_id AND ps.tenant_id = r.tenant_id
      LEFT JOIN portfolio_categories pc ON pc.id = r.category_id AND pc.tenant_id = r.tenant_id
      LEFT JOIN portfolio_streams pst ON pst.id = r.stream_id AND pst.tenant_id = r.tenant_id
      LEFT JOIN companies co ON co.id = r.company_id AND co.tenant_id = r.tenant_id
      ${whereSql}
      ORDER BY r.priority_score DESC NULLS LAST, r.name ASC
      `,
      sqlParams,
    );

    return this.bucket(rows, (row, listKey) => ({
      requestId: row.record_id,
      ...this.commonFields(row, listKey, 'REQ', '/portfolio/requests', 'summary', timeZone),
    }));
  }

  private async fetchProjectLists(
    query: WeeklyReportQuery,
    opts?: ServiceOpts,
  ): Promise<WeeklyLists<WeeklyProjectRow>> {
    const mg = opts?.manager;
    if (!mg) return { created: [], modified: [], closed: [] };

    const sqlParams = this.baseParams(query, CLOSED_STATUSES.projects);
    const timeZone = normalizeReportTimeZone(query.timeZone);
    const whereSql = this.buildFilterSql(
      sqlParams,
      'p',
      query,
      { taskTypes: false },
      projectProjectTeamPredicates(sqlParams, 'p', query),
    );

    const rows: RawProjectEventRow[] = await mg.query(
      `
      WITH ${this.eventCtes('portfolio_projects')}
      SELECT
        p.id AS record_id,
        p.name,
        p.item_number,
        p.priority_score::numeric AS priority,
        p.source_id,
        ps.name AS source_name,
        p.category_id,
        pc.name AS category_name,
        p.stream_id,
        pst.name AS stream_name,
        co.name AS company_name,
        p.execution_progress::numeric AS progress,
        p.status,
        og.origin_number,
        og.origin_name,
        p.origin AS origin_value,
        (p.created_at AT TIME ZONE $4)::date::text AS live_created_day,
        ${this.eventColumns()}
      FROM agg a
      JOIN portfolio_projects p ON p.id = a.record_id AND p.tenant_id = $1
      ${this.eventJoins()}
      LEFT JOIN portfolio_sources ps ON ps.id = p.source_id AND ps.tenant_id = p.tenant_id
      LEFT JOIN portfolio_categories pc ON pc.id = p.category_id AND pc.tenant_id = p.tenant_id
      LEFT JOIN portfolio_streams pst ON pst.id = p.stream_id AND pst.tenant_id = p.tenant_id
      LEFT JOIN companies co ON co.id = p.company_id AND co.tenant_id = p.tenant_id
      LEFT JOIN LATERAL (
        SELECT req.item_number AS origin_number, req.name AS origin_name
        FROM portfolio_request_projects rp
        JOIN portfolio_requests req ON req.id = rp.request_id AND req.tenant_id = $1
        WHERE rp.project_id = p.id AND rp.tenant_id = $1
        ORDER BY rp.created_at ASC
        LIMIT 1
      ) og ON TRUE
      ${whereSql}
      ORDER BY p.priority_score DESC NULLS LAST, p.name ASC
      `,
      sqlParams,
    );

    return this.bucket(rows, (row, listKey) => ({
      projectId: row.record_id,
      ...this.commonFields(row, listKey, 'PRJ', '/portfolio/projects', 'summary', timeZone),
      priority: toNumber(row.priority),
      progress: toNumber(row.progress),
      origin:
        row.origin_number == null
          ? null
          : {
              ref: `REQ-${row.origin_number}`,
              name: row.origin_name ?? '',
              itemPath: `/portfolio/requests/REQ-${row.origin_number}/summary`,
            },
      originValue: row.origin_value ?? null,
    }));
  }

  private async fetchTaskLists(
    query: WeeklyReportQuery,
    opts?: ServiceOpts,
  ): Promise<{ lists: WeeklyLists<WeeklyTaskRow>; entries: TaskEntry[] }> {
    const mg = opts?.manager;
    if (!mg) return { lists: { created: [], modified: [], closed: [] }, entries: [] };

    const byPerson = query.groupBy === 'person';
    const sqlParams = this.baseParams(query, CLOSED_STATUSES.tasks);
    const timeZone = normalizeReportTimeZone(query.timeZone);
    const whereSql = this.buildFilterSql(
      sqlParams,
      't',
      query,
      {
        taskTypes: true,
        classification: {
          source: 'COALESCE(t.source_id, pp.source_id)',
          category: 'COALESCE(t.category_id, pp.category_id)',
        },
      },
      [
        `(t.related_object_type IS NULL OR t.related_object_type = 'project')`,
        ...taskProjectTeamPredicates(sqlParams, 't', query),
      ],
    );

    const rows: RawTaskEventRow[] = await mg.query(
      `
      WITH ${this.eventCtes('tasks')}${byPerson ? this.personCtes() : ''}
      SELECT
        t.id AS record_id,
        t.title AS name,
        t.item_number,
        pt.id AS task_type_id,
        pt.name AS task_type_name,
        CASE t.priority_level
          WHEN 'blocker' THEN 110
          WHEN 'high' THEN 90
          WHEN 'normal' THEN 70
          WHEN 'low' THEN 50
          WHEN 'optional' THEN 30
          ELSE NULL
        END::numeric AS priority,
        t.source_id,
        ps.name AS source_name,
        t.category_id,
        pc.name AS category_name,
        t.stream_id,
        pst.name AS stream_name,
        co.name AS company_name,
        t.status,
        (t.created_at AT TIME ZONE $4)::date::text AS live_created_day,
        ${this.eventColumns()}
        ${
          byPerson
            ? `,
        COALESCE(cr.user_id::text, t.creator_id::text) AS creator_user_id,
        COALESCE(md.user_ids, ARRAY[]::text[]) AS modifier_user_ids,
        ca.assignee_user_id AS closing_assignee_id`
            : ''
        }
      FROM agg a
      JOIN tasks t ON t.id = a.record_id AND t.tenant_id = $1
      ${this.eventJoins()}
      ${
        byPerson
          ? `LEFT JOIN creator cr ON cr.record_id = a.record_id
      LEFT JOIN modifiers md ON md.record_id = a.record_id
      LEFT JOIN closing_assignee ca ON ca.record_id = a.record_id`
          : ''
      }
      -- The project a task hangs off, for the classification it inherits when it has none.
      LEFT JOIN portfolio_projects pp
        ON pp.id = t.related_object_id
       AND t.related_object_type = 'project'
       AND pp.tenant_id = t.tenant_id
      LEFT JOIN portfolio_task_types pt ON pt.id = t.task_type_id AND pt.tenant_id = t.tenant_id
      LEFT JOIN portfolio_sources ps ON ps.id = t.source_id AND ps.tenant_id = t.tenant_id
      LEFT JOIN portfolio_categories pc ON pc.id = t.category_id AND pc.tenant_id = t.tenant_id
      LEFT JOIN portfolio_streams pst ON pst.id = t.stream_id AND pst.tenant_id = t.tenant_id
      -- The company is inherited from the project, like the classification the task list reads.
      LEFT JOIN companies co ON co.id = COALESCE(t.company_id, pp.company_id) AND co.tenant_id = t.tenant_id
      ${whereSql}
      ORDER BY priority DESC NULLS LAST, t.title ASC
      `,
      sqlParams,
    );

    const entries: TaskEntry[] = [];
    const lists = this.bucket(rows, (row, listKey) => {
      const built: WeeklyTaskRow = {
        taskId: row.record_id,
        ...this.commonFields(row, listKey, 'T', '/portfolio/tasks', 'overview', timeZone),
        taskTypeId: row.task_type_id ?? null,
        taskTypeName: row.task_type_name ?? null,
        priority: toNumber(row.priority),
      };
      entries.push({ row: built, listKey, raw: row });
      return built;
    });

    return { lists, entries };
  }

  /* ---------------------------------------------------------------- */
  /*  By person                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * The same task rows, read by the person who carried each event: the actor of the creation,
   * every actor of an update (a task two people touched is counted for both), and the assignee
   * the closing event left on the task. Anything with no person lands in `unassigned`.
   *
   * Everyone who logged time over the period is listed too, even with no task event: the view
   * answers "who carried what", and time is part of that answer.
   */
  private async buildByPerson(
    query: WeeklyReportQuery,
    entries: TaskEntry[],
    opts?: ServiceOpts,
  ): Promise<WeeklyByPerson> {
    const unassigned: WeeklyPersonLists = { created: [], modified: [], closed: [] };
    const listsByUser = new Map<string, WeeklyPersonLists>();

    const listFor = (userId: string): WeeklyPersonLists => {
      let lists = listsByUser.get(userId);
      if (!lists) {
        lists = { created: [], modified: [], closed: [] };
        listsByUser.set(userId, lists);
      }
      return lists;
    };

    for (const entry of entries) {
      const { raw, row, listKey } = entry;
      if (listKey === 'created') {
        const actor = raw.creator_user_id ?? null;
        (actor ? listFor(actor) : unassigned).created.push(row);
        continue;
      }
      if (listKey === 'closed') {
        const assignee = raw.closing_assignee_id ?? null;
        (assignee ? listFor(assignee) : unassigned).closed.push(row);
        continue;
      }
      const actors = (raw.modifier_user_ids ?? []).filter(Boolean);
      if (actors.length === 0) {
        unassigned.modified.push(row);
        continue;
      }
      for (const actor of actors) listFor(actor).modified.push(row);
    }

    const logged = await this.fetchLoggedDays(query, opts);
    for (const userId of logged.keys()) listFor(userId);

    const people = await this.fetchPeople(query.tenantId, Array.from(listsByUser.keys()), opts);

    const groups = new Map<string, WeeklyTeamGroup>();
    for (const [userId, lists] of listsByUser) {
      const person = people.get(userId);
      const loggedDays = logged.get(userId) ?? { project: 0, other: 0, total: 0 };
      const member: WeeklyPerson = {
        userId,
        name: person?.name ?? '',
        contributorRef: person?.contributorRef ?? null,
        loggedDays,
        ...lists,
      };

      const teamId = person?.teamId ?? null;
      const key = teamId ?? '';
      let group = groups.get(key);
      if (!group) {
        group = {
          teamId,
          teamName: teamId ? person?.teamName ?? null : null,
          members: [],
          totals: { created: 0, modified: 0, closed: 0, loggedDays: 0 },
        };
        groups.set(key, group);
      }
      group.members.push(member);
      group.totals.created += lists.created.length;
      group.totals.modified += lists.modified.length;
      group.totals.closed += lists.closed.length;
      group.totals.loggedDays = roundDays(group.totals.loggedDays + loggedDays.total);
    }

    const teams = Array.from(groups.values());
    teams.forEach((team) => team.members.sort((a, b) => byName(a.name, b.name)));
    teams.sort((a, b) => {
      if (a.teamId === null) return 1;
      if (b.teamId === null) return -1;
      return byName(a.teamName ?? '', b.teamName ?? '');
    });

    return { teams, unassigned };
  }

  /**
   * Days logged in the period, per person, split project versus other. One statement over the
   * union of the two time tables, grouped by person: never a query per person. A task hanging
   * off a project is project time, exactly as the monthly aggregate reads it.
   *
   * The project and team filters narrow the time like the task rows: a team keeps its members'
   * entries, a project keeps the entries on its tasks and the ones logged on it directly.
   */
  private async fetchLoggedDays(
    query: WeeklyReportQuery,
    opts?: ServiceOpts,
  ): Promise<Map<string, WeeklyLoggedDays>> {
    const mg = opts?.manager;
    const days = new Map<string, WeeklyLoggedDays>();
    if (!mg) return days;

    const sqlParams: any[] = [
      query.tenantId,
      query.startDate,
      normalizeReportTimeZone(query.timeZone),
      query.endDate,
    ];
    const { taskFilter, projectFilter } = timeEntryProjectTeamFilters(sqlParams, query, '$1');

    const rows: LoggedHoursRow[] = await mg.query(
      `
      SELECT
        e.user_id,
        COALESCE(SUM(e.hours) FILTER (WHERE e.is_project), 0)::numeric AS project_hours,
        COALESCE(SUM(e.hours) FILTER (WHERE NOT e.is_project), 0)::numeric AS other_hours
      FROM (
        SELECT
          tte.user_id::text AS user_id,
          tte.hours::numeric AS hours,
          -- A standalone task has no type at all: its time is other time, not unknown time.
          COALESCE(t.related_object_type = 'project', FALSE) AS is_project
        FROM task_time_entries tte
        JOIN tasks t ON t.id = tte.task_id AND t.tenant_id = $1
        WHERE tte.tenant_id = $1
          AND tte.user_id IS NOT NULL
          AND tte.logged_at >= ($2::date::timestamp AT TIME ZONE $3)
          AND tte.logged_at < (($4::date + 1)::timestamp AT TIME ZONE $3)${taskFilter}

        UNION ALL

        SELECT
          pte.user_id::text AS user_id,
          pte.hours::numeric AS hours,
          TRUE AS is_project
        FROM portfolio_project_time_entries pte
        WHERE pte.tenant_id = $1
          AND pte.user_id IS NOT NULL
          AND pte.logged_at >= ($2::date::timestamp AT TIME ZONE $3)
          AND pte.logged_at < (($4::date + 1)::timestamp AT TIME ZONE $3)${projectFilter}
      ) e
      GROUP BY e.user_id
      `,
      sqlParams,
    );

    for (const row of rows) {
      const project = hoursToDays(Number(row.project_hours ?? 0) || 0);
      const other = hoursToDays(Number(row.other_hours ?? 0) || 0);
      days.set(row.user_id, { project, other, total: roundDays(project + other) });
    }
    return days;
  }

  /**
   * Names, teams and contributor references of the people the view lists. Names only: the
   * report never shows an email. One statement for the whole set.
   */
  private async fetchPeople(
    tenantId: string,
    userIds: string[],
    opts?: ServiceOpts,
  ): Promise<Map<string, { name: string; contributorRef: string | null; teamId: string | null; teamName: string | null }>> {
    const people = new Map<string, { name: string; contributorRef: string | null; teamId: string | null; teamName: string | null }>();
    const mg = opts?.manager;
    if (!mg || userIds.length === 0) return people;

    const rows: PersonRow[] = await mg.query(
      `
      SELECT
        u.id::text AS user_id,
        ${userNameSql('u')} AS name,
        mc.item_number,
        mc.team_id::text AS team_id,
        pt.name AS team_name
      FROM users u
      LEFT JOIN portfolio_team_member_configs mc ON mc.user_id = u.id AND mc.tenant_id = $1
      LEFT JOIN portfolio_teams pt ON pt.id = mc.team_id AND pt.tenant_id = $1
      WHERE u.tenant_id = $1
        AND u.id::text = ANY($2::text[])
      `,
      [tenantId, userIds],
    );

    for (const row of rows) {
      people.set(row.user_id, {
        name: row.name ?? '',
        contributorRef: row.item_number != null ? `CTR-${row.item_number}` : null,
        teamId: row.team_id ?? null,
        teamName: row.team_name ?? null,
      });
    }
    return people;
  }

  /**
   * Swap the ids of the changed references for names. The ids are collected per table over
   * every row, then each table is read once: one statement per table, never one per row. An id
   * whose record is gone reads as `''`, which the screen and the export show as unknown.
   */
  private async resolveChangeRefs(
    tenantId: string,
    rows: WeeklyRowCommon[],
    opts?: ServiceOpts,
  ): Promise<void> {
    const refs = rows
      .flatMap((row) => row.changes?.fields ?? [])
      .filter((field) => field.kind === 'ref' && REF_TABLES[field.key]);
    if (refs.length === 0) return;

    const idsByTable = new Map<RefTable, Set<string>>();
    refs.forEach((field) => {
      const table = REF_TABLES[field.key];
      let ids = idsByTable.get(table);
      if (!ids) {
        ids = new Set<string>();
        idsByTable.set(table, ids);
      }
      if (field.before) ids.add(field.before);
      if (field.after) ids.add(field.after);
    });

    const mg = opts?.manager;
    const names = new Map<RefTable, Map<string, string>>();
    await Promise.all(
      Array.from(idsByTable.entries()).map(async ([table, ids]) => {
        const byId = new Map<string, string>();
        names.set(table, byId);
        if (!mg || ids.size === 0) return;
        const found: Array<{ id: string; name: string | null }> = await mg.query(
          `
          SELECT r.id::text AS id, ${table.nameSql('r')} AS name
          FROM ${table.table} r
          WHERE r.tenant_id = $1
            AND r.id::text = ANY($2::text[])
          `,
          [tenantId, Array.from(ids)],
        );
        found.forEach((row) => byId.set(row.id, row.name ?? ''));
      }),
    );

    refs.forEach((field) => {
      const byId = names.get(REF_TABLES[field.key]);
      if (field.before) field.before = byId?.get(field.before) ?? '';
      if (field.after) field.after = byId?.get(field.after) ?? '';
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Row shaping                                                     */
  /* ---------------------------------------------------------------- */

  private commonFields(
    row: RawEventRow,
    listKey: 'created' | 'modified' | 'closed',
    prefix: string,
    routeBase: string,
    tab: string,
    timeZone: string,
  ): WeeklyRowCommon {
    const ref = row.item_number == null ? '' : `${prefix}-${row.item_number}`;
    const eventAt =
      listKey === 'created' ? row.created_day : listKey === 'closed' ? row.closed_day : row.modified_day;

    return {
      ref,
      itemPath: `${routeBase}/${ref || row.record_id}/${tab}`,
      name: row.name ?? '',
      sourceId: row.source_id ?? null,
      sourceName: row.source_name ?? null,
      categoryId: row.category_id ?? null,
      categoryName: row.category_name ?? null,
      streamId: row.stream_id ?? null,
      streamName: row.stream_name ?? null,
      company: row.company_name ?? null,
      status: row.status ?? '',
      createdAt: row.live_created_day,
      eventAt,
      changes:
        listKey === 'modified'
          ? {
              statusChain: mergeStatusChain(row.status_chain),
              fields: (row.field_changes ?? []).map((raw) => buildFieldChange(raw, timeZone)),
            }
          : null,
    };
  }

  /**
   * Split the queried rows into the three lists. An item created and closed inside the
   * same period appears in both, and never in modified: modified is what is left.
   */
  private bucket<TRaw extends RawEventRow, TRow>(
    rows: TRaw[],
    build: (row: TRaw, listKey: 'created' | 'modified' | 'closed') => TRow,
  ): WeeklyLists<TRow> {
    const lists: WeeklyLists<TRow> = { created: [], modified: [], closed: [] };

    rows.forEach((row) => {
      const isCreated = Boolean(row.created_day);
      const isClosed = Boolean(row.closed_day);
      if (isCreated) lists.created.push(build(row, 'created'));
      if (isClosed) lists.closed.push(build(row, 'closed'));
      if (!isCreated && !isClosed && Number(row.update_count) > 0) {
        lists.modified.push(build(row, 'modified'));
      }
    });

    return lists;
  }

  /* ---------------------------------------------------------------- */
  /*  Helpers                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * `classification` names how the source and the category are read. Tasks pass the inherited
   * expression, `COALESCE(t.source_id, pp.source_id)`, the way the task list resolves them: a
   * filtered weekly report and the list it links to then count the same population.
   */
  private buildFilterSql(
    sqlParams: any[],
    alias: string,
    query: WeeklyReportQuery,
    opts: { taskTypes: boolean; classification?: { source: string; category: string } },
    extraFilters: string[] = [],
  ): string {
    const filters = [...extraFilters];

    const push = (values: string[] | undefined, column: string) => {
      const predicate = pushSetFilter(sqlParams, alias, column, values);
      if (predicate) filters.push(predicate);
    };

    const pushExpr = (values: string[] | undefined, expression: string) => {
      const predicate = pushSetFilterExpr(sqlParams, expression, values);
      if (predicate) filters.push(predicate);
    };

    if (opts.taskTypes) push(query.taskTypeIds, 'task_type_id');
    pushExpr(query.sourceIds, opts.classification?.source ?? `${alias}.source_id`);
    pushExpr(query.categoryIds, opts.classification?.category ?? `${alias}.category_id`);
    push(query.streamIds, 'stream_id');
    // Applied in SQL, before the rows are split into lists: the section counts and the
    // by-person totals are counted on exactly the rows shown.
    pushExpr(query.statuses, STATUS_REACHED_EXPR);

    return filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  }

  private buildFilename(query: WeeklyReportQuery, ext: 'csv' | 'xlsx'): string {
    return `weekly-report-${query.startDate}_to_${query.endDate}.${ext}`;
  }

  private buildXlsx(sheets: XlsxSheetConfig[], appBaseUrl: string | null): Buffer {
    const normalizedBase = String(appBaseUrl || '').trim().replace(/\/$/, '');

    const sheetXmlByIndex = new Map<number, string>();
    const sheetRelsXmlByIndex = new Map<number, string>();

    sheets.forEach((sheet, sheetIndexZeroBased) => {
      const sheetIndex = sheetIndexZeroBased + 1;
      const sheetRows: string[] = [];
      const hyperlinks: string[] = [];
      const hyperlinkRels: string[] = [];
      let hyperlinkIndex = 0;

      const buildInlineStringCell = (cellRef: string, value: string) =>
        `<c r="${cellRef}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;

      const buildNumberCell = (cellRef: string, value: number) => `<c r="${cellRef}"><v>${value}</v></c>`;

      const addCell = (cells: string[], rowNumber: number, columnNumber: number, value: SheetCellValue) => {
        if (value === null || value === undefined || value === '') return;
        const cellRef = `${columnNumberToName(columnNumber)}${rowNumber}`;
        if (typeof value === 'number' && Number.isFinite(value)) {
          cells.push(buildNumberCell(cellRef, value));
          return;
        }
        cells.push(buildInlineStringCell(cellRef, String(value)));
      };

      const headerCells: string[] = [];
      sheet.headers.forEach((header, headerIndex) => {
        addCell(headerCells, 1, headerIndex + 1, header);
      });
      sheetRows.push(`<row r="1">${headerCells.join('')}</row>`);

      sheet.rows.forEach((row, rowIndex) => {
        const rowNumber = rowIndex + 2;
        const cells: string[] = [];

        row.cells.forEach((cellValue, cellIndex) => {
          addCell(cells, rowNumber, cellIndex + 1, cellValue);
        });

        const target = row.linkPath
          ? (normalizedBase ? `${normalizedBase}${row.linkPath}` : row.linkPath)
          : '';
        if (target) {
          hyperlinkIndex += 1;
          const relId = `rId${hyperlinkIndex}`;
          const nameCellRef = `${columnNumberToName(sheet.linkColumnNumber ?? 2)}${rowNumber}`;
          hyperlinks.push(`<hyperlink ref="${nameCellRef}" r:id="${relId}"/>`);
          hyperlinkRels.push(
            `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(target)}" TargetMode="External"/>`,
          );
        }

        sheetRows.push(`<row r="${rowNumber}">${cells.join('')}</row>`);
      });

      const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData>
    ${sheetRows.join('\n    ')}
  </sheetData>
  ${hyperlinks.length > 0 ? `<hyperlinks>${hyperlinks.join('')}</hyperlinks>` : ''}
</worksheet>`;

      sheetXmlByIndex.set(sheetIndex, sheetXml);

      if (hyperlinkRels.length > 0) {
        const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${hyperlinkRels.join('\n  ')}
</Relationships>`;
        sheetRelsXmlByIndex.set(sheetIndex, relsXml);
      }
    });

    const sheetOverrides = sheets
      .map(
        (_, sheetIndexZeroBased) =>
          `<Override PartName="/xl/worksheets/sheet${sheetIndexZeroBased + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('\n  ');

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheetOverrides}
</Types>`;

    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const workbookSheetsXml = sheets
      .map(
        (sheet, sheetIndexZeroBased) =>
          `<sheet name="${xmlEscape(sheet.name)}" sheetId="${sheetIndexZeroBased + 1}" r:id="rId${sheetIndexZeroBased + 1}"/>`,
      )
      .join('\n    ');

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${workbookSheetsXml}
  </sheets>
</workbook>`;

    const workbookRelationshipsXml = sheets
      .map(
        (_, sheetIndexZeroBased) =>
          `<Relationship Id="rId${sheetIndexZeroBased + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetIndexZeroBased + 1}.xml"/>`,
      )
      .join('\n  ');

    const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelationshipsXml}
</Relationships>`;

    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
    zip.addFile('_rels/.rels', Buffer.from(rootRelsXml, 'utf8'));
    zip.addFile('xl/workbook.xml', Buffer.from(workbookXml, 'utf8'));
    zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(workbookRelsXml, 'utf8'));

    sheetXmlByIndex.forEach((sheetXml, sheetIndex) => {
      zip.addFile(`xl/worksheets/sheet${sheetIndex}.xml`, Buffer.from(sheetXml, 'utf8'));
    });

    sheetRelsXmlByIndex.forEach((sheetRelsXml, sheetIndex) => {
      zip.addFile(`xl/worksheets/_rels/sheet${sheetIndex}.xml.rels`, Buffer.from(sheetRelsXml, 'utf8'));
    });

    return zip.toBuffer();
  }
}
