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
  type FamilyCodeCheckKey,
  type FamilyKey,
  type ReferenceReader,
  type ReferenceRow,
} from './record-history/families';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { HISTORY_FIELDS, historyFields } from './record-history/fields';
import type { HistoryFieldRule, HistoryFields } from './record-history/field-rules';
import { auditPageQuery, type AuditCursor } from './record-history/query';
import {
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
): Promise<AuditRow[]> {
  const query = auditPageQuery(entry, tenantId, id, cursor, fetch);
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
        if (isPlainObject(payload)) addFamilyId({ ids }, kind, payload[`${kind}_id`]);
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
  const references = await loadReferences(reader, collected.ids, readable);
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

  return { entry, recordId: id, users, versions, references, readable, dimensions, categories };
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

    // The record is read first, under the person's access and the entry family's own screen rule:
    // a hidden or missing record is not found (404), never served with a partial history.
    const reader = this.referenceReader(ctx, manager);
    if (!(await recordIsVisible(reader, entry.family, id))) throw new NotFoundException('Record not found');

    const limit = parseLimit(options.limit);
    const cursor = decodeCursor(options.cursor);
    const rows = await readAuditPage(manager, ctx.tenantId, entry, id, cursor, limit + 1);
    const page = rows.slice(0, limit);
    const pageContext = await loadPageContext(ctx, entry, id, page, reader);
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
