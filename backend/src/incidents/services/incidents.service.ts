import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Incident, IncidentStatus } from '../incident.entity';
import { IncidentChangedFields } from '../incident-entry.entity';
import { AuditService } from '../../audit/audit.service';
import { ItemNumberService } from '../../common/item-number.service';
import { IntegratedDocumentsService } from '../../knowledge/integrated-documents.service';
import { parsePagination, Sort } from '../../common/pagination';
import { parseCreateIncident, parseListIncidentsQuery, parseUpdateIncident, UpdateIncidentDto } from '../dto';
import { IncidentsBaseService, ServiceOpts, incidentRef, userNameSql } from './incidents-base.service';
import { IncidentViewer, incidentVisibilitySql, isFrozenIncidentStatus } from '../incident-visibility';
import { assertSetFilterModes } from '../../common/ag-grid-filtering';

const DEFAULT_SORT: Sort = { field: 'detected_at', direction: 'DESC' };

/** Forward-only lifecycle. Backward moves go through reopen; cancelled only through cancel. */
const STATUS_RANK: Record<IncidentStatus, number> = { open: 0, in_progress: 1, resolved: 2, closed: 3, cancelled: 4 };

const OWNER_NAME = userNameSql('o');
const REPORTER_NAME = userNameSql('r');

const BASE_FROM = `
  FROM incidents i
  LEFT JOIN users o ON o.id = i.owner_user_id AND o.tenant_id = i.tenant_id
  LEFT JOIN users r ON r.id = i.reporter_user_id AND r.tenant_id = i.tenant_id`;

const COUNT_EXPRESSIONS: Record<string, string> = {
  asset_count: `(SELECT COUNT(*) FROM incident_assets ia WHERE ia.incident_id = i.id AND ia.tenant_id = i.tenant_id)::int`,
  application_count: `(SELECT COUNT(*) FROM incident_applications iap WHERE iap.incident_id = i.id AND iap.tenant_id = i.tenant_id)::int`,
  task_count: `(SELECT COUNT(*) FROM tasks t WHERE t.related_object_type = 'incident' AND t.related_object_id = i.id AND t.tenant_id = i.tenant_id)::int`,
};

const COUNT_COLUMNS = Object.entries(COUNT_EXPRESSIONS).map(([name, sql]) => `${sql} AS ${name}`).join(',\n  ');

const ROW_COLUMNS = `
  i.id, i.item_number, i.title, i.category, i.severity, i.status, i.confidential,
  i.started_at, i.detected_at, i.resolved_at, i.closed_at,
  i.owner_user_id, ${OWNER_NAME} AS owner_name,
  i.reporter_user_id, ${REPORTER_NAME} AS reporter_name,
  ${COUNT_COLUMNS},
  i.created_at, i.updated_at`;

/** Frontend column → SQL expression, for filters and sorting. */
const FIELD_EXPRESSIONS: Record<string, string> = {
  item_number: 'i.item_number',
  title: 'i.title',
  category: 'i.category',
  severity: 'i.severity',
  status: 'i.status',
  started_at: 'i.started_at',
  detected_at: 'i.detected_at',
  resolved_at: 'i.resolved_at',
  closed_at: 'i.closed_at',
  owner_name: OWNER_NAME,
  reporter_name: REPORTER_NAME,
  source_ref: 'i.source_ref',
  personal_data_affected: 'i.personal_data_affected',
  authority_notification_required: 'i.authority_notification_required',
  linked_assets: `(SELECT string_agg(TRIM(CONCAT_WS(' ', NULLIF(a.asset_reference, ''), a.name, NULLIF(a.hostname, ''), NULLIF(a.fqdn, ''))), ', ' ORDER BY a.name)
    FROM incident_assets ia
    JOIN assets a ON a.id = ia.asset_id AND a.tenant_id = ia.tenant_id
    WHERE ia.incident_id = i.id AND ia.tenant_id = i.tenant_id)`,
  linked_applications: `(SELECT string_agg(TRIM(CONCAT_WS(' ', NULLIF(app.sequential_id, ''), app.name)), ', ' ORDER BY app.name)
    FROM incident_applications iap
    JOIN applications app ON app.id = iap.application_id AND app.tenant_id = iap.tenant_id
    WHERE iap.incident_id = i.id AND iap.tenant_id = i.tenant_id)`,
  confidential: 'i.confidential',
  created_at: 'i.created_at',
  updated_at: 'i.updated_at',
  ...COUNT_EXPRESSIONS,
};

const DATE_FIELDS = new Set(['started_at', 'detected_at', 'resolved_at', 'closed_at', 'created_at', 'updated_at']);
const NUMBER_FIELDS = new Set(Object.keys(COUNT_EXPRESSIONS));
const BOOLEAN_FILTER_FIELDS = new Set<string>(['personal_data_affected', 'authority_notification_required', 'confidential']);

const FILTER_VALUE_FIELDS = new Set(['category', 'severity', 'status', 'owner_name', 'reporter_name']);

const NULLABLE_TEXT_FIELDS = [
  'category', 'description', 'source_ref', 'notified_parties',
] as const;
const DATE_INPUT_FIELDS = ['started_at', 'resolved_at', 'closed_at', 'authority_notified_at'] as const;
const USER_FIELDS = ['reporter_user_id', 'owner_user_id'] as const;
const BOOLEAN_FIELDS = ['personal_data_affected', 'authority_notification_required'] as const;

const CONFIDENTIAL_LIFT_MESSAGE = 'Only a register administrator can lift this restriction.';

/** Change note stored on the review version kept by a closure or a cancellation. */
const CLOSURE_CHANGE_NOTES: Record<string, string> = {
  closed: 'Incident closed',
  cancelled: 'Incident cancelled',
};

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function nullableText(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim();
  return text.length === 0 ? null : String(value);
}

function coerceBooleanFilterValue(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true' || lowered === '1') return true;
    if (lowered === 'false' || lowered === '0') return false;
  }
  return null;
}

type IncidentWhere = {
  filters: any;
  q?: string;
  tenantId: string;
  skipField?: string;
  assetId?: string;
  applicationId?: string;
  viewer?: IncidentViewer;
};

/**
 * Incident CRUD, AG-Grid list, ids/filter-values, lifecycle transitions and the closure lock.
 */
@Injectable()
export class IncidentsService extends IncidentsBaseService {
  constructor(
    @InjectRepository(Incident) incidentRepo: Repository<Incident>,
    private readonly audit: AuditService,
    private readonly itemNumbers: ItemNumberService,
    private readonly integratedDocuments: IntegratedDocumentsService,
  ) {
    super(incidentRepo);
  }

  // =========================================================================
  // List
  // =========================================================================

  async list(query: any, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const { asset_id, application_id } = parseListIncidentsQuery(query);
    const { page, limit, skip, sort, q, filters } = parsePagination(query, DEFAULT_SORT);
    const { where, params } = this.buildWhere({
      filters, q, tenantId, assetId: asset_id, applicationId: application_id, viewer: opts?.viewer,
    });

    const countRows: Array<{ count: number }> = await mg.query(`SELECT COUNT(*)::int AS count ${BASE_FROM} WHERE ${where}`, params);
    const total = countRows[0]?.count || 0;

    const items = await mg.query(
      `SELECT ${ROW_COLUMNS} ${BASE_FROM}
       WHERE ${where}
       ORDER BY ${this.orderBy(sort)}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, skip],
    );
    return { items, total, page, limit };
  }

  /**
   * Ordered ids + refs for prev/next navigation, honoring the list's sort, search and filters.
   */
  async listIds(query: any, opts?: ServiceOpts): Promise<{ ids: string[]; refs: string[]; total: number }> {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const { asset_id, application_id } = parseListIncidentsQuery(query);
    const { sort, q, filters } = parsePagination(query, DEFAULT_SORT);
    const { where, params } = this.buildWhere({
      filters, q, tenantId, assetId: asset_id, applicationId: application_id, viewer: opts?.viewer,
    });

    const countRows: Array<{ count: number }> = await mg.query(`SELECT COUNT(*)::int AS count ${BASE_FROM} WHERE ${where}`, params);
    const total = countRows[0]?.count || 0;

    const limit = Math.min(Math.max(Number(query?.limit) || 10000, 1), 10000);
    const rows: Array<{ id: string; item_number: number }> = await mg.query(
      `SELECT i.id, i.item_number ${BASE_FROM}
       WHERE ${where}
       ORDER BY ${this.orderBy(sort)}
       LIMIT $${params.length + 1}`,
      [...params, limit],
    );
    return { ids: rows.map((r) => r.id), refs: rows.map((r) => incidentRef(r.item_number)), total };
  }

  /**
   * Distinct values for checkbox set filters (`fields=a,b`), scoped by the other active filters and the search.
   */
  async listFilterValues(query: any, opts?: ServiceOpts): Promise<Record<string, Array<string | null>>> {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const { asset_id, application_id } = parseListIncidentsQuery(query);
    const { q, filters } = parsePagination(query);

    const fields = String(query.fields || query.field || '')
      .split(',')
      .map((f) => f.trim())
      .filter((f) => FILTER_VALUE_FIELDS.has(f));

    const results: Record<string, Array<string | null>> = {};
    for (const field of fields) {
      const { where, params } = this.buildWhere({
        filters, q, tenantId, skipField: field, assetId: asset_id, applicationId: application_id, viewer: opts?.viewer,
      });
      const rows: Array<{ value: string | null }> = await mg.query(
        `SELECT DISTINCT ${FIELD_EXPRESSIONS[field]} AS value ${BASE_FROM}
         WHERE ${where}
         ORDER BY value ASC NULLS LAST`,
        params,
      );
      results[field] = rows.map((row) => row.value);
    }
    return results;
  }

  private orderBy(sort: Sort): string {
    const expression = FIELD_EXPRESSIONS[sort.field] || FIELD_EXPRESSIONS.detected_at;
    return `${expression} ${sort.direction} NULLS LAST, i.item_number ${sort.direction}`;
  }

  private buildWhere(input: IncidentWhere): { where: string; params: any[] } {
    const params: any[] = [input.tenantId];
    let where = 'i.tenant_id = $1';
    const filters: Record<string, any> = input.filters && typeof input.filters === 'object' ? input.filters : {};
    assertSetFilterModes(filters);

    for (const [field, model] of Object.entries(filters)) {
      if (field === input.skipField) continue;
      const expression = FIELD_EXPRESSIONS[field];
      if (!expression || !model || typeof model !== 'object') continue;

      if (model.filterType === 'set' && Array.isArray(model.values)) {
        if (model.values.length === 0) {
          where += ' AND 1=0';
          continue;
        }
        const hasNull = model.values.some((v: any) => v === null || v === undefined);
        const rawValues = model.values.filter((v: any) => v !== null && v !== undefined);
        const nonNullValues = BOOLEAN_FILTER_FIELDS.has(field)
          ? rawValues.map(coerceBooleanFilterValue).filter((v: boolean | null): v is boolean => v !== null)
          : rawValues;
        const clauses: string[] = [];
        if (nonNullValues.length > 0) {
          const placeholders = nonNullValues.map((value: any) => {
            params.push(value);
            return `$${params.length}`;
          });
          clauses.push(`${expression} IN (${placeholders.join(', ')})`);
        }
        if (hasNull) clauses.push(`${expression} IS NULL`);
        where += clauses.length > 0 ? ` AND (${clauses.join(' OR ')})` : ' AND 1=0';
      } else if (DATE_FIELDS.has(field) && (model.filterType === 'date' || model.filterType === 'text')) {
        where += this.dateClause(model, `${expression}::date`, params);
      } else if (NUMBER_FIELDS.has(field) && (model.filterType === 'number' || model.filterType === 'text')) {
        where += this.numberClause(model, expression, params);
      } else if (model.filterType === 'text' && model.filter) {
        const filterText = String(model.filter);
        const type = model.type || 'contains';
        if (type === 'contains') {
          params.push(`%${filterText}%`);
          where += ` AND ${expression}::text ILIKE $${params.length}`;
        } else if (type === 'equals') {
          params.push(filterText);
          where += ` AND ${expression}::text = $${params.length}`;
        } else if (type === 'startsWith') {
          params.push(`${filterText}%`);
          where += ` AND ${expression}::text ILIKE $${params.length}`;
        } else if (type === 'endsWith') {
          params.push(`%${filterText}`);
          where += ` AND ${expression}::text ILIKE $${params.length}`;
        } else if (type === 'blank') {
          where += ` AND (${expression} IS NULL OR ${expression}::text = '')`;
        } else if (type === 'notBlank') {
          where += ` AND ${expression} IS NOT NULL AND ${expression}::text != ''`;
        }
      }
    }

    if (input.q) {
      params.push(`%${input.q.trim()}%`);
      const idx = params.length;
      where += ` AND (
        i.title ILIKE $${idx}
        OR i.description ILIKE $${idx}
        OR ('INC-' || i.item_number::text) ILIKE $${idx}
        OR EXISTS (
          SELECT 1 FROM incident_assets ia
          JOIN assets a ON a.id = ia.asset_id AND a.tenant_id = ia.tenant_id
          WHERE ia.incident_id = i.id AND ia.tenant_id = i.tenant_id
            AND (
              a.name ILIKE $${idx}
              OR COALESCE(a.asset_reference, '') ILIKE $${idx}
              OR COALESCE(a.hostname, '') ILIKE $${idx}
              OR COALESCE(a.fqdn, '') ILIKE $${idx}
            )
        )
        OR EXISTS (
          SELECT 1 FROM incident_applications iap
          JOIN applications app ON app.id = iap.application_id AND app.tenant_id = iap.tenant_id
          WHERE iap.incident_id = i.id AND iap.tenant_id = i.tenant_id
            AND (
              app.name ILIKE $${idx}
              OR COALESCE(app.sequential_id, '') ILIKE $${idx}
            )
        )
      )`;
    }

    if (input.assetId) {
      params.push(input.assetId);
      where += ` AND EXISTS (
        SELECT 1 FROM incident_assets ia
        WHERE ia.incident_id = i.id AND ia.tenant_id = i.tenant_id AND ia.asset_id = $${params.length}
      )`;
    }
    if (input.applicationId) {
      params.push(input.applicationId);
      where += ` AND EXISTS (
        SELECT 1 FROM incident_applications iap
        WHERE iap.incident_id = i.id AND iap.tenant_id = i.tenant_id AND iap.application_id = $${params.length}
      )`;
    }

    where += incidentVisibilitySql('i', input.viewer, params);

    return { where, params };
  }

  /** AG Grid date filter model → SQL fragment (day granularity). */
  private dateClause(model: any, expression: string, params: any[]): string {
    const type = String(model.type || 'equals');
    const fromRaw = model.dateFrom ?? model.filter ?? model.value;
    const toRaw = model.dateTo ?? model.filterTo ?? model.valueTo;
    if (type === 'blank') return ` AND ${expression} IS NULL`;
    if (type === 'notBlank') return ` AND ${expression} IS NOT NULL`;

    const pushDate = (value: any) => {
      params.push(value);
      return `$${params.length}::date`;
    };
    if (type === 'inRange') {
      if (!fromRaw || !toRaw) return '';
      return ` AND ${expression} BETWEEN ${pushDate(fromRaw)} AND ${pushDate(toRaw)}`;
    }
    if (!fromRaw) return '';
    const operators: Record<string, string> = {
      equals: '=',
      notEqual: '<>',
      lessThan: '<',
      lessThanOrEqual: '<=',
      greaterThan: '>',
      greaterThanOrEqual: '>=',
    };
    const operator = operators[type];
    return operator ? ` AND ${expression} ${operator} ${pushDate(fromRaw)}` : '';
  }

  /** AG Grid number filter model → SQL fragment. */
  private numberClause(model: any, expression: string, params: any[]): string {
    const type = String(model.type || 'equals');
    if (type === 'blank') return ` AND ${expression} IS NULL`;
    if (type === 'notBlank') return ` AND ${expression} IS NOT NULL`;

    const fromRaw = model.filter ?? model.value;
    const toRaw = model.filterTo ?? model.valueTo;
    const from = Number(fromRaw);
    if (type === 'inRange') {
      const to = Number(toRaw);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return '';
      params.push(from);
      const fromIdx = params.length;
      params.push(to);
      return ` AND ${expression} BETWEEN $${fromIdx} AND $${params.length}`;
    }
    if (!Number.isFinite(from)) return '';
    const operators: Record<string, string> = {
      equals: '=',
      notEqual: '<>',
      lessThan: '<',
      lessThanOrEqual: '<=',
      greaterThan: '>',
      greaterThanOrEqual: '>=',
    };
    const operator = operators[type];
    if (!operator) return '';
    params.push(from);
    return ` AND ${expression} ${operator} $${params.length}`;
  }

  // =========================================================================
  // Read
  // =========================================================================

  /**
   * Full incident with owner/reporter names and child counts.
   */
  async get(id: string, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    await this.ensureIncident(id, mg, tenantId, opts?.viewer);

    const [row] = await mg.query(
      `SELECT i.*,
         ${OWNER_NAME} AS owner_name,
         ${REPORTER_NAME} AS reporter_name,
         ${COUNT_COLUMNS},
         (SELECT COUNT(*) FROM incident_entries e WHERE e.incident_id = i.id AND e.tenant_id = i.tenant_id)::int AS entry_count,
         (SELECT COUNT(*) FROM document_incidents di WHERE di.incident_id = i.id AND di.tenant_id = i.tenant_id)::int AS document_count,
         (SELECT COUNT(*) FROM incident_attachments att WHERE att.incident_id = i.id AND att.tenant_id = i.tenant_id AND att.deleted_at IS NULL)::int AS attachment_count
       ${BASE_FROM}
       WHERE i.id = $1 AND i.tenant_id = $2`,
      [id, tenantId],
    );
    const { entry_count, document_count, attachment_count, ...incident } = row;
    return {
      ...incident,
      counts: {
        entries: entry_count,
        assets: incident.asset_count,
        applications: incident.application_count,
        tasks: incident.task_count,
        documents: document_count,
        attachments: attachment_count,
      },
    };
  }

  // =========================================================================
  // Write
  // =========================================================================

  async create(body: unknown, userId: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const dto = parseCreateIncident(body);
    await this.ensureUsers([dto.reporter_user_id, dto.owner_user_id], mg, tenantId);

    const now = new Date();
    const repo = mg.getRepository(Incident);
    const incident = repo.create({
      tenant_id: tenantId,
      item_number: await this.itemNumbers.nextItemNumber('incident', tenantId, mg),
      title: dto.title,
      category: nullableText(dto.category),
      severity: dto.severity,
      status: dto.status ?? 'open',
      started_at: toDate(dto.started_at),
      detected_at: toDate(dto.detected_at) ?? now,
      resolved_at: toDate(dto.resolved_at),
      closed_at: toDate(dto.closed_at),
      reporter_user_id: dto.reporter_user_id === undefined ? userId : dto.reporter_user_id,
      owner_user_id: dto.owner_user_id ?? null,
      description: nullableText(dto.description),
      source_ref: nullableText(dto.source_ref),
      confidential: dto.confidential ?? false,
      personal_data_affected: dto.personal_data_affected ?? false,
      authority_notification_required: dto.authority_notification_required ?? false,
      authority_notified_at: toDate(dto.authority_notified_at),
      notified_parties: nullableText(dto.notified_parties),
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
    });
    this.applyStatusTimestamps(incident, now);
    const saved = await repo.save(incident);

    // Same transaction as the insert: the review document exists before anything can
    // read the incident (planning/incident-review-document.md §3.2).
    await this.integratedDocuments.provisionForIncident(saved.id, userId, { manager: mg });

    // Created directly closed or cancelled (API or CSV): the creation entry is
    // the transition entry, so it carries the review version (§3.3). No
    // explicit row lock: the INSERT above already holds it in this transaction.
    const reviewVersion = isFrozenIncidentStatus(saved.status)
      ? await this.captureReviewVersion(mg, saved.id, saved.status, userId)
      : null;

    await this.addEntry(mg, saved, {
      kind: 'system',
      content: 'Incident logged',
      changed_fields: reviewVersion ? { review_version: reviewVersion } : null,
      occurred_at: now,
      author_id: userId,
    });
    await this.audit.log(
      { table: 'incidents', recordId: saved.id, action: 'create', before: null, after: saved, userId },
      { manager: mg },
    );
    return this.get(saved.id, { manager: mg, tenantId, viewer: { userId, isAdmin: true } });
  }

  /**
   * Field patch (autosave). Status and severity changes are journaled automatically.
   */
  async update(id: string, body: unknown, userId: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const dto = parseUpdateIncident(body);
    // §3.3: lock the row, then re-read rights and status under that lock. This
    // patch can change the status, the confidential flag, the owner or the
    // reporter, all of which have to be serialised with the review mutations.
    const incident = await this.lockVisibleIncident(mg, id, tenantId, opts?.viewer);
    this.assertEditable(incident);

    if (dto.status !== undefined && dto.status !== incident.status && STATUS_RANK[dto.status] < STATUS_RANK[incident.status]) {
      throw new BadRequestException('Status cannot move backwards. Use Reopen instead.');
    }
    await this.ensureUsers([dto.reporter_user_id, dto.owner_user_id], mg, tenantId);

    const before = { ...incident };
    this.applyConfidentialChange(incident, dto.confidential, opts?.viewer);
    this.applyFields(incident, dto);
    const now = new Date();
    incident.updated_by = userId;
    incident.updated_at = now;
    this.applyStatusTimestamps(incident, now);

    // The review document is titled `INC-N - <title> - Incident review`: a rename
    // has to follow. Done before the status is persisted, so that closing and
    // renaming in the same patch still writes the title (the review freezes with
    // the row) and the closure snapshot below captures the new one.
    if (before.title !== incident.title) {
      await this.integratedDocuments.syncTitles(
        'incidents',
        {
          id: incident.id,
          tenant_id: incident.tenant_id,
          item_number: incident.item_number,
          name: incident.title,
        },
        userId,
        { manager: mg },
      );
    }

    // Closing or cancelling through the patch freezes the review: snapshot it
    // before the status flips, in this same transaction (§3.3).
    const reviewVersion = isFrozenIncidentStatus(incident.status) && !isFrozenIncidentStatus(before.status)
      ? await this.captureReviewVersion(mg, incident.id, incident.status, userId)
      : null;

    const saved = await mg.getRepository(Incident).save(incident);

    if (before.status !== saved.status) {
      const changed: IncidentChangedFields = { status: { from: before.status, to: saved.status } };
      if (reviewVersion) changed.review_version = reviewVersion;
      await this.addEntry(mg, saved, {
        kind: 'status_change',
        changed_fields: changed,
        occurred_at: now,
        author_id: userId,
      });
    }
    if (before.severity !== saved.severity) {
      await this.addEntry(mg, saved, {
        kind: 'severity_change',
        changed_fields: { severity: { from: before.severity, to: saved.severity } },
        occurred_at: now,
        author_id: userId,
      });
    }
    if (before.confidential !== saved.confidential) {
      await this.addEntry(mg, saved, {
        kind: 'system',
        changed_fields: { confidential: { from: before.confidential, to: saved.confidential } },
        occurred_at: now,
        author_id: userId,
      });
      await this.refreshLinkedTaskSearchIndex(mg, tenantId, saved.id);
    }
    await this.audit.log(
      { table: 'incidents', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: mg },
    );
    return this.get(saved.id, { manager: mg, tenantId, viewer: { userId, isAdmin: true } });
  }

  /**
   * Admin: back to in_progress from resolved/closed/cancelled, with a mandatory reason.
   */
  async reopen(id: string, reason: string, userId: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    // Status transition: same lock ordering as the other paths (§3.3). Reopening
    // keeps every stored review version and its journal reference untouched.
    const incident = await this.lockVisibleIncident(mg, id, tenantId, opts?.viewer);
    if (incident.status === 'open' || incident.status === 'in_progress') {
      throw new BadRequestException('Only resolved, closed or cancelled incidents can be reopened.');
    }

    const before = { ...incident };
    const now = new Date();
    incident.status = 'in_progress';
    incident.resolved_at = null;
    incident.closed_at = null;
    incident.updated_by = userId;
    incident.updated_at = now;
    const saved = await mg.getRepository(Incident).save(incident);

    const changed: IncidentChangedFields = { status: { from: before.status, to: saved.status } };
    await this.addEntry(mg, saved, { kind: 'reopen', content: reason, changed_fields: changed, occurred_at: now, author_id: userId });
    await this.audit.log(
      { table: 'incidents', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: mg },
    );
    return this.get(saved.id, { manager: mg, tenantId, viewer: opts?.viewer ?? { userId, isAdmin: true } });
  }

  /**
   * Admin: cancel from any editable status. Keeps the INC-N numbering continuous.
   */
  async cancel(id: string, reason: string, userId: string | null, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    const incident = await this.lockVisibleIncident(mg, id, tenantId, opts?.viewer);
    this.assertEditable(incident);

    const before = { ...incident };
    const now = new Date();
    incident.status = 'cancelled';
    incident.updated_by = userId;
    incident.updated_at = now;

    // Freeze the review with the cancellation, in the same transaction (§3.3).
    const reviewVersion = await this.captureReviewVersion(mg, incident.id, 'cancelled', userId);

    const saved = await mg.getRepository(Incident).save(incident);

    const changed: IncidentChangedFields = {
      status: { from: before.status, to: saved.status },
      review_version: reviewVersion,
    };
    await this.addEntry(mg, saved, { kind: 'status_change', content: reason, changed_fields: changed, occurred_at: now, author_id: userId });
    await this.audit.log(
      { table: 'incidents', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: mg },
    );
    return this.get(saved.id, { manager: mg, tenantId, viewer: opts?.viewer ?? { userId, isAdmin: true } });
  }

  /**
   * Admin: set or clear the confidential flag, including on a closed record.
   */
  async setConfidentiality(
    id: string,
    confidential: boolean,
    userId: string | null,
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const tenantId = this.ensureTenantId(opts?.tenantId);
    // A confidentiality change can revoke access to the review: serialise it
    // with the review mutations under the incident row lock (§3.3).
    const incident = await this.lockVisibleIncident(mg, id, tenantId, opts?.viewer);
    if (incident.confidential === confidential) {
      return this.get(incident.id, { manager: mg, tenantId, viewer: opts?.viewer ?? { userId, isAdmin: true } });
    }
    if (incident.confidential && !confidential && !opts?.viewer?.isAdmin) {
      throw new ForbiddenException(CONFIDENTIAL_LIFT_MESSAGE);
    }

    const before = { ...incident };
    const now = new Date();
    incident.confidential = confidential;
    incident.updated_by = userId;
    incident.updated_at = now;
    const saved = await mg.getRepository(Incident).save(incident);

    await this.addEntry(mg, saved, {
      kind: 'system',
      changed_fields: { confidential: { from: before.confidential, to: saved.confidential } },
      occurred_at: now,
      author_id: userId,
    });
    await this.audit.log(
      { table: 'incidents', recordId: saved.id, action: 'update', before, after: saved, userId },
      { manager: mg },
    );
    await this.refreshLinkedTaskSearchIndex(mg, tenantId, saved.id);
    return this.get(saved.id, { manager: mg, tenantId, viewer: opts?.viewer ?? { userId, isAdmin: true } });
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * §3.3 serialisation: the incident row lock is taken **first**, before the
   * document lock the review snapshot takes. Every path that mutates the
   * status, the confidential flag, the owner or the reporter goes through it,
   * and re-reads the row (rights, status) under the lock afterwards.
   */
  private async lockIncidentRow(manager: EntityManager, id: string, tenantId: string): Promise<void> {
    await manager.query(
      'SELECT id FROM incidents WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [id, tenantId],
    );
  }

  /**
   * Visibility first, then the §3.3 row lock, then the authoritative re-read.
   *
   * The first read takes no lock: a caller who may not see the incident (wrong
   * tenant, confidential record) is refused without ever queueing behind another
   * transaction's `FOR UPDATE`. The row returned to the caller is always the
   * second one, read under the lock, so rights and status are the committed
   * ones and nothing can change between the check and the write.
   */
  private async lockVisibleIncident(
    manager: EntityManager,
    id: string,
    tenantId: string,
    viewer?: IncidentViewer,
  ): Promise<Incident> {
    await this.ensureIncident(id, manager, tenantId, viewer);
    await this.lockIncidentRow(manager, id, tenantId);
    return this.ensureIncident(id, manager, tenantId, viewer);
  }

  /**
   * Freeze the current review as a version, in the same transaction as the
   * status change and its journal entry, and return the reference to store in
   * `incident_entries.changed_fields.review_version`. Built server-side only.
   *
   * Refuses with 423 when another user holds an edit lock on the review; the
   * register admin can clear it through the force-release route.
   */
  private async captureReviewVersion(
    manager: EntityManager,
    incidentId: string,
    status: IncidentStatus,
    userId: string | null,
  ): Promise<{ from: null; to: { document_id: string; version_number: number; revision: number } }> {
    const snapshot = await this.integratedDocuments.snapshotReviewForIncidentTransition(
      incidentId,
      userId,
      { manager, changeNote: CLOSURE_CHANGE_NOTES[status] ?? 'Incident closed' },
    );
    return { from: null, to: snapshot };
  }

  private applyConfidentialChange(
    incident: Incident,
    next: boolean | undefined,
    viewer?: IncidentViewer,
  ): void {
    if (next === undefined || next === incident.confidential) return;
    if (incident.confidential && !next && !viewer?.isAdmin) {
      throw new ForbiddenException(CONFIDENTIAL_LIFT_MESSAGE);
    }
    incident.confidential = next;
  }

  private applyFields(incident: Incident, dto: UpdateIncidentDto): void {
    if (dto.title !== undefined) incident.title = dto.title;
    if (dto.severity !== undefined) incident.severity = dto.severity;
    if (dto.status !== undefined) incident.status = dto.status;
    if (dto.detected_at !== undefined) incident.detected_at = new Date(dto.detected_at);
    for (const field of NULLABLE_TEXT_FIELDS) {
      if (dto[field] !== undefined) incident[field] = nullableText(dto[field]);
    }
    for (const field of DATE_INPUT_FIELDS) {
      if (dto[field] !== undefined) incident[field] = toDate(dto[field]);
    }
    for (const field of USER_FIELDS) {
      if (dto[field] !== undefined) incident[field] = dto[field] ?? null;
    }
    for (const field of BOOLEAN_FIELDS) {
      if (dto[field] !== undefined) incident[field] = dto[field] as boolean;
    }
  }

  /** Resolving stamps resolved_at, closing stamps closed_at (and resolved_at) when still empty. */
  private applyStatusTimestamps(incident: Incident, now: Date): void {
    if ((incident.status === 'resolved' || incident.status === 'closed') && !incident.resolved_at) {
      incident.resolved_at = now;
    }
    if (incident.status === 'closed' && !incident.closed_at) {
      incident.closed_at = now;
    }
  }

  private async refreshLinkedTaskSearchIndex(
    manager: EntityManager,
    tenantId: string,
    incidentId: string,
  ): Promise<void> {
    await manager.query(
      `SELECT search_index_refresh_tasks(
         $1,
         ARRAY(SELECT id FROM tasks WHERE tenant_id = $1 AND related_object_type = 'incident' AND related_object_id = $2)
       )`,
      [tenantId, incidentId],
    );
  }

  private async ensureUsers(ids: Array<string | null | undefined>, manager: EntityManager, tenantId: string): Promise<void> {
    const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
    if (wanted.length === 0) return;
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
      [wanted, tenantId],
    );
    if (rows.length !== wanted.length) throw new BadRequestException('One or more users not found');
  }
}
