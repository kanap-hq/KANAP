import type { CsvLanguage } from '../common/csv-sheet';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { exportCatalogLabelsIn } from '../it-ops-settings/catalog-resolve';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import {
  CsvEntityConfig,
  CsvExportResult,
  CsvExportService,
  CsvFieldInfo,
  CsvImportContext,
  CsvImportParams,
  CsvImportResult,
  CsvImportService,
} from '../common/csv';
import type { ExportFileFormat } from '../common/xlsx';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';
import { INCIDENT_REVIEW_SLOT } from '../knowledge/integrated-document.constants';
import {
  IMPORT_ENTRY_CONTENT,
  hasPendingIncidentReview,
  incidentCsvConfig,
  takePendingIncidentReview,
  takePreviousIncidentStatus,
  wasInsertedByImport,
} from './incident-csv.config';
import { isReservedIncidentStatusMove } from './incident.entity';
import { IncidentEntryKind } from './incident-entry.entity';
import { INCIDENT_FROZEN_STATUSES, IncidentViewer } from './incident-visibility';
import { INCIDENT_LIST_FROM, IncidentsService } from './services/incidents.service';

/** Timestamps are read as UTC ISO; the config writes them in the exporting user's zone. */
const isoUtc = (column: string) => `to_char(i.${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ${column}`;

const EXPORT_COLUMNS = `
  i.id::text AS id,
  'INC-' || i.item_number::text AS item_number,
  i.title, i.category, i.severity, i.status,
  ${isoUtc('started_at')}, ${isoUtc('detected_at')}, ${isoUtc('resolved_at')}, ${isoUtc('closed_at')},
  i.reporter_user_id, i.owner_user_id,
  i.description,
  i.source_ref,
  i.confidential,
  i.personal_data_affected, i.authority_notification_required,
  ${isoUtc('authority_notified_at')}, i.notified_parties`;

const REVIEW_COLUMN = 'review';

/**
 * Savepoint names are not scoped to a nesting level: a fixed name would be
 * silently reused by a nested import on the same connection, and the inner
 * `RELEASE` would drop the outer one. One fresh name per import instead.
 */
function newSavepointName(): string {
  return `incident_csv_import_${randomUUID().replace(/-/g, '')}`;
}

const IMPORT_REVIEW_CHANGE_NOTE = IMPORT_ENTRY_CONTENT;
const IMPORT_REVIEW_ENTRY_CONTENT = 'Incident review imported from CSV';
const CLOSURE_CHANGE_NOTES: Record<string, string> = {
  closed: 'Incident closed',
  cancelled: 'Incident cancelled',
};

/**
 * CSV import/export for the incident register.
 *
 * Export follows the list when it is given the list's query (filters, search,
 * sort): the same `buildWhere` and visibility predicate, so the file holds what
 * the list shows and nothing it hides. Import upserts on the reference (see
 * incident-csv.config.ts).
 *
 * The `review` column is virtual: it lives in the `incidents:review` integrated
 * document. Export hydrates it in one batched query under the visibility SQL
 * already applied to the rows; import writes it through the dedicated
 * `writeIncidentReviewForImport` primitive, inside the very transaction that
 * commits the upsert (planning/incident-review-document.md §3.8).
 */
@Injectable()
export class IncidentsCsvService {
  constructor(
    private readonly exportSvc: CsvExportService,
    private readonly importSvc: CsvImportService,
    private readonly integratedDocs: IntegratedDocumentsService,
    private readonly itOpsSettings: ItOpsSettingsService,
    private readonly incidents: IncidentsService,
  ) {}

  async export<F extends ExportFileFormat = 'csv'>(opts: {
    manager: EntityManager;
    tenantId: string;
    /** The screen language: separator, days, decimal mark and yes or no (`csv-sheet`). */
    language: CsvLanguage;
    /** The zone the date-times are written in and their headers name (`timeZoneOf`). UTC when not given. */
    timeZone?: string;
    viewer?: IncidentViewer;
    /** The reader's infrastructure and applications reads: the list's search follows them. */
    technologies?: boolean;
    applications?: boolean;
    /** A Business Contributor's applications, for the application filter and its values. */
    applicationScope?: { userId: string };
    scope?: 'template' | 'data';
    fields?: string[];
    /**
     * The list's query (`filters`, `q`, `sort`, `asset_id`, `application_id`): the file then holds
     * what the list shows, through the list's own WHERE builder and visibility predicate. Absent,
     * the whole register the viewer may see.
     */
    query?: Record<string, unknown>;
    /** `csv` (default) or `xlsx` (data only: a template is CSV). */
    format?: F;
  }): Promise<CsvExportResult<F>> {
    const { manager, tenantId, viewer, scope, fields } = opts;
    let rows: Array<Record<string, any>> = [];
    if (scope !== 'template') {
      const listQuery = await this.incidents.exportQuery(opts.query ?? {}, {
        manager, tenantId, viewer, technologies: opts.technologies, applications: opts.applications,
        applicationScope: opts.applicationScope,
      });
      rows = await manager.query(
        `SELECT ${EXPORT_COLUMNS} ${INCIDENT_LIST_FROM} WHERE ${listQuery.where} ORDER BY ${listQuery.orderBy}`,
        listQuery.params,
      );
    }

    if (rows.length > 0 && (!fields || fields.includes(REVIEW_COLUMN))) {
      await this.hydrateReviews(rows, manager, tenantId);
    }
    if (rows.length > 0) {
      // The name the screen shows in the file's language. A name the tenant typed stays as stored.
      // The import accepts a shipped label in any language, so the file round-trips.
      const settings = await this.itOpsSettings.getSettings(tenantId, { manager });
      for (const row of rows) {
        exportCatalogLabelsIn(row, {
          category: { list: 'incidentCategories', options: settings.incidentCategories },
        }, opts.language);
      }
    }

    return this.exportSvc.export(incidentCsvConfig, rows, {
      manager, tenantId, scope, fields, language: opts.language, timeZone: opts.timeZone, format: opts.format,
    });
  }

  /**
   * One batched `= ANY($ids)` lookup of the bound review documents. The rows
   * were already filtered by `incidentVisibilitySql`, so no invisible review
   * can be reached through this join.
   */
  private async hydrateReviews(
    rows: Array<Record<string, any>>,
    manager: EntityManager,
    tenantId: string,
  ): Promise<void> {
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (ids.length === 0) return;

    const bodies: Array<{ source_entity_id: string; content_markdown: string | null }> = await manager.query(
      `SELECT b.source_entity_id::text AS source_entity_id, d.content_markdown
       FROM integrated_document_bindings b
       JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1
         AND b.source_entity_type = '${INCIDENT_REVIEW_SLOT.sourceEntityType}'
         AND b.source_entity_id = ANY($2::uuid[])
         AND b.slot_key = '${INCIDENT_REVIEW_SLOT.slotKey}'`,
      [tenantId, ids],
    );

    const byIncidentId = new Map(bodies.map((row) => [row.source_entity_id, row.content_markdown ?? '']));
    for (const row of rows) {
      row[REVIEW_COLUMN] = byIncidentId.get(String(row.id)) ?? '';
    }
  }

  /**
   * The base config plus the review write, both hooks running inside the
   * transaction that saves the incidents (see the savepoint in `import`).
   *
   * `beforeCommit` writes the review of **existing** rows: the base hook has
   * just taken their row lock and validated visibility and the confidentiality
   * transition on that locked initial state, and the row itself is not written
   * yet — so a line that also changes the owner, the reporter or the
   * confidential flag is authorised on its pre-image, never on the state it is
   * about to produce (§3.8).
   *
   * `afterCommit` handles inserted rows (their id only exists then) and the
   * closure snapshot, which must come **after** the review write.
   */
  private buildCsvConfig(): CsvEntityConfig {
    const base = incidentCsvConfig;
    return {
      ...base,
      beforeCommit: async (entities: any[], context: CsvImportContext) => {
        await base.beforeCommit?.(entities, context);
        for (const entity of entities) {
          if (!entity?.id) continue;
          await this.writeReviewForRow(entity, context);
        }
      },
      afterCommit: async (entities: any[], context: CsvImportContext) => {
        for (const entity of entities) {
          if (!entity?.id) continue;
          await this.writeReviewForRow(entity, context);
          await this.snapshotClosureForRow(entity, context);
          await this.syncReviewTitleForRow(entity, context);
        }
        await base.afterCommit?.(entities, context);
      },
    };
  }

  /**
   * Writes one row's `review` cell, once (the pending value is consumed).
   * A blank or missing cell leaves the review untouched, in both enrich and
   * replace mode.
   */
  private async writeReviewForRow(entity: any, context: CsvImportContext): Promise<void> {
    if (!hasPendingIncidentReview(entity)) return;
    const review = takePendingIncidentReview(entity);
    if (review == null || review.trim() === '') return;

    const manager: EntityManager = context.manager;
    // Enforces the tenant, incidents:contributor, the incident's row visibility
    // (404) and another user's edit lock (423). It is the only path allowed to
    // write the review of a closed or cancelled incident, and it provisions the
    // binding when it is missing (an imported row may arrive already closed).
    const written = await this.integratedDocs.writeIncidentReviewForImport(
      entity.id,
      review,
      context.userId ?? null,
      { manager, changeNote: IMPORT_REVIEW_CHANGE_NOTE, activityContent: IMPORT_REVIEW_CHANGE_NOTE },
    );
    if (!written.changed) return;

    await this.addSystemEntry(manager, context, entity.id, IMPORT_REVIEW_ENTRY_CONTENT, {
      review_version: {
        from: null,
        to: {
          document_id: written.document_id,
          version_number: written.version_number,
          revision: written.revision,
        },
      },
    });
  }

  /**
   * The review is titled `INC-N - <title> - Incident review`, so an imported
   * rename has to follow. Runs with the import exemption: a CSV line may rename
   * a closed incident, exactly as it may rewrite its review (§3.8). A no-op when
   * the title already matches, which covers every row the import did not rename.
   */
  private async syncReviewTitleForRow(entity: any, context: CsvImportContext): Promise<void> {
    await this.integratedDocs.syncTitles(
      INCIDENT_REVIEW_SLOT.sourceEntityType,
      {
        id: entity.id,
        tenant_id: context.tenantId,
        item_number: entity.item_number ?? null,
        name: String(entity.title ?? ''),
      },
      context.userId ?? null,
      { manager: context.manager, allowFrozenIncident: true },
    );
  }

  private async snapshotClosureForRow(entity: any, context: CsvImportContext): Promise<void> {
    const manager: EntityManager = context.manager;
    const previousStatus = takePreviousIncidentStatus(entity);
    const isInsert = wasInsertedByImport(entity);

    if (isInsert) {
      // An inserted row never went through IncidentsService.create, so the
      // review document is provisioned here, from the template (§3.2).
      // Idempotent: a no-op when `writeReviewForRow` already created it.
      await this.integratedDocs.provisionForIncident(entity.id, context.userId ?? null, { manager });
    }

    const nextStatus = String(entity.status ?? '');
    const previous = previousStatus == null ? null : String(previousStatus);
    if (!nextStatus || nextStatus === previous) return;

    // A move Reopen or Cancel owns: an administrator's import journals it with
    // the import reason. A cancellation also freezes the review, as Cancel does;
    // a backwards move keeps the review as Reopen does.
    if (previous != null && isReservedIncidentStatusMove(nextStatus, previous)) {
      const snapshot = nextStatus === 'cancelled'
        ? await this.snapshotReviewForStatus(entity, context, CLOSURE_CHANGE_NOTES.cancelled)
        : null;
      const changed: Record<string, { from: unknown; to: unknown }> = {
        status: { from: previous, to: nextStatus },
      };
      if (snapshot) changed.review_version = { from: null, to: snapshot };
      await this.addSystemEntry(
        manager,
        context,
        entity.id,
        IMPORT_ENTRY_CONTENT,
        changed,
        nextStatus === 'cancelled' ? 'status_change' : 'reopen',
      );
      return;
    }

    if (
      !INCIDENT_FROZEN_STATUSES.has(nextStatus)
      || INCIDENT_FROZEN_STATUSES.has(previous ?? '')
    ) return;

    const snapshot = await this.snapshotReviewForStatus(
      entity,
      context,
      CLOSURE_CHANGE_NOTES[nextStatus] ?? 'Incident closed',
    );
    await this.addSystemEntry(manager, context, entity.id, null, {
      status: { from: previous, to: nextStatus },
      review_version: { from: null, to: snapshot },
    });
  }

  /** Locks the incident row (§3.3), freezes the review, returns the version reference. */
  private async snapshotReviewForStatus(entity: any, context: CsvImportContext, changeNote: string) {
    await context.manager.query(
      'SELECT id FROM incidents WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [entity.id, context.tenantId],
    );
    return this.integratedDocs.snapshotReviewForIncidentTransition(entity.id, context.userId ?? null, {
      manager: context.manager,
      changeNote,
    });
  }

  private async addSystemEntry(
    manager: EntityManager,
    context: CsvImportContext,
    incidentId: string,
    content: string | null,
    changedFields: Record<string, { from: unknown; to: unknown }>,
    kind: IncidentEntryKind = 'system',
  ): Promise<void> {
    await manager.query(
      `INSERT INTO incident_entries (tenant_id, incident_id, kind, content, changed_fields, author_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [context.tenantId, incidentId, kind, content, JSON.stringify(changedFields), context.userId ?? null],
    );
  }

  async import(
    file: Express.Multer.File,
    params: CsvImportParams,
    opts: {
      manager: EntityManager;
      tenantId: string;
      userId?: string | null;
      isAdmin?: boolean;
      viewer?: IncidentViewer;
    },
  ): Promise<CsvImportResult> {
    // The import service turns a commit failure into `ok: false` instead of
    // rethrowing, which would leave the request transaction committing a
    // partial import. A savepoint makes the upsert and the review writes one
    // unit: either both land, or neither does (§3.8).
    const runner = opts.manager.queryRunner;
    if (!runner?.isTransactionActive) {
      // Without a transaction there is no savepoint to roll back to, so a failed
      // commit would leave the incidents written and their reviews not (or the
      // other way round). Refuse rather than import atomically-in-name-only.
      throw new InternalServerErrorException(
        'Incident CSV import requires a transactional request context.',
      );
    }

    const savepoint = newSavepointName();
    await opts.manager.query(`SAVEPOINT ${savepoint}`);
    let result: CsvImportResult;
    try {
      const itOpsSettings = await this.itOpsSettings.getSettingsForWrite(opts.tenantId, opts.manager);
      result = await this.importSvc.import(this.buildCsvConfig(), file, params, { ...opts, itOpsSettings });
    } catch (error) {
      await opts.manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await opts.manager.query(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
    if (!result.ok && !result.dryRun) {
      await opts.manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    }
    await opts.manager.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  }

  /**
   * Field metadata for the export/import dialogs.
   */
  getFieldInfo(): { fields: CsvFieldInfo[]; presets: Array<{ name: string; label: string; fields: string[] }> } {
    const fields = incidentCsvConfig.fields
      .filter((f) => f.exportable !== false || f.importable !== false)
      .map((f) => ({
        csvColumn: f.csvColumn,
        label: f.label ?? f.csvColumn,
        type: f.type,
        exportable: f.exportable !== false,
        importable: f.importable !== false,
        required: f.required ?? false,
        group: f.group,
        enumValues: f.enumValues,
      }));

    return { fields, presets: [] };
  }
}
