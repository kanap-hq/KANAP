import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { TenantRequest } from '../common/decorators/tenant.decorator';
import { hasLevel } from '../common/relations/relations-access';
import { moduleRightRequired } from '../auth/module-right-required';
import { incidentViewerFromContext } from '../incidents/incident-visibility';
import {
  recordHistoryChildKind,
  recordHistoryEntry,
  type RecordHistoryChildKind,
  type RecordHistoryRecord,
} from './record-history.inventory';
import {
  FAMILY_KEYS,
  FAMILY_MODULES,
  loadReferences,
  readableFamilies,
  recordIsVisible,
  resolveReferences,
  type FamilyCodeCheckKey,
  type FamilyKey,
  type ReferenceReader,
  type ReferenceRow,
} from './record-history/families';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { HISTORY_FIELDS, historyFields } from './record-history/fields';
import type { HistoryFieldRule, HistoryFields } from './record-history/field-rules';
import { auditPageQuery, type AuditCursor } from './record-history/query';
import { taskRelatedFamily } from './record-history/records/tasks';
import { requestAuditPayload } from './record-history/records/portfolio_requests';
import {
  linkReference,
  presentItem,
  type AuditRow,
  type PageContext,
  type RecordHistoryActor,
  type RecordHistoryActorKind,
  type RecordHistoryChange,
  type RecordHistoryHiddenReference,
  type RecordHistoryItem,
  type RecordHistoryPage,
  type RecordHistoryReference,
  type RecordHistorySubject,
} from './record-history/presenters';
import { contactIds, isPlainObject, isUuid, linkSetIds } from './record-history/values';
import { contractClosedLabels, contractsRecord } from './record-history/records/contracts';

/**
 * The history of one record, as its page shows it (lot 1B, extended by lot 2).
 *
 * `GET /records/:table/:id/history` loads the record first, in the request's transaction
 * (`ctx.manager`: tenant context and the person's data access), then reads the audit rows by its id.
 * `audit_log` has only its tenant policy, so this order is what keeps a person from reading the
 * history of a record they cannot open: the record check runs the visibility rule of the entry's
 * reference family (`familyVisibilitySql`), the same rule `loadReferences` applies to every
 * reference it resolves, so a record outside the person's access (or missing) is not found.
 *
 * The service is generic: a record family is declared in `record-history/records/<table>.ts` (its
 * table, module, family, audit labels and children) and aggregated by `record-history.inventory.ts`.
 * The reference families live in `record-history/families.ts`; the presentation of a child kind in
 * `record-history/presenters.ts`. A new family that only adds a record entry needs no change here.
 *
 * Large pages cost a bounded number of statements: the audit page, the authors, the versions, one
 * query per reference family present in the page, and the dimensions it names. No query loops over
 * the rows.
 */

export type RecordHistoryContext = Pick<
  TenantRequest,
  'tenantId' | 'userId' | 'isAdmin' | 'permissions' | 'manager'
>;

export type RecordHistoryListOptions = { cursor?: string | null; limit?: unknown };

export {
  FAMILY_KEYS,
  FAMILY_MODULES,
  HISTORY_FIELDS,
  loadReferences,
  recordIsVisible,
};
export type {
  FamilyKey,
  HistoryFieldRule,
  HistoryFields,
  RecordHistoryActor,
  RecordHistoryActorKind,
  RecordHistoryChange,
  RecordHistoryHiddenReference,
  RecordHistoryItem,
  RecordHistoryPage,
  RecordHistoryReference,
  RecordHistorySubject,
  ReferenceReader,
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

type Cursor = AuditCursor;

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
 * The page of audit rows, read by `record-history/query.ts`: the record's labels and its `record`
 * child reads on `(tenant_id, record_id, created_at)`, the other children on
 * `(tenant_id, parent_table, parent_id, created_at DESC)`, and one branch per payload key on the
 * family's partial index. Every branch is bounded by the cursor; `UNION` drops a row two branches
 * both find; the outer sort and cut return `limit + 1` rows, which tells whether another page
 * exists without reading one.
 */
async function readAuditPage(
  manager: EntityManager,
  tenantId: string,
  entry: RecordHistoryRecord,
  id: string,
  cursor: Cursor | null,
  fetch: number,
  closedLabels: readonly string[],
): Promise<AuditRow[]> {
  const query = auditPageQuery(entry, tenantId, id, cursor, fetch, closedLabels);
  return manager.query(query.sql, query.params);
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

/** The string states of a whole-set write (`["business:<id>"]`). */
function stateStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

/** The id a `type:id` or `direction:id` state carries. */
function stateId(state: string): string | null {
  const index = state.indexOf(':');
  const id = index >= 0 ? state.slice(index + 1) : state;
  return isUuid(id) ? id : null;
}

/** The ids a set write may name: a person, a company, or another interface. */
function collectSetIds(ctx: { ids: Map<FamilyKey, Set<string>> }, label: string, row: AuditRow) {
  const family: FamilyKey | null = label === 'interface_owners'
    ? 'user'
    : label === 'interface_companies' || label === 'application_companies'
      ? 'company'
      : label === 'interface_dependencies'
        ? 'interface'
        : label === 'application_departments'
          ? 'department'
          : label === 'application_suites'
            ? 'application'
            : null;
  if (!family) return;
  for (const payload of [row.before_json, row.after_json]) {
    for (const state of stateStrings(payload)) addFamilyId(ctx, family, stateId(state));
  }
}

/** The ids the page's references, versions and dimensions name, read before any row is presented. */
function collectPageIds(rows: AuditRow[], entry: RecordHistoryRecord, recordId: string) {
  const ids = new Map<FamilyKey, Set<string>>();
  const versions = new Set<string>();
  const axes = new Set<string>();
  const categories = new Set<string>();
  const instances = new Set<string>();
  const criteria = new Set<string>();
  const criterionOptions = new Set<string>();

  const collect = (label: string, kind: RecordHistoryChildKind | null, row: AuditRow) => {
    if (row.user_id) addFamilyId({ ids }, 'user', row.user_id);
    for (const payload of payloads(row)) {
      if (isPlainObject(payload)) {
        // A request's task-origin cleanup names the task under its own key (`requestAuditPayload`).
        const fieldsPayload = label === 'portfolio_requests' ? requestAuditPayload(payload) as Record<string, unknown> : payload;
        for (const [field, rule] of Object.entries(historyFields(label))) {
          if (rule.family) addFamilyId({ ids }, rule.family, fieldsPayload[field]);
        }
        // A link names its other record by a payload key of its kind (a contact's supplier,
        // contract or budget line), not by one of the record's own fields.
        const link = linkReference(kind, payload);
        if (link) addFamilyId({ ids }, link.family, link.id);
      }
      if (kind === 'contact' && !isPlainObject(payload)) {
        for (const contactId of contactIds(payload)) addFamilyId({ ids }, 'contact', contactId);
      }
      // A project's contacts are a set of ids.
      if (kind === 'contact' && isPlainObject(payload) && Array.isArray(payload.ids)) {
        for (const contactId of contactIds(payload.ids)) addFamilyId({ ids }, 'contact', contactId);
      }
      // A team names its people (`{ role, ids }`), an effort allocation each person's share.
      if (kind === 'team' && isPlainObject(payload)) {
        for (const userId of linkSetIds(payload)) addFamilyId({ ids }, 'user', userId);
        if (Array.isArray(payload.allocations)) {
          for (const allocation of payload.allocations) {
            if (isPlainObject(allocation)) addFamilyId({ ids }, 'user', allocation.user_id);
          }
        }
      }
      // A dependency set names projects (`ids`) and, from a request, requests (`request_ids`).
      if (kind === 'dependency' && isPlainObject(payload)) {
        for (const value of linkSetIds(payload)) addFamilyId({ ids }, 'project', value);
        for (const value of linkSetIds(payload.request_ids)) addFamilyId({ ids }, 'request', value);
      }
      // The project's scoring names its criteria and options by id.
      if (entry.auditLabels.includes(label) && isPlainObject(payload) && isPlainObject(payload.criteria_values)) {
        for (const [criterionId, optionId] of Object.entries(payload.criteria_values)) {
          if (isUuid(criterionId)) criteria.add(criterionId.toLowerCase());
          if (isUuid(optionId)) criterionOptions.add(optionId.toLowerCase());
        }
      }
      const addList = (family: FamilyKey, list: unknown) => {
        if (Array.isArray(list)) for (const value of list) addFamilyId({ ids }, family, value);
      };
      if (kind === 'application') {
        if (Array.isArray(payload)) addList('application', linkSetIds(payload));
        else if (isPlainObject(payload)) {
          addList('application', payload.added);
          addList('application', payload.removed);
          addList('application', payload.ids);
          addFamilyId({ ids }, 'application', payload.application_id);
        }
      }
      if (kind === 'technology') {
        if (Array.isArray(payload)) addList('technology', linkSetIds(payload));
        else if (isPlainObject(payload)) {
          addList('technology', payload.added);
          addList('technology', payload.removed);
          addList('technology', payload.ids);
          addFamilyId({ ids }, 'technology', payload.technology_id);
        }
        // An installed or declared technology names the technology in `record_id` from the asset's
        // or the application's side.
        if ((entry.table === 'assets' || entry.table === 'applications') && isUuid(row.record_id)) {
          addFamilyId({ ids }, 'technology', row.record_id);
        }
      }
      if (kind === 'asset') {
        // On a budget line, the link payload holds line ids and `record_id` is the asset; on a
        // technology, the payload names the asset. Each side then gets the reference it shows.
        if (entry.table === 'spend_items') {
          if (isUuid(row.record_id)) addFamilyId({ ids }, 'asset', row.record_id);
        } else if (Array.isArray(payload)) {
          addList('asset', linkSetIds(payload));
        } else if (isPlainObject(payload)) {
          addList('asset', payload.ids);
          addList('asset', payload.added);
          addList('asset', payload.removed);
          addFamilyId({ ids }, 'asset', payload.asset_id);
        }
      }
      if (kind === 'budget_line') {
        for (const value of linkSetIds(payload)) addFamilyId({ ids }, 'budget_line', value);
      }
      if (kind === 'relation' && isPlainObject(payload) && Array.isArray(payload.relations)) {
        for (const relation of payload.relations) {
          if (isPlainObject(relation)) addFamilyId({ ids }, 'asset', relation.related_asset_id);
        }
      }
      if (kind === 'member' && isPlainObject(payload)) addList('asset', payload.members);
      if (kind === 'owner' && Array.isArray(payload)) {
        for (const state of payload) {
          if (typeof state !== 'string') continue;
          const [role, userId] = state.split(':');
          if ((role === 'it' || role === 'business') && isUuid(userId)) addFamilyId({ ids }, 'user', userId);
        }
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
      if (entry.table === 'tasks' && label === 'tasks' && isPlainObject(payload)) {
        // A task names the record it belongs to by its type and id, the request it was converted
        // into, and its owners and viewers as id lists.
        const family = taskRelatedFamily(payload.related_object_type);
        if (family) addFamilyId({ ids }, family, payload.related_object_id);
        addFamilyId({ ids }, 'request', payload.converted_to_request_id);
        addList('user', payload.owner_ids);
        addList('user', payload.viewer_ids);
      }
      if (entry.auditLabels.includes(label) && isPlainObject(payload) && isPlainObject(payload.renewal_task)) {
        // A contract's renewal marker names the decision task it created.
        addFamilyId({ ids }, 'task', payload.renewal_task.task_id);
      }
      if (entry.auditLabels.includes(label) && isPlainObject(payload) && Array.isArray(payload.middleware_application_ids)) {
        // An older interface writer kept the middleware applications as an id list in the payload.
        for (const applicationId of payload.middleware_application_ids) addFamilyId({ ids }, 'application', applicationId);
      }
    }
    if (kind === 'set') collectSetIds({ ids }, label, row);
    if ((kind === 'amounts' || kind === 'allocations') && row.record_id) addVersionId({ versions }, row.record_id);
    if (kind === 'round_input' && isPlainObject(row.after_json ?? row.before_json)) {
      const payload = (row.after_json ?? row.before_json) as Record<string, unknown>;
      addVersionId({ versions }, payload.version_id);
    }
    if (kind === 'version' && row.record_id) addVersionId({ versions }, row.record_id);
    if ((kind === 'contract' || kind === 'project' || kind === 'request') && row.record_id
      && String(row.record_id).toLowerCase() !== recordId.toLowerCase()) {
      // Written from the contract, project or request: the record is the other object.
      addFamilyId({ ids }, kind, row.record_id);
    }
    if (kind === 'task' && row.record_id) addFamilyId({ ids }, 'task', row.record_id);
    // A process link is written from the process: `record_id` is the process. From a request,
    // `record_id` is the request and the payload the set of process ids.
    if (kind === 'business_process' && row.record_id) {
      if (String(row.record_id).toLowerCase() === recordId.toLowerCase()) {
        for (const payload of payloads(row)) {
          for (const value of linkSetIds(payload)) addFamilyId({ ids }, 'business_process', value);
        }
      } else {
        addFamilyId({ ids }, 'business_process', row.record_id);
      }
    }
    if (kind === 'assignment') {
      for (const payload of payloads(row)) {
        if (isPlainObject(payload) && isUuid(payload.app_instance_id)) instances.add(payload.app_instance_id.toLowerCase());
      }
    }
  };

  for (const row of rows) {
    const isRecord = entry.auditLabels.includes(row.table_name);
    collect(row.table_name, isRecord ? null : recordHistoryChildKind(entry, row.table_name), row);
  }
  return { ids, versions, axes, categories, instances, criteria, criterionOptions };
}

async function loadPageContext(
  ctx: RecordHistoryContext,
  entry: RecordHistoryRecord,
  id: string,
  rows: AuditRow[],
  reader: ReferenceReader,
): Promise<PageContext> {
  const tenantId = ctx.tenantId;
  const collected = collectPageIds(rows, entry, id);
  const readable = readableFamilies(ctx);

  const users: Map<string, ReferenceRow> = new Map();
  const { rows: references, deleted } = await resolveReferences(reader, collected.ids, readable);
  const userRows = references.get('user');
  if (userRows) for (const [userId, row] of userRows) users.set(userId, row);

  const versions: PageContext['versions'] = new Map();
  if (collected.versions.size > 0) {
    const rows: Array<{ id: string; version_name: string | null; budget_year: number | string | null }> = await reader.manager.query(
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
    const rows: Array<{ id: string; name: string | null }> = await reader.manager.query(
      `SELECT id::text AS id, name FROM analytics_axes WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, Array.from(collected.axes)],
    );
    for (const row of rows) if (row.name) dimensions.set(row.id.toLowerCase(), row.name);
  }
  if (collected.categories.size > 0) {
    const rows: Array<{ id: string; name: string | null }> = await reader.manager.query(
      `SELECT id::text AS id, name FROM analytics_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, Array.from(collected.categories)],
    );
    for (const row of rows) if (row.name) categories.set(row.id.toLowerCase(), row.name);
  }

  // A connection's endpoints and a segment's equipment store an entity code; the connection page
  // names it as its IT settings do, never the raw code.
  const entityLabels = new Map<string, string>();
  if (entry.table === 'connections') {
    const rows: Array<{ code: string | null; label: string | null }> = await reader.manager.query(
      `SELECT entity->>'code' AS code, entity->>'label' AS label
         FROM tenants t
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(t.metadata->'it_ops'->'entities') = 'array'
                THEN t.metadata->'it_ops'->'entities' ELSE '[]'::jsonb END
         ) AS entity
        WHERE t.id = $1`,
      [tenantId],
    );
    for (const row of rows) {
      if (row.code && row.label) entityLabels.set(row.code.toLowerCase(), row.label);
    }
  }

  // An assignment names its deployment; the entry is titled by the deployment's environment. Only
  // the record's own deployments are read: they are part of the application the person reads.
  const instances = new Map<string, string | null>();
  if (entry.table === 'applications' && collected.instances.size > 0) {
    const rows: Array<{ id: string; environment: string | null }> = await reader.manager.query(
      `SELECT id::text AS id, environment
         FROM app_instances
        WHERE tenant_id = $1 AND application_id = $2 AND id = ANY($3::uuid[])`,
      [tenantId, id, Array.from(collected.instances)],
    );
    for (const row of rows) instances.set(row.id.toLowerCase(), row.environment ?? null);
  }

  // The scoring of a project or a request: the criteria and options its rows name, as the scoring
  // tab names them. They are the tenant's portfolio settings, read by whoever reads the record.
  const criteria = new Map<string, string>();
  const criterionOptions = new Map<string, string>();
  if (collected.criteria.size > 0 || collected.criterionOptions.size > 0) {
    const criterionRows: Array<{ id: string; name: string | null }> = await reader.manager.query(
      `SELECT id::text AS id, name FROM portfolio_criteria WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, Array.from(collected.criteria)],
    );
    for (const row of criterionRows) if (row.name) criteria.set(row.id.toLowerCase(), row.name);
    const optionRows: Array<{ id: string; label: string | null }> = await reader.manager.query(
      `SELECT id::text AS id, label FROM portfolio_criterion_values WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, Array.from(collected.criterionOptions)],
    );
    for (const row of optionRows) criterionOptions.set(row.id.toLowerCase(), row.label ?? '');
  }

  return {
    entry, recordId: id, users, versions, references, deleted, readable, dimensions, categories, entityLabels, instances,
    criteria, criterionOptions,
  };
}

@Injectable()
export class RecordHistoryService {
  /**
   * `knowledge` reads the families whose screen right is not SQL (a document's library ACL and its
   * incident review). It is optional so a history of another record can be built without it, as
   * the framework's specs do; a document reference then stays hidden and a document history is
   * not found. The route and this service live in `record-history.module.ts`, which imports both
   * modules: importing KnowledgeModule from AuditModule would close a module cycle
   * (`AuditModule → KnowledgeModule → NotificationsModule → AuditModule`).
   */
  constructor(@Optional() private readonly knowledge?: KnowledgeService) {}

  /** The reader of one request: its transaction, tenant and person, and the code checks it can run. */
  private referenceReader(ctx: RecordHistoryContext, manager: EntityManager): ReferenceReader {
    const knowledge = this.knowledge;
    const checks = knowledge
      ? {
        // The code checks capture the request transaction: a record read for one person, in the
        // tenant it names, never a second connection or another person's rights.
        knowledge_document: (ids: readonly string[]) =>
          knowledge.readableDocumentIds(manager, ctx.tenantId, ctx.userId, ids),
        knowledge_folder: (ids: readonly string[]) =>
          knowledge.readableFolderIds(manager, ctx.tenantId, ctx.userId, ids),
        knowledge_library: (ids: readonly string[]) =>
          knowledge.readableLibraryIds(manager, ctx.tenantId, ctx.userId, ids),
      } satisfies Partial<Record<FamilyCodeCheckKey, (ids: readonly string[]) => Promise<ReadonlySet<string>>>>
      : undefined;
    return {
      manager,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      isAdmin: ctx.isAdmin === true,
      viewer: incidentViewerFromContext(ctx),
      checks,
    };
  }

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
    const entry = recordHistoryEntry(String(table ?? ''));
    if (!entry) throw new NotFoundException('Record not found');
    if (!isUuid(id)) throw new NotFoundException('Record not found');
    if (!hasLevel(ctx, entry.module, entry.level)) {
      throw moduleRightRequired(entry.module, entry.level, `You cannot read this record's history.`);
    }
    const manager = ctx.manager;
    if (!manager) throw new Error('RecordHistoryService.list needs the request transaction (ctx.manager).');

    // One spelling of the id for every read: a payload key is compared as text, so an upper-case
    // URL id must not miss the lower-case uuid a writer stored there.
    const recordId = id.toLowerCase();

    // The record is read first, under the person's access and the entry family's own screen rule:
    // a hidden or missing record is not found (404), never served with a partial history.
    const reader = this.referenceReader(ctx, manager);
    if (!(await recordIsVisible(reader, entry.family, recordId))) throw new NotFoundException('Record not found');

    const limit = parseLimit(options.limit);
    const cursor = decodeCursor(options.cursor);
    // A contract read through one of its lines: its documents stay closed, as on its page.
    const closedLabels = entry.table === contractsRecord.table
      ? await contractClosedLabels(manager, ctx.tenantId, recordId)
      : [];
    const rows = await readAuditPage(manager, ctx.tenantId, entry, recordId, cursor, limit + 1, closedLabels);
    const page = rows.slice(0, limit);
    const pageContext = await loadPageContext(ctx, entry, recordId, page, reader);
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
