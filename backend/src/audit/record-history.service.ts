import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { TenantRequest } from '../common/decorators/tenant.decorator';
import { hasLevel } from '../common/relations/relations-access';
import { formatCentsFixed, toCents } from '../common/amount';
import {
  applicationParticipantCondition,
  projectParticipantCondition,
  requestParticipantCondition,
  resolveBusinessContributorScopeForUser,
  taskParticipantCondition,
  type ParticipationAccessScope,
} from '../auth/business-contributor-scope';
import {
  incidentViewerFromContext,
  taskIncidentVisibilitySql,
  type IncidentViewer,
} from '../incidents/incident-visibility';
import {
  RECORD_HISTORY,
  recordHistoryChildKind,
  type RecordHistoryChildKind,
  type RecordHistoryRecord,
} from './record-history.inventory';

/**
 * The history of one record, as its page shows it (lot 1B).
 *
 * `GET /records/:table/:id/history` loads the record first, in the request's transaction
 * (`ctx.manager`: tenant context and the person's data access), then reads the audit rows by its id.
 * `audit_log` has only its tenant policy, so this order is what keeps a person from reading the
 * history of a record they cannot open: a record outside their access (or missing) is not found.
 *
 * The service is generic: a record family is declared in `record-history.inventory.ts` (its table,
 * module, audit labels and children). The presentation of a child kind and the reference families
 * live here; a new family that only adds a record entry needs no change to the route.
 *
 * Large pages cost a bounded number of statements: the audit page, the authors, the versions, one
 * query per reference family present in the page, and the dimensions it names. No query loops over
 * the rows.
 */

export type RecordHistoryActorKind = 'user' | 'system' | 'import' | 'assistant';
export type RecordHistoryActor = { kind: RecordHistoryActorKind; name: string | null };

/** A visible reference: the business label, and the reference when the family has one. */
export type RecordHistoryReference = {
  kind: string;
  id: string;
  label: string | null;
  reference?: string | null;
};

/** A reference the person may not read, or a record deleted or outside their access. */
export type RecordHistoryHiddenReference = { hidden: true; kind: string };

export type RecordHistoryChange = {
  field: string;
  before?: unknown;
  after?: unknown;
  event?: 'added' | 'removed';
  /** The budget year of an amount change (or of a column operation). */
  year?: number;
  /** The budget column of an amount change. */
  column?: string;
  /** The year a copied column or allocation comes from. */
  sourceYear?: number;
  /** The column a copied column comes from. */
  sourceColumn?: string;
  /** An allocation copy replaced the destination's manual rows. */
  overwrite?: boolean;
  /** A negative percentage applied by a column copy. */
  percentageIncrease?: string;
  /** The month totals are equal, only their distribution changed. */
  monthlyOnly?: boolean;
  /** The months whose values changed (`YYYY-MM`). */
  months?: string[];
  /** The twelve months of the year are covered, or the payload carries yearly totals. */
  wholeYear?: boolean;
  /** The dimension a value belongs to (a line's analytics values). */
  dimension?: string | null;
  /** Allocation or costed-line changes whose counts are equal. */
  changed?: boolean;
};

export type RecordHistorySubject = {
  kind: 'record' | RecordHistoryChildKind;
  label?: string | null;
};

export type RecordHistoryItem = {
  id: string;
  at: string;
  action: string;
  actor: RecordHistoryActor;
  subject: RecordHistorySubject;
  changes: RecordHistoryChange[];
};

export type RecordHistoryPage = {
  items: RecordHistoryItem[];
  nextCursor: string | null;
};

export type RecordHistoryContext = Pick<
  TenantRequest,
  'tenantId' | 'userId' | 'isAdmin' | 'permissions' | 'manager'
>;

export type RecordHistoryListOptions = { cursor?: string | null; limit?: unknown };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT_MEASURES = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'] as const;

export type FamilyKey =
  | 'user'
  | 'company'
  | 'supplier'
  | 'account'
  | 'project'
  | 'request'
  | 'contract'
  | 'cost_center'
  | 'contact'
  | 'application'
  | 'technology'
  | 'asset'
  | 'task'
  | 'budget_line';

type ParticipationResource = 'applications' | 'portfolio_projects' | 'portfolio_requests' | 'tasks';

/**
 * The extra rule a family's own screen applies, beyond the tenant predicate, RLS and data access.
 * `scope`: the Business Contributor participation of that resource. `incident`: the row may name a
 * confidential incident, which its screen hides from a viewer outside the register's rule.
 */
type FamilyVisibility = {
  scope?: ParticipationResource;
  incident?: boolean;
  /** The family's table holds both natures of a budget line: name them, as `AGENTS.md` asks. */
  natures?: boolean;
};

type ReferenceFamily = {
  /** The permission resource that reads the family; null: every person (people). */
  module: string | null;
  table: string;
  /** The label expression, on the alias `r`. */
  label: string;
  /** The business reference expression, when the family has one. */
  reference?: string;
  /** The screen's own visibility rule; empty for the families RLS and data access decide alone. */
  visibility: FamilyVisibility;
};

/**
 * The families a history value may name, and how one row of each reads: the label shown instead of
 * the id, and the business reference where the family has one. Every query runs under
 * `ctx.manager`, so a family the person does not read (module) or a record outside their access
 * (RLS, data access) comes back empty and shows as `{ hidden: true, kind }`.
 */
const REFERENCE_FAMILIES: Readonly<Record<FamilyKey, ReferenceFamily>> = {
  user: {
    module: null,
    table: 'users',
    label: `COALESCE(NULLIF(trim(concat_ws(' ', r.first_name, r.last_name)), ''), r.email)`,
    visibility: {},
  },
  company: { module: 'companies', table: 'companies', label: 'r.name', visibility: {} },
  supplier: { module: 'suppliers', table: 'suppliers', label: 'r.name', visibility: {} },
  account: {
    module: 'accounts',
    table: 'accounts',
    label: `'[' || r.account_number || '] ' || r.account_name`,
    visibility: {},
  },
  project: {
    module: 'portfolio_projects',
    table: 'portfolio_projects',
    label: 'r.name',
    reference: `'PRJ-' || r.item_number`,
    visibility: { scope: 'portfolio_projects' },
  },
  request: {
    module: 'portfolio_requests',
    table: 'portfolio_requests',
    label: 'r.name',
    reference: `'REQ-' || r.item_number`,
    visibility: { scope: 'portfolio_requests' },
  },
  contract: { module: 'contracts', table: 'contracts', label: 'r.name', visibility: {} },
  cost_center: { module: 'cost_centers', table: 'cost_centers', label: `r.code || ' · ' || r.name`, visibility: {} },
  contact: {
    module: 'contacts',
    table: 'contacts',
    label: `COALESCE(NULLIF(trim(concat_ws(' ', r.first_name, r.last_name)), ''), r.email)`,
    visibility: {},
  },
  application: {
    module: 'applications',
    table: 'applications',
    label: 'r.name',
    reference: 'r.sequential_id',
    visibility: { scope: 'applications' },
  },
  technology: {
    module: 'infrastructure',
    table: 'technologies',
    label: 'r.name',
    reference: `'TEC-' || r.item_number`,
    visibility: {},
  },
  asset: {
    module: 'infrastructure',
    table: 'assets',
    label: 'r.name',
    reference: 'r.asset_reference',
    visibility: {},
  },
  task: {
    module: 'tasks',
    table: 'tasks',
    label: 'r.title',
    reference: `'T-' || r.item_number`,
    visibility: { scope: 'tasks', incident: true },
  },
  budget_line: {
    module: 'budget',
    table: 'spend_items',
    label: `COALESCE(NULLIF(r.product_name, ''), NULLIF(r.description, ''))`,
    reference: `'BL-' || r.item_number`,
    visibility: { natures: true },
  },
};

export const FAMILY_KEYS = Object.keys(REFERENCE_FAMILIES) as FamilyKey[];

/** The screen rule of each participation resource, as the Relations tabs apply it. */
const PARTICIPATION_CONDITIONS: Readonly<Record<ParticipationResource, (alias: string, userRef: string) => string>> = {
  applications: applicationParticipantCondition,
  portfolio_projects: projectParticipantCondition,
  portfolio_requests: requestParticipantCondition,
  tasks: taskParticipantCondition,
};

/** A field the history presents (and the family it names), or the reason it never does. */
export type HistoryFieldRule = { family?: FamilyKey; hidden?: string };

/** The allow-list of one audit label: a field absent from it is never copied from a payload. */
export type HistoryFields = Readonly<Record<string, HistoryFieldRule>>;

const shown = (family?: FamilyKey): HistoryFieldRule => (family ? { family } : {});
const hidden = (reason: string): HistoryFieldRule => ({ hidden: reason });

/** The raw keys of an operation payload: markers and details, never field changes. */
const OPERATION_FIELDS: HistoryFields = {
  operation: hidden('write marker, never a field change'),
  year: hidden('operation year'),
  source: hidden('write source'),
  sourceYear: hidden('operation detail'),
  destinationYear: hidden('operation detail'),
  sourceColumn: hidden('operation detail'),
  destinationColumn: hidden('operation detail'),
  percentageIncrease: hidden('operation detail'),
  overwrite: hidden('operation detail'),
  column: hidden('operation detail'),
  from_nature: hidden('operation detail: the nature field carries the change'),
  to_nature: hidden('operation detail: the nature field carries the change'),
  from_year: hidden('operation detail'),
  from_reference: hidden('raw reference: predecessor and successor resolve with access'),
  to_reference: hidden('raw reference: predecessor and successor resolve with access'),
  copied: hidden('structured copy summary'),
};

/** A budget line of either nature, as its own audit rows record it. */
const BUDGET_LINE_FIELDS: HistoryFields = {
  product_name: shown(),
  description: shown(),
  currency: shown(),
  effective_start: shown(),
  legacy_effective_end: shown(),
  status: shown(),
  notes: shown(),
  run_build: shown(),
  nature: shown(),
  legacy_number: shown(),
  ppe_type: shown(),
  investment_type: shown(),
  priority: shown(),
  item_number: shown(),
  disabled_at: shown(),
  supplier_id: shown('supplier'),
  account_id: shown('account'),
  owner_it_id: shown('user'),
  owner_business_id: shown('user'),
  project_id: shown('project'),
  contract_id: shown('contract'),
  paying_company_id: shown('company'),
  cost_center_id: shown('cost_center'),
  predecessor_id: shown('budget_line'),
  // A type change names the line it continues in an operation key: resolved with access, as the
  // line's own predecessor.
  successor_id: shown('budget_line'),
  // A dimension map, presented by `dimensionChanges`.
  analytics_values: shown(),
  reason: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
  row_version: hidden('concurrency counter'),
  analytics_category_id: hidden('derived category'),
  budget_rev: hidden('budget revision counter'),
  search_vector: hidden('search index'),
  search_text: hidden('search index'),
  content_plain: hidden('search index'),
  fx_rate_set_id: hidden('rate set of the version'),
  version_id: hidden('version link'),
  spend_item_id: hidden('line link'),
  capex_item_id: hidden('line link'),
  item_id: hidden('line link'),
  related_object_id: hidden('polymorphic link'),
  related_object_type: hidden('polymorphic link'),
  sort: hidden('display order'),
  ...OPERATION_FIELDS,
};

/** A budget version of either nature. */
const BUDGET_VERSION_FIELDS: HistoryFields = {
  version_name: shown(),
  input_grain: shown(),
  is_approved: shown(),
  as_of_date: shown(),
  budget_year: shown(),
  notes: shown(),
  allocation_method: shown(),
  allocation_driver: shown(),
  reporting_currency: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  spend_item_id: hidden('line link'),
  capex_item_id: hidden('line link'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
  fx_rate_set_id: hidden('rate set'),
  budget_rev: hidden('budget revision counter'),
  budget_changed_at: hidden('budget revision timestamp'),
  ...OPERATION_FIELDS,
};

/** A round input; its costed lines have their own events. */
const ROUND_INPUT_FIELDS: HistoryFields = {
  period_start: shown(),
  period_end: shown(),
  method: shown(),
  spread_profile_name: shown(),
  fte: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  version_id: hidden('version link'),
  measure: hidden('the entry subject names the measure'),
  last_calculation: hidden('derived calculation document'),
  lines: hidden('the costed lines have their own events'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

const LINK_FIELDS: HistoryFields = {
  url: shown(),
  description: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  spend_item_id: hidden('line link'),
  capex_item_id: hidden('line link'),
  created_at: hidden('timestamp'),
};

const ATTACHMENT_FIELDS: HistoryFields = {
  original_filename: shown(),
  mime_type: shown(),
  size: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  spend_item_id: hidden('line link'),
  capex_item_id: hidden('line link'),
  stored_filename: hidden('storage detail'),
  storage_path: hidden('storage detail'),
  uploaded_at: hidden('timestamp'),
};

const CONTACT_FIELDS: HistoryFields = {
  contact_id: shown('contact'),
  role: shown(),
  origin: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  spend_item_id: hidden('line link'),
  capex_item_id: hidden('line link'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

const TASK_FIELDS: HistoryFields = {
  title: shown(),
  description: shown(),
  status: shown(),
  due_date: shown(),
  item_number: shown(),
  assignee_user_id: shown('user'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  item_id: hidden('line link'),
  related_object_id: hidden('polymorphic link'),
  related_object_type: hidden('polymorphic link'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

const AMOUNT_FIELDS: HistoryFields = {
  period: shown(),
  planned: shown(),
  forecast: shown(),
  committed: shown(),
  actual: shown(),
  expected_landing: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  version_id: hidden('version link'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** Allocations expose counts, never the companies or departments of the split. */
const ALLOCATION_FIELDS: HistoryFields = {
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  version_id: hidden('version link'),
  company_id: hidden('allocations expose counts only'),
  department_id: hidden('allocations expose counts only'),
  allocation_pct: hidden('allocations expose counts only'),
  is_system_generated: hidden('allocation detail'),
  rule_id: hidden('allocation detail'),
  materialized_from: hidden('allocation detail'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
  ...OPERATION_FIELDS,
  count: hidden('read by the allocation presentation'),
};

/**
 * The allow-list of every audit label the history presents: a key outside its label's list is
 * dropped, however old or new the payload. The record labels also list every physical column of
 * `spend_items`, shown or hidden with its reason (`record-history-fields` spec checks the catalog
 * against `information_schema`).
 */
export const HISTORY_FIELDS: Readonly<Record<string, HistoryFields>> = {
  spend_items: BUDGET_LINE_FIELDS,
  capex_items: BUDGET_LINE_FIELDS,
  spend_versions: BUDGET_VERSION_FIELDS,
  capex_versions: BUDGET_VERSION_FIELDS,
  spend_round_inputs: ROUND_INPUT_FIELDS,
  capex_round_inputs: ROUND_INPUT_FIELDS,
  spend_links: LINK_FIELDS,
  capex_links: LINK_FIELDS,
  spend_attachments: ATTACHMENT_FIELDS,
  capex_attachments: ATTACHMENT_FIELDS,
  spend_item_contacts: CONTACT_FIELDS,
  capex_item_contacts: CONTACT_FIELDS,
  spend_tasks: TASK_FIELDS,
  spend_amounts: AMOUNT_FIELDS,
  capex_amounts: AMOUNT_FIELDS,
  spend_allocations: ALLOCATION_FIELDS,
  capex_allocations: ALLOCATION_FIELDS,
};

/** A label's allow-list, or an empty one: an undeclared label shows no field. */
function historyFields(label: string): HistoryFields {
  return Object.prototype.hasOwnProperty.call(HISTORY_FIELDS, label) ? HISTORY_FIELDS[label] : {};
}

const CHILD_KIND_LABELS: Record<RecordHistoryChildKind, string> = {
  version: 'version',
  amounts: 'amounts',
  allocations: 'allocations',
  round_input: 'round_input',
  link: 'link',
  attachment: 'attachment',
  contact: 'contact',
  application: 'application',
  technology: 'technology',
  asset: 'asset',
  contract: 'contract',
  project: 'project',
  request: 'request',
  task: 'task',
};

/** The children whose creation is a title only: a version, a budget input, an allocation. */
const TECHNICAL_CHILD_KINDS: ReadonlySet<RecordHistoryChildKind> = new Set(['version', 'round_input', 'allocations']);

/**
 * A technical child's creation: the entry reads as its title, with no field list. A version and a
 * budget input say it with their action; an allocation is written as an update, and its first rows
 * (an empty before, rows after) are its creation.
 */
function technicalCreation(row: AuditRow, kind: RecordHistoryChildKind | null): boolean {
  if (!kind || !TECHNICAL_CHILD_KINDS.has(kind)) return false;
  if (row.action === 'create') return true;
  if (kind === 'allocations') {
    // A copy or a clear is an operation with its own detail, never a plain creation.
    if (isPlainObject(row.after_json) && typeof row.after_json.operation === 'string') return false;
    return (allocationCount(row.before_json) ?? 0) === 0 && (allocationCount(row.after_json) ?? 0) > 0;
  }
  return false;
}

/** The same for a deletion, whose entry keeps its title too. */
function technicalDeletion(row: AuditRow, kind: RecordHistoryChildKind | null): boolean {
  if (!kind || !TECHNICAL_CHILD_KINDS.has(kind)) return false;
  if (row.action === 'delete') return true;
  if (kind === 'allocations') return (allocationCount(row.before_json) ?? 0) > 0 && (allocationCount(row.after_json) ?? 0) === 0;
  return false;
}

type AuditRow = {
  id: string;
  table_name: string;
  record_id: string | null;
  action: string;
  before_json: unknown;
  after_json: unknown;
  user_id: string | null;
  source: string | null;
  created_at: Date | string;
  created_at_text: string;
};

type ReferenceRow = { id: string; label: string | null; reference?: string | null };

type PageContext = {
  entry: RecordHistoryRecord;
  recordId: string;
  users: Map<string, ReferenceRow>;
  versions: Map<string, { name: string | null; year: number | null }>;
  references: Map<FamilyKey, Map<string, ReferenceRow>>;
  readable: Record<FamilyKey, boolean>;
  dimensions: Map<string, string>;
  categories: Map<string, string>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function key(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parseLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

type Cursor = { at: string; id: string };

const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * A complete ISO timestamp: a date, a time to the second and an offset (as `created_at::text`
 * writes it). `Date.parse` alone accepts "1", which PostgreSQL then refuses with a 500.
 */
function isCompleteTimestamp(value: string): boolean {
  const match = TIMESTAMP_RE.exec(value.trim());
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && !Number.isNaN(Date.parse(value));
}

function decodeCursor(cursor: unknown): Cursor | null {
  const text = typeof cursor === 'string' ? cursor.trim() : '';
  if (!text) return null;
  try {
    const parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Cursor;
    if (parsed && typeof parsed.at === 'string' && isCompleteTimestamp(parsed.at) && isUuid(parsed.id)) {
      return { at: parsed.at.trim(), id: parsed.id };
    }
  } catch {
    // falls through to the 400
  }
  throw new BadRequestException('Invalid cursor.');
}

function encodeCursor(row: AuditRow): string {
  return Buffer.from(JSON.stringify({ at: row.created_at_text, id: row.id }), 'utf8').toString('base64url');
}

/**
 * The page of audit rows: each branch uses its own index (`(tenant_id, record_id, created_at)` and
 * `(tenant_id, parent_table, parent_id, created_at DESC)`), both bounded by the cursor, then the
 * union is sorted and cut. `limit + 1` rows tell whether another page exists without reading one.
 */
async function readAuditPage(
  manager: EntityManager,
  tenantId: string,
  entry: RecordHistoryRecord,
  id: string,
  cursor: Cursor | null,
  fetch: number,
): Promise<AuditRow[]> {
  const labels = Array.from(new Set(entry.auditLabels)).sort();
  const childLabels = Object.keys(entry.children).sort();
  return manager.query(
    `SELECT h.id, h.table_name, h.record_id, h.action, h.before_json, h.after_json,
            h.user_id, h.source, h.created_at, h.created_at_text
       FROM (
         (SELECT a.id, a.table_name, a.record_id, a.action, a.before_json, a.after_json,
                 a.user_id, a.source, a.created_at, a.created_at::text AS created_at_text
            FROM audit_log a
           WHERE a.tenant_id = $1
             AND a.table_name = ANY($2::text[])
             AND a.record_id = $3::uuid
             AND ($4::timestamptz IS NULL OR (a.created_at, a.id) < ($4::timestamptz, $5::uuid))
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT $6)
         UNION ALL
         (SELECT a.id, a.table_name, a.record_id, a.action, a.before_json, a.after_json,
                 a.user_id, a.source, a.created_at, a.created_at::text AS created_at_text
            FROM audit_log a
           WHERE a.tenant_id = $1
             AND a.parent_table = $7
             AND a.parent_id = $3::uuid
             AND a.table_name = ANY($8::text[])
             AND ($4::timestamptz IS NULL OR (a.created_at, a.id) < ($4::timestamptz, $5::uuid))
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT $6)
       ) h
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT $6`,
    [tenantId, labels, id, cursor?.at ?? null, cursor?.id ?? null, fetch, entry.table, childLabels],
  );
}

function payloads(row: AuditRow): unknown[] {
  return [row.before_json, row.after_json].filter((value) => value !== null && value !== undefined && typeof value === 'object');
}

function addFamilyId(ctx: { ids: Map<FamilyKey, Set<string>> }, family: FamilyKey, value: unknown) {
  if (!isUuid(value)) return;
  const set = ctx.ids.get(family) ?? new Set<string>();
  set.add(value.toLowerCase());
  ctx.ids.set(family, set);
}

function addVersionId(ctx: { versions: Set<string> }, value: unknown) {
  if (isUuid(value)) ctx.versions.add(value.toLowerCase());
}

function contactIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.split(':')[0])
    .filter(isUuid)
    .map((entry) => entry.toLowerCase());
}

/** The `"<contact_id>:<role>"` states the supplier sync writes, sorted and unique. */
function contactStates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const states: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      if (entry.trim()) states.push(entry.trim());
      continue;
    }
    if (!isPlainObject(entry)) continue;
    // The assistant's relation items: `{ key, label, payload: { contact_id, role, origin } }`.
    const payload = isPlainObject(entry.payload) ? entry.payload : entry;
    const contactId = payload.contact_id;
    if (!isUuid(contactId)) continue;
    const role = typeof payload.role === 'string' && payload.role.trim() ? payload.role.trim() : null;
    states.push(role ? `${contactId}:${role}` : contactId);
  }
  return Array.from(new Set(states));
}

function contactIdOf(state: string): string | null {
  const id = state.split(':')[0];
  return isUuid(id) ? id : null;
}

/** The ids the page's references, versions and dimensions name, read before any row is presented. */
function collectPageIds(rows: AuditRow[], entry: RecordHistoryRecord, recordId: string) {
  const ids = new Map<FamilyKey, Set<string>>();
  const versions = new Set<string>();
  const axes = new Set<string>();
  const categories = new Set<string>();

  const collect = (label: string, kind: RecordHistoryChildKind | null, row: AuditRow) => {
    if (row.user_id) addFamilyId({ ids }, 'user', row.user_id);
    for (const payload of payloads(row)) {
      if (isPlainObject(payload)) {
        for (const [field, rule] of Object.entries(historyFields(label))) {
          if (rule.family) addFamilyId({ ids }, rule.family, payload[field]);
        }
      }
      if (kind === 'contact') {
        if (isPlainObject(payload)) addFamilyId({ ids }, 'contact', payload.contact_id);
        else for (const contactId of contactIds(payload)) addFamilyId({ ids }, 'contact', contactId);
      }
      if (kind === 'application' || kind === 'technology') {
        for (const value of Array.isArray(payload) ? payload : []) addFamilyId({ ids }, kind, value);
      }
      if ((kind === 'contract' || kind === 'project' || kind === 'request')
        && String(row.record_id ?? '').toLowerCase() === recordId.toLowerCase()) {
        // Written from the line: the payload holds the other objects' ids.
        for (const value of linkSetIds(payload)) addFamilyId({ ids }, kind, value);
      }
      if (entry.auditLabels.includes(label) && isPlainObject(payload) && isPlainObject(payload.analytics_values)) {
        for (const [axisId, categoryId] of Object.entries(payload.analytics_values)) {
          if (isUuid(axisId)) axes.add(axisId.toLowerCase());
          if (isUuid(categoryId)) categories.add(categoryId.toLowerCase());
        }
      }
    }
    if ((kind === 'amounts' || kind === 'allocations') && row.record_id) addVersionId({ versions }, row.record_id);
    if (kind === 'round_input' && isPlainObject(row.after_json ?? row.before_json)) {
      const payload = (row.after_json ?? row.before_json) as Record<string, unknown>;
      addVersionId({ versions }, payload.version_id);
    }
    if (kind === 'version' && row.record_id) addVersionId({ versions }, row.record_id);
    if (kind === 'asset' && row.record_id) addFamilyId({ ids }, 'asset', row.record_id);
    if ((kind === 'contract' || kind === 'project' || kind === 'request') && row.record_id
      && String(row.record_id).toLowerCase() !== recordId.toLowerCase()) {
      // Written from the contract, project or request: the record is the other object.
      addFamilyId({ ids }, kind, row.record_id);
    }
    if (kind === 'task' && row.record_id) addFamilyId({ ids }, 'task', row.record_id);
  };

  for (const row of rows) {
    const isRecord = entry.auditLabels.includes(row.table_name);
    collect(row.table_name, isRecord ? null : recordHistoryChildKind(entry, row.table_name), row);
  }
  return { ids, versions, axes, categories };
}

/** Who the reference reads run for: the request transaction, the tenant and the person. */
export type ReferenceReader = {
  manager: EntityManager;
  tenantId: string;
  userId: string;
  isAdmin: boolean;
  viewer: IncidentViewer;
};

/**
 * The rows of each family the person may name, under the tenant predicate, RLS and data access,
 * plus the rule the family's own screen applies:
 * - applications, projects and requests: a Business Contributor only sees the records they take
 *   part in, as the line's Relations tab and their own lists do;
 * - tasks: the same participation, then a task on a confidential incident the viewer may not see
 *   is absent, as the task list applies it.
 *
 * A family with no row here is `{ hidden: true, kind }` in the answer. The scopes are read once per
 * page, and only for a family the page names and the person may read.
 */
export async function loadReferences(
  reader: ReferenceReader,
  ids: Map<FamilyKey, Set<string>>,
  readable: Record<FamilyKey, boolean>,
): Promise<Map<FamilyKey, Map<string, ReferenceRow>>> {
  const out = new Map<FamilyKey, Map<string, ReferenceRow>>();
  const scopes = new Map<ParticipationResource, ParticipationAccessScope | undefined>();
  for (const family of FAMILY_KEYS) {
    const wanted = ids.get(family);
    if (!wanted || wanted.size === 0 || !readable[family]) {
      out.set(family, new Map());
      continue;
    }
    const spec = REFERENCE_FAMILIES[family];
    const params: unknown[] = [reader.tenantId, Array.from(wanted)];
    let visibilitySql = '';
    const scopeResource = spec.visibility.scope;
    if (scopeResource) {
      if (!scopes.has(scopeResource)) {
        scopes.set(scopeResource, await resolveBusinessContributorScopeForUser({
          manager: reader.manager,
          userId: reader.userId,
          tenantId: reader.tenantId,
          isAdmin: reader.isAdmin,
        }, scopeResource));
      }
      const scope = scopes.get(scopeResource);
      if (scope) {
        params.push(scope.userId);
        visibilitySql += ` AND ${PARTICIPATION_CONDITIONS[scopeResource]('r', `$${params.length}`)}`;
      }
    }
    if (spec.visibility.natures) visibilitySql += " AND r.nature IN ('opex', 'capex')";
    if (spec.visibility.incident) visibilitySql += taskIncidentVisibilitySql('r', reader.viewer, params);
    const reference = spec.reference ? `, ${spec.reference} AS reference` : '';
    const rows: ReferenceRow[] = await reader.manager.query(
      `SELECT r.id::text AS id, ${spec.label} AS label${reference}
         FROM ${spec.table} r
        WHERE r.tenant_id = $1 AND r.id = ANY($2::uuid[])${visibilitySql}`,
      params,
    );
    out.set(family, new Map(rows.map((row) => [row.id.toLowerCase(), row])));
  }
  return out;
}

async function loadPageContext(
  ctx: RecordHistoryContext,
  manager: EntityManager,
  entry: RecordHistoryRecord,
  id: string,
  rows: AuditRow[],
): Promise<PageContext> {
  const tenantId = ctx.tenantId;
  const collected = collectPageIds(rows, entry, id);
  const readable = {} as Record<FamilyKey, boolean>;
  for (const family of FAMILY_KEYS) {
    const module = REFERENCE_FAMILIES[family].module;
    readable[family] = module === null || hasLevel(ctx, module, 'reader');
  }

  const users: Map<string, ReferenceRow> = new Map();
  const references = await loadReferences({
    manager,
    tenantId,
    userId: ctx.userId,
    isAdmin: ctx.isAdmin === true,
    viewer: incidentViewerFromContext(ctx),
  }, collected.ids, readable);
  const userRows = references.get('user');
  if (userRows) for (const [userId, row] of userRows) users.set(userId, row);

  const versions: PageContext['versions'] = new Map();
  if (collected.versions.size > 0) {
    const rows: Array<{ id: string; version_name: string | null; budget_year: number | string | null }> = await manager.query(
      `SELECT id::text AS id, version_name, budget_year
         FROM spend_versions
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, Array.from(collected.versions)],
    );
    for (const row of rows) {
      versions.set(row.id.toLowerCase(), {
        name: row.version_name ?? null,
        year: row.budget_year == null ? null : Number(row.budget_year),
      });
    }
  }

  const dimensions = new Map<string, string>();
  const categories = new Map<string, string>();
  if (collected.axes.size > 0) {
    const rows: Array<{ id: string; name: string | null }> = await manager.query(
      `SELECT id::text AS id, name FROM analytics_axes WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, Array.from(collected.axes)],
    );
    for (const row of rows) if (row.name) dimensions.set(row.id.toLowerCase(), row.name);
  }
  if (collected.categories.size > 0) {
    const rows: Array<{ id: string; name: string | null }> = await manager.query(
      `SELECT id::text AS id, name FROM analytics_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, Array.from(collected.categories)],
    );
    for (const row of rows) if (row.name) categories.set(row.id.toLowerCase(), row.name);
  }

  return { entry, recordId: id, users, versions, references, readable, dimensions, categories };
}

function referenceValue(ctx: PageContext, family: FamilyKey, value: unknown): RecordHistoryReference | RecordHistoryHiddenReference | null {
  if (value === null || value === undefined) return null;
  if (!isUuid(value)) return null;
  if (!ctx.readable[family]) return { hidden: true, kind: family };
  const row = ctx.references.get(family)?.get(value.toLowerCase());
  if (!row) return { hidden: true, kind: family };
  return {
    kind: family,
    id: value.toLowerCase(),
    label: row.label ?? null,
    ...(row.reference ? { reference: row.reference } : {}),
  };
}

function userValue(ctx: PageContext, value: unknown): unknown {
  if (!isUuid(value)) return value;
  const row = ctx.readable.user ? ctx.users.get(value.toLowerCase()) : undefined;
  // A person outside the tenant, or a deleted account, is not a readable record: hide it.
  if (!row) return { hidden: true, kind: 'user' };
  return { kind: 'user', id: value.toLowerCase(), label: row.label ?? null };
}

/** A value that is a bare uuid and names nothing mapped shows as a nameless record, never as text. */
function safeScalar(value: unknown): unknown {
  if (typeof value === 'string' && isUuid(value)) return { hidden: true, kind: 'record' };
  return value;
}

function isStructured(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => isPlainObject(item));
  return isPlainObject(value);
}

function amountCents(value: unknown): bigint {
  try {
    return toCents(value as string | number | null | undefined);
  } catch {
    return 0n;
  }
}

type AmountGroup = { year: number | null; before: Map<string, bigint>; after: Map<string, bigint> };

/** `YYYY-MM` of a stored period, or null when the payload carries no month. */
function monthOf(period: unknown): string | null {
  if (typeof period !== 'string' || !/^\d{4}-\d{2}/.test(period)) return null;
  return period.slice(0, 7);
}

function yearOfMonth(month: string | null): number | null {
  if (!month) return null;
  const year = Number(month.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

/**
 * The before and after values of one measure, by year and month. A write only carries the months it
 * touched, so the sums below are the touched months' totals, never an annual total.
 */
function amountGroups(before: unknown[], after: unknown[], measure: string, fallbackYear: number | null): Map<string, AmountGroup> {
  const groups = new Map<string, AmountGroup>();
  const add = (rows: unknown[], side: 'before' | 'after') => {
    for (const row of rows) {
      if (!isPlainObject(row)) continue;
      const month = monthOf(row.period);
      const year = yearOfMonth(month) ?? fallbackYear;
      const key = year === null ? '' : String(year);
      const group = groups.get(key) ?? { year, before: new Map(), after: new Map() };
      // A payload without a month still counts in its year; it simply names no month.
      group[side].set(month ?? '', amountCents(row[measure]));
      groups.set(key, group);
    }
  };
  add(before, 'before');
  add(after, 'after');
  return groups;
}

function sumGroup(months: Map<string, bigint>): bigint {
  let total = 0n;
  for (const value of months.values()) total += value;
  return total;
}

function groupMonths(group: AmountGroup): string[] {
  return Array.from(new Set([...group.before.keys(), ...group.after.keys()]))
    .filter((month) => month !== '')
    .sort();
}

function groupMonthsDiffer(group: AmountGroup): boolean {
  const months = new Set([...group.before.keys(), ...group.after.keys()]);
  for (const month of months) if ((group.before.get(month) ?? 0n) !== (group.after.get(month) ?? 0n)) return true;
  return false;
}

/** The yearly totals the budget file writes in one flat spread (`after.totals`, `before.totals`). */
function flatAmountChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] | null {
  const afterObject = isPlainObject(row.after_json) ? row.after_json : null;
  const afterTotals = afterObject && isPlainObject(afterObject.totals) ? afterObject.totals : null;
  if (!afterTotals) return null;
  const beforeObject = isPlainObject(row.before_json) ? row.before_json : null;
  const beforeTotals = beforeObject && isPlainObject(beforeObject.totals) ? beforeObject.totals : null;
  const version = row.record_id ? ctx.versions.get(row.record_id.toLowerCase()) : undefined;
  const year = typeof afterObject?.year === 'number'
    ? afterObject.year
    : typeof beforeObject?.year === 'number' ? beforeObject.year : version?.year ?? null;
  const changes: RecordHistoryChange[] = [];
  for (const measure of AMOUNT_MEASURES) {
    const b = beforeTotals?.[measure];
    const a = afterTotals[measure];
    if (b === undefined && a === undefined) continue;
    if (b !== undefined && deepEqual(b, a)) continue;
    const money = (value: unknown) => (value === null || value === undefined ? undefined : String(value));
    changes.push({
      field: measure,
      column: measure,
      ...(year === null ? {} : { year }),
      ...(b === undefined ? {} : { before: money(b) }),
      ...(a === undefined ? {} : { after: money(a) }),
      wholeYear: true,
    });
  }
  return changes;
}

function amountChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const flat = flatAmountChanges(row, ctx);
  if (flat) return flat;
  const before = Array.isArray(row.before_json) ? row.before_json : [];
  const after = Array.isArray(row.after_json) ? row.after_json : [];
  const version = row.record_id ? ctx.versions.get(row.record_id.toLowerCase()) : undefined;
  const fallbackYear = version?.year ?? null;
  const changes: RecordHistoryChange[] = [];
  for (const measure of AMOUNT_MEASURES) {
    for (const group of amountGroups(before, after, measure, fallbackYear).values()) {
      const b = sumGroup(group.before);
      const a = sumGroup(group.after);
      const monthlyOnly = b === a && groupMonthsDiffer(group);
      if (b === a && !monthlyOnly) continue;
      const months = groupMonths(group);
      changes.push({
        field: measure,
        before: formatCentsFixed(b),
        after: formatCentsFixed(a),
        ...(group.year === null ? {} : { year: group.year }),
        column: measure,
        ...(months.length === 0 ? {} : { months }),
        ...(months.length === 12 ? { wholeYear: true } : {}),
        ...(monthlyOnly ? { monthlyOnly: true } : {}),
      });
    }
  }
  return changes;
}

function allocationCount(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (isPlainObject(value) && typeof value.count === 'number') return value.count;
  return null;
}

function allocationChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = row.before_json;
  const after = row.after_json;
  const version = row.record_id ? ctx.versions.get(row.record_id.toLowerCase()) : undefined;
  const year = version?.year ?? null;
  const afterObject = isPlainObject(after) ? after : null;
  if (afterObject?.operation === 'allocation_copy') {
    return [{
      field: 'allocations',
      before: allocationCount(before) ?? 0,
      after: allocationCount(after) ?? 0,
      year: typeof afterObject.destinationYear === 'number' ? afterObject.destinationYear : year ?? undefined,
      sourceYear: typeof afterObject.sourceYear === 'number' ? afterObject.sourceYear : undefined,
      ...(afterObject.overwrite === true ? { overwrite: true } : {}),
    }];
  }
  const b = allocationCount(before);
  const a = allocationCount(after);
  if (b === null && a === null) return [];
  if (b === a && deepEqual(before, after)) return [];
  return [{
    field: 'allocations',
    before: b ?? 0,
    after: a ?? 0,
    ...(year === null ? {} : { year }),
    ...(b === a ? { changed: true } : {}),
  }];
}

function roundInputLines(value: unknown): Array<{ label: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isPlainObject)
    .map((line) => ({ label: typeof line.label === 'string' ? line.label : '' }))
    .filter((line) => line.label.trim() !== '');
}

function roundInputChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : {};
  const after = isPlainObject(row.after_json) ? row.after_json : {};
  const changes = genericChanges(row, ctx, { label: row.table_name });
  const beforeLines = roundInputLines(before.lines);
  const afterLines = roundInputLines(after.lines);
  const beforeLabels = new Set(beforeLines.map((line) => line.label));
  const afterLabels = new Set(afterLines.map((line) => line.label));
  for (const line of afterLines) {
    if (!beforeLabels.has(line.label)) changes.push({ field: 'line', event: 'added', after: line.label });
  }
  for (const line of beforeLines) {
    if (!afterLabels.has(line.label)) changes.push({ field: 'line', event: 'removed', before: line.label });
  }
  if (beforeLines.length === afterLines.length && deepEqual(beforeLines, afterLines) === false
    && changes.every((change) => change.field !== 'line')) {
    changes.push({ field: 'lines', before: beforeLines.length, after: afterLines.length, changed: true });
  }
  return changes;
}

function childRef(kind: RecordHistoryChildKind, id: string | null, label: string | null): RecordHistoryReference | null {
  if (!id) return null;
  return { kind: CHILD_KIND_LABELS[kind], id, label };
}

function labelOf(row: AuditRow, fields: readonly string[]): string | null {
  for (const payload of [row.after_json, row.before_json]) {
    if (!isPlainObject(payload)) continue;
    for (const field of fields) {
      const value = payload[field];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return null;
}

/** The readable label of each link in an assistant payload (`{ payload: { url, description } }`). */
function linkLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      if (entry.trim()) labels.push(entry.trim());
      continue;
    }
    if (!isPlainObject(entry)) continue;
    const payload = isPlainObject(entry.payload) ? entry.payload : entry;
    const label = [payload.description, payload.url].find((part) => typeof part === 'string' && part.trim());
    if (typeof label === 'string') labels.push(label.trim());
  }
  return Array.from(new Set(labels));
}

function linkChanges(row: AuditRow): RecordHistoryChange[] {
  if (row.before_json === null || row.before_json === undefined) {
    return [{ field: 'link', event: 'added', after: childRef('link', row.record_id, labelOf(row, ['description', 'url'])) }];
  }
  if (row.after_json === null || row.after_json === undefined) {
    return [{ field: 'link', event: 'removed', before: childRef('link', row.record_id, labelOf(row, ['description', 'url'])) }];
  }
  if (Array.isArray(row.before_json) || Array.isArray(row.after_json)) {
    // The assistant replaces the whole link set in one row, with no link id: the change names each
    // link by what the payload holds, and never borrows the line's own id.
    const beforeLabels = linkLabels(row.before_json);
    const afterLabels = linkLabels(row.after_json);
    const beforeSet = new Set(beforeLabels);
    const afterSet = new Set(afterLabels);
    const changes: RecordHistoryChange[] = [];
    for (const label of afterLabels) if (!beforeSet.has(label)) changes.push({ field: 'link', event: 'added', after: label });
    for (const label of beforeLabels) if (!afterSet.has(label)) changes.push({ field: 'link', event: 'removed', before: label });
    return changes;
  }
  const changes: RecordHistoryChange[] = [];
  const before = isPlainObject(row.before_json) ? row.before_json : {};
  const after = isPlainObject(row.after_json) ? row.after_json : {};
  for (const field of ['url', 'description']) {
    if (!deepEqual(before[field], after[field])) {
      changes.push({ field, before: safeScalar(before[field]) ?? null, after: safeScalar(after[field]) ?? null });
    }
  }
  return changes;
}

function attachmentChanges(row: AuditRow): RecordHistoryChange[] {
  if (row.after_json === null || row.after_json === undefined) {
    return [{ field: 'attachment', event: 'removed', before: childRef('attachment', row.record_id, labelOf(row, ['original_filename'])) }];
  }
  return [{ field: 'attachment', event: 'added', after: childRef('attachment', row.record_id, labelOf(row, ['original_filename'])) }];
}

function contactChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const changes: RecordHistoryChange[] = [];
  const before = row.before_json;
  const after = row.after_json;
  if (Array.isArray(before) || Array.isArray(after)) {
    const beforeSet = new Set(contactStates(before));
    const afterSet = new Set(contactStates(after));
    for (const state of afterSet) {
      if (!beforeSet.has(state)) {
        changes.push({ field: 'contact', event: 'added', after: referenceValue(ctx, 'contact', contactIdOf(state)) });
      }
    }
    for (const state of beforeSet) {
      if (!afterSet.has(state)) {
        changes.push({ field: 'contact', event: 'removed', before: referenceValue(ctx, 'contact', contactIdOf(state)) });
      }
    }
    return changes;
  }
  if (after === null || after === undefined) {
    const id = isPlainObject(before) && isUuid(before.contact_id) ? before.contact_id : null;
    return [{ field: 'contact', event: 'removed', before: referenceValue(ctx, 'contact', id) }];
  }
  const id = isPlainObject(after) && isUuid(after.contact_id) ? after.contact_id : null;
  return [{ field: 'contact', event: 'added', after: referenceValue(ctx, 'contact', id) }];
}

function setLinkChanges(kind: 'application' | 'technology', row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = Array.isArray(row.before_json) ? row.before_json : [];
  const after = Array.isArray(row.after_json) ? row.after_json : [];
  const beforeSet = new Set(before.filter(isUuid).map((id) => id.toLowerCase()));
  const afterSet = new Set(after.filter(isUuid).map((id) => id.toLowerCase()));
  const changes: RecordHistoryChange[] = [];
  for (const id of afterSet) {
    if (!beforeSet.has(id)) changes.push({ field: kind, event: 'added', after: referenceValue(ctx, kind, id) });
  }
  for (const id of beforeSet) {
    if (!afterSet.has(id)) changes.push({ field: kind, event: 'removed', before: referenceValue(ctx, kind, id) });
  }
  return changes;
}

function assetIds(value: unknown): string[] {
  if (!isPlainObject(value) || !Array.isArray(value.ids)) return [];
  return value.ids.filter(isUuid).map((id) => id.toLowerCase());
}

/** The ids of a link-set payload: an array of ids, or `{ ids }` as the writers and `auditedLinkSet` shape it. */
function linkSetIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : isPlainObject(value) && Array.isArray(value.ids) ? value.ids : [];
  return list.filter(isUuid).map((id) => id.toLowerCase());
}


function assetChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = new Set(assetIds(row.before_json));
  const after = new Set(assetIds(row.after_json));
  const lineId = ctx.recordId.toLowerCase();
  const asset = referenceValue(ctx, 'asset', row.record_id);
  if (after.has(lineId) && !before.has(lineId)) return [{ field: 'asset', event: 'added', after: asset }];
  if (before.has(lineId) && !after.has(lineId)) return [{ field: 'asset', event: 'removed', before: asset }];
  return [];
}

/**
 * A contract, project or request link: from the line side the payload holds the other objects, so
 * each added or removed id is one link; from the contract, project or request side the payload
 * holds line ids, and the entry names that record when this line joined or left its set. The name
 * resolves with the reader's rights (contract policy and scope, project/request participation).
 */
function linkedRecordChanges(kind: 'contract' | 'project' | 'request', row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const before = new Set(linkSetIds(row.before_json));
  const after = new Set(linkSetIds(row.after_json));
  const lineId = ctx.recordId.toLowerCase();
  const changes: RecordHistoryChange[] = [];
  if (String(row.record_id ?? '').toLowerCase() === lineId) {
    for (const id of after) {
      if (!before.has(id)) changes.push({ field: kind, event: 'added', after: referenceValue(ctx, kind, id) });
    }
    for (const id of before) {
      if (!after.has(id)) changes.push({ field: kind, event: 'removed', before: referenceValue(ctx, kind, id) });
    }
    return changes;
  }
  const record = referenceValue(ctx, kind, row.record_id);
  if (after.has(lineId) && !before.has(lineId)) changes.push({ field: kind, event: 'added', after: record });
  if (before.has(lineId) && !after.has(lineId)) changes.push({ field: kind, event: 'removed', before: record });
  return changes;
}

function taskChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const task = referenceValue(ctx, 'task', row.record_id);
  if (row.action === 'delete' || (row.after_json === null || row.after_json === undefined)) {
    return [{ field: 'task', event: 'removed', before: task }];
  }
  if (row.action === 'create' || (row.action !== 'update' && (row.before_json === null || row.before_json === undefined))) {
    return [{ field: 'task', event: 'added', after: task }];
  }
  // A legacy update writes `before: null`: a modification whose detail is not known.
  return [];
}

/** One change per dimension whose category changed; a removed value shows as `null`. */
function dimensionChanges(before: unknown, after: unknown, ctx: PageContext): RecordHistoryChange[] {
  const b = isPlainObject(before) ? before : {};
  const a = isPlainObject(after) ? after : {};
  const axes = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changes: RecordHistoryChange[] = [];
  for (const axisId of axes) {
    const beforeCategory = b[axisId];
    const afterCategory = a[axisId];
    if (deepEqual(beforeCategory, afterCategory)) continue;
    const name = (id: unknown) => (isUuid(id) ? ctx.categories.get(id.toLowerCase()) ?? null : null);
    changes.push({
      field: 'dimension',
      dimension: isUuid(axisId) ? ctx.dimensions.get(axisId.toLowerCase()) ?? null : null,
      before: name(beforeCategory),
      after: name(afterCategory),
    });
  }
  return changes;
}

type GenericOptions = { label: string };

/**
 * The changed keys of a before/after payload, from its label's allow-list only: a field outside it
 * is dropped, with no neighbour to guess, and the fields the history has no structured form for
 * are left out. A whole payload that is not an object only yields the fields of a column operation
 * (copy, clear), which are read below.
 */
function genericChanges(row: AuditRow, ctx: PageContext, options: GenericOptions): RecordHistoryChange[] {
  const before = isPlainObject(row.before_json) ? row.before_json : {};
  const after = isPlainObject(row.after_json) ? row.after_json : {};
  const changes: RecordHistoryChange[] = [];
  const fields = historyFields(options.label);
  const creating = row.before_json === null || row.before_json === undefined;
  const deleting = row.after_json === null || row.after_json === undefined;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const field of keys) {
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
    const rule = fields[field];
    if (rule.hidden) continue;
    const b = before[field];
    const a = after[field];
    if (deepEqual(b, a)) continue;
    if ((b === null || b === undefined || b === '') && (a === null || a === undefined || a === '')) continue;
    if (field === 'analytics_values') {
      changes.push(...dimensionChanges(b, a, ctx));
      continue;
    }
    if (isStructured(b) || isStructured(a)) continue;
    let beforeValue: unknown = b;
    let afterValue: unknown = a;
    const family = rule.family;
    if (family === 'user') {
      beforeValue = userValue(ctx, b);
      afterValue = userValue(ctx, a);
    } else if (family) {
      beforeValue = referenceValue(ctx, family, b);
      afterValue = referenceValue(ctx, family, a);
    } else {
      beforeValue = safeScalar(b);
      afterValue = safeScalar(a);
    }
    if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
      const scalars = (value: unknown) => Array.isArray(value) && value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item));
      if (!scalars(beforeValue) || !scalars(afterValue)) continue;
      // An array of ids has no readable form here: never copy uuids into the answer.
      const ids = (value: unknown) => Array.isArray(value) && value.some(isUuid);
      if (ids(beforeValue) || ids(afterValue)) continue;
    }
    changes.push({
      field,
      ...(creating ? {} : { before: beforeValue ?? null }),
      ...(deleting ? {} : { after: afterValue ?? null }),
    });
  }
  return changes;
}

/** A column copy or clear writes the line's row with the API column and its operation context. */
function columnOperationChanges(row: AuditRow): RecordHistoryChange[] | null {
  const after = isPlainObject(row.after_json) ? row.after_json : null;
  if (!after) return null;
  const operation = after.operation;
  if (operation === 'budget_column_clear') {
    const column = typeof after.column === 'string' ? after.column : null;
    if (!column) return null;
    const before = isPlainObject(row.before_json) ? row.before_json[column] : null;
    return [{
      field: column,
      before: typeof before === 'number' || typeof before === 'string' ? before : 0,
      after: 0,
      ...(typeof after.year === 'number' ? { year: after.year } : {}),
    }];
  }
  if (operation === 'budget_column_copy') {
    const destinationColumn = typeof after.destinationColumn === 'string' ? after.destinationColumn : null;
    const sourceColumn = typeof after.sourceColumn === 'string' ? after.sourceColumn : null;
    if (!destinationColumn || !sourceColumn) return null;
    const before = isPlainObject(row.before_json) ? row.before_json[destinationColumn] : null;
    return [{
      field: destinationColumn,
      before: typeof before === 'number' || typeof before === 'string' ? before : 0,
      after: after[destinationColumn] ?? null,
      ...(typeof after.destinationYear === 'number' ? { year: after.destinationYear } : {}),
      ...(typeof after.sourceYear === 'number' ? { sourceYear: after.sourceYear } : {}),
      sourceColumn,
      ...(after.percentageIncrease !== undefined ? { percentageIncrease: String(after.percentageIncrease) } : {}),
    }];
  }
  return null;
}

function recordChanges(row: AuditRow, ctx: PageContext): RecordHistoryChange[] {
  const columnOperation = columnOperationChanges(row);
  if (columnOperation) return columnOperation;
  return genericChanges(row, ctx, { label: row.table_name });
}

function changesFor(row: AuditRow, kind: RecordHistoryChildKind | null, ctx: PageContext): RecordHistoryChange[] {
  if (kind === null) return recordChanges(row, ctx);
  // A technical child's birth or removal is its title: its fields are not a change the reader reads.
  if (technicalCreation(row, kind) || technicalDeletion(row, kind)) return [];
  switch (kind) {
    case 'amounts':
      return amountChanges(row, ctx);
    case 'allocations':
      return allocationChanges(row, ctx);
    case 'round_input':
      return roundInputChanges(row, ctx);
    case 'link':
      return linkChanges(row);
    case 'attachment':
      return attachmentChanges(row);
    case 'contact':
      return contactChanges(row, ctx);
    case 'application':
    case 'technology':
      return setLinkChanges(kind, row, ctx);
    case 'asset':
      return assetChanges(row, ctx);
    case 'contract':
    case 'project':
    case 'request':
      return linkedRecordChanges(kind, row, ctx);
    case 'task':
      return taskChanges(row, ctx);
    case 'version':
      return genericChanges(row, ctx, { label: row.table_name });
    default:
      return [];
  }
}

function subjectLabel(row: AuditRow, kind: RecordHistoryChildKind | null, ctx: PageContext, changes: RecordHistoryChange[]): string | null {
  if (kind === null) return null;
  switch (kind) {
    case 'version': {
      const payload = isPlainObject(row.after_json) ? row.after_json : isPlainObject(row.before_json) ? row.before_json : null;
      const name = payload && typeof payload.version_name === 'string' ? payload.version_name : null;
      if (name) return name;
      return row.record_id ? ctx.versions.get(row.record_id.toLowerCase())?.name ?? null : null;
    }
    case 'amounts':
    case 'allocations':
      return row.record_id ? ctx.versions.get(row.record_id.toLowerCase())?.name ?? null : null;
    case 'round_input': {
      const payload = isPlainObject(row.after_json) ? row.after_json : isPlainObject(row.before_json) ? row.before_json : null;
      return payload && typeof payload.measure === 'string' ? payload.measure : null;
    }
    case 'link': {
      const label = labelOf(row, ['description', 'url']);
      if (label) return label;
      const events = changes.filter((change) => change.event);
      if (events.length === 1) {
        const value = events[0].after ?? events[0].before;
        if (typeof value === 'string' && value.trim()) return value;
      }
      return null;
    }
    case 'attachment':
      return labelOf(row, ['original_filename']);
    case 'contact':
    case 'application':
    case 'technology':
    case 'asset':
    case 'contract':
    case 'project':
    case 'request':
    case 'task': {
      const events = changes.filter((change) => change.event);
      const labels = new Set<string>();
      for (const change of events) {
        const value = (change.after ?? change.before) as RecordHistoryReference | RecordHistoryHiddenReference | null | undefined;
        if (value && !('hidden' in value) && typeof value.label === 'string' && value.label.trim()) {
          labels.add(value.label.trim());
        }
      }
      // The same label on both sides (a role change) names the entry; two different records do not.
      if (labels.size === 1) return Array.from(labels)[0];
      if (kind === 'task' && row.record_id) {
        return ctx.references.get('task')?.get(row.record_id.toLowerCase())?.label ?? null;
      }
      return null;
    }
    default:
      return null;
  }
}

function actorOf(row: AuditRow, users: Map<string, ReferenceRow>): RecordHistoryActor {
  const source = String(row.source ?? '').trim().toLowerCase();
  const name = row.user_id ? users.get(row.user_id.toLowerCase())?.label ?? null : null;
  const importing = source === 'budget_file' || /(^|_)import($|_)/.test(source);
  if (source === 'system' || (!row.user_id && !importing && source !== 'ai_chat' && source !== 'ai_mcp')) {
    return { kind: 'system', name: null };
  }
  if (source === 'ai_chat' || source === 'ai_mcp') return { kind: 'assistant', name };
  if (importing) return { kind: 'import', name };
  return { kind: 'user', name };
}

function presentedAction(row: AuditRow, kind: RecordHistoryChildKind | null): string {
  if (technicalCreation(row, kind)) return 'create';
  if (technicalDeletion(row, kind)) return 'delete';
  return row.action;
}

function presentItem(row: AuditRow, entry: RecordHistoryRecord, ctx: PageContext): RecordHistoryItem {
  const kind = entry.auditLabels.includes(row.table_name) ? null : recordHistoryChildKind(entry, row.table_name);
  const changes = changesFor(row, kind, ctx);
  const label = subjectLabel(row, kind, ctx, changes);
  return {
    id: row.id,
    at: new Date(row.created_at).toISOString(),
    action: presentedAction(row, kind),
    actor: actorOf(row, ctx.users),
    subject: {
      kind: kind ?? 'record',
      ...(label ? { label } : {}),
    },
    changes,
  };
}

export class RecordHistoryService {
  /**
   * The history of one record, newest first. The record is read first under `ctx.manager` (the
   * tenant and the person's access); a table outside the inventory or an id that is not a uuid is a
   * 404, a module the person does not read a 403, a missing or out-of-access record a 404.
   */
  async list(
    ctx: RecordHistoryContext,
    table: string,
    id: string,
    options: RecordHistoryListOptions = {},
  ): Promise<RecordHistoryPage> {
    const key = String(table ?? '');
    const entry = Object.prototype.hasOwnProperty.call(RECORD_HISTORY, key) ? RECORD_HISTORY[key] : undefined;
    if (!entry) throw new NotFoundException('Record not found');
    if (!isUuid(id)) throw new NotFoundException('Record not found');
    if (!hasLevel(ctx, entry.module, entry.level)) {
      throw new ForbiddenException(`You cannot read this record's history.`);
    }
    const manager = ctx.manager;
    if (!manager) throw new Error('RecordHistoryService.list needs the request transaction (ctx.manager).');

    // `AGENTS.md`: a read of `spend_items` names its nature. The inventory's check covers both
    // natures by design; the guard is added here because the inventory is shared with another lot.
    const natureGuard = entry.table === 'spend_items' ? " AND nature IN ('opex', 'capex')" : '';
    const found: Array<{ id: string; item_number?: number | string | null }> = await manager.query(`${entry.checkSql}${natureGuard}`, [ctx.tenantId, id]);
    if (!found[0]) throw new NotFoundException('Record not found');

    const limit = parseLimit(options.limit);
    const cursor = decodeCursor(options.cursor);
    const rows = await readAuditPage(manager, ctx.tenantId, entry, id, cursor, limit + 1);
    const page = rows.slice(0, limit);
    const pageContext = await loadPageContext(ctx, manager, entry, id, page);
    const items = page.map((row) => presentItem(row, entry, pageContext))
      // A write the reader cannot see as a change is not an entry: an update that presents nothing
      // (an import marker, a copied method that did not move) stays out. A creation and a deletion
      // always stay, even when their title is all there is.
      .filter((item) => item.action !== 'update' || item.changes.length > 0);
    return {
      items,
      // The cursor stays the last audit row of the page: a page may hold fewer entries than rows,
      // and the next one starts after the row it was cut at.
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
    };
  }
}
