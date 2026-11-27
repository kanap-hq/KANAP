import { writeCsvHeader, type CsvLanguage } from '../common/csv-sheet';
import { APPLICATION_FIXED_LABELS } from './application-fixed-labels';
import { ApplicationsListService } from './services/applications-list.service';
import { classificationReadState } from './services/application-classification';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { exportCatalogLabelsIn } from '../it-ops-settings/catalog-resolve';
import { lockApplicationNames, lockApplicationRow } from './application-rules';
import { requireImportCatalogs } from '../it-ops-settings/catalog-resolve';
import { noteNameMatch, proposalFor, undoneMatch } from '../common/name-matching';
import type { CsvImportContext, CsvImportRow, CsvSettledRow, ImportLookalikeChoice } from '../common/csv';
import { importCell } from '../common/csv/csv-import-cells';
import {
  ApplicationIndex,
  applicationState,
  decideLookalikes,
  lookalikeEntry,
  lookalikesResult,
  storedApplications,
  type LookalikeDecision,
} from './application-lookalikes';
import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, In } from 'typeorm';
import { Application } from './application.entity';
import { ApplicationOwner } from './application-owner.entity';
import { ApplicationDataResidency } from './application-data-residency.entity';
import { AuditService, type AuditSourceOptions } from '../audit/audit.service';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';
import { loadSlotBodies } from '../knowledge/integrated-document-bodies';
import { prepareRecoveredContent } from '../common/markdown-worker';
import {
  APPLICATION_DESCRIPTION_SLOT,
  keepApplicationSeed,
  sameApplicationDescription,
  withApplicationDescriptions,
  writeApplicationDescription,
} from './application-description';
import {
  CsvExportService,
  CsvImportService,
  CsvCallerAccess,
  CsvImportParams,
  CsvExportResult,
  CsvImportResult,
  CsvFieldInfo,
  CsvResolverService,
  CSV_CONTENT_TYPE,
} from '../common/csv';
import type { ExportFileFormat } from '../common/xlsx';
import { applicationCsvConfig, changedApplicationColumns, csvOwnerKeys, csvResidencyCodes, sameKeys, usersByEmail } from './application-csv.config';
import { inIdOrder } from '../common/pagination';
import { applicationVulnerabilityCounts } from '../vulnerabilities/vulnerability-reach-counts';
import {
  csvConfigForVulnerabilityFeed,
  VULNERABILITY_CSV_PROPERTY,
  vulnerabilityListFields,
} from '../vulnerabilities/vulnerability-list-column';

/**
 * Service for importing and exporting Applications via CSV (V2)
 *
 * Uses the standardized CSV infrastructure with:
 * - Numbered owner columns (business_owner_email_1, _2, ..., it_owner_email_1, ...: four at least)
 * - Proper FK resolution
 * - Two-phase import with validation
 */

type ExportLanguage = 'en' | 'fr' | 'de' | 'es';

/** The screen's names of the fixed values (not tenant catalogs), per export language (`APPLICATION_FIXED_LABELS`). */
export function exportFixedLabelsIn(row: Record<string, any>, language: ExportLanguage): void {
  for (const [field, labels] of Object.entries(APPLICATION_FIXED_LABELS)) {
    const label = labels[String(row[field])]?.[language];
    if (label) row[field] = label;
  }
}

/**
 * What one import learns of the rows that look like an application (lot I3 of 26.11.9): the decisions,
 * the choices followed, and the columns each update changes.
 */
type LookalikeState = {
  decisions: Map<number, LookalikeDecision>;
  followed: ImportLookalikeChoice[];
  fields: Map<number, string[]>;
  /** The applications the load locked as "Update APP-n" targets (`lookalikeTargets`); none on a check. */
  locked?: Set<string>;
};

/** A row the load wrote: the application it saved, and its cells (by column), for its owners and data residency. */
type WrittenRow = { id: string; raw: Record<string, string> };

/** The text of a cell, by the clearing rule: empty for a blank cell and for `-`. */
function cellValue(raw: Record<string, string>, column: string): string {
  const cell = importCell(raw, column);
  return cell.kind === 'value' ? cell.text : '';
}

@Injectable()
export class ApplicationsCsvService {
  constructor(
    @InjectRepository(Application) private readonly apps: Repository<Application>,
    @InjectRepository(ApplicationOwner) private readonly owners: Repository<ApplicationOwner>,
    @InjectRepository(ApplicationDataResidency) private readonly residency: Repository<ApplicationDataResidency>,
    private readonly exportSvc: CsvExportService,
    private readonly importSvc: CsvImportService,
    private readonly resolver: CsvResolverService,
    private readonly audit: AuditService,
    private readonly listService: ApplicationsListService,
    private readonly itOpsSettings: ItOpsSettingsService,
    @Optional() private readonly integratedDocuments?: IntegratedDocumentsService,
  ) {}

  /**
   * Export applications to CSV format (V2).
   */
  async export<F extends ExportFileFormat = 'csv'>(opts: {
    manager: EntityManager;
    tenantId: string;
    /** The screen language: separator, days, decimal mark and yes or no (`csv-sheet`). */
    language: CsvLanguage;
    scope?: 'template' | 'data';
    fields?: string[];
    preset?: string;
    lifecycle?: string;
    criticality?: string;
    status?: string;
    query?: Record<string, unknown>;
    /** `csv` (default) or `xlsx` (data only: a template is CSV). */
    format?: F;
  }): Promise<CsvExportResult<F>> {
    const { manager, tenantId, scope, fields, preset, lifecycle, criticality, status } = opts;

    // For template export, just return headers (all importable fields)
    if (scope === 'template') {
      const headers = this.buildExportHeaders(fields, preset, 'template');
      if (opts.format === 'xlsx') throw new BadRequestException('An import template is a CSV file: format=xlsx is for the data export.');
      return {
        filename: 'application_template.csv',
        contentType: CSV_CONTENT_TYPE,
        content: writeCsvHeader(opts.language, headers),
        rows: 0,
        warnings: [],
      } as unknown as CsvExportResult<F>;
    }

    // Build query for applications with related data
    let queryBuilder = manager
      .getRepository(Application)
      .createQueryBuilder('app')
      .where('app.tenant_id = :tenantId', { tenantId });

    // Apply filters
    if (lifecycle) {
      queryBuilder = queryBuilder.andWhere('app.lifecycle = :lifecycle', { lifecycle });
    }
    if (criticality) {
      queryBuilder = queryBuilder.andWhere('app.criticality = :criticality', { criticality });
    }
    if (status) {
      queryBuilder = queryBuilder.andWhere('app.status = :status', { status });
    }

    const filters = typeof opts.query?.filters === 'string' ? JSON.parse(opts.query.filters) : { ...(opts.query?.filters as any || {}) };
    for (const [field, value] of Object.entries({ lifecycle, criticality, status })) if (value) filters[field] = { filterType: 'set', values: [value] };
    const matching = await this.listService.listIds({ ...opts.query, filters: JSON.stringify(filters), __classificationExport: true }, { manager, tenantId });
    if (!matching.ids.length) queryBuilder.andWhere('FALSE');
    else queryBuilder.andWhere('app.id = ANY(:ids)', { ids: matching.ids });
    // In the list's order (its sort, the id breaking ties), as the screen shows them; each description
    // as its page shows it (its document's text).
    const applications = await withApplicationDescriptions(manager, tenantId, inIdOrder(await queryBuilder.getMany(), matching.ids));
    // Users never see codes: catalog-backed columns are exported as names (import accepts either).
    const settings = await this.itOpsSettings.getSettings(tenantId, { manager });
    for (const app of applications) {
      Object.assign(app, classificationReadState(app));
      exportFixedLabelsIn(app, opts.language);
      exportCatalogLabelsIn(app, {
        category: { list: 'applicationCategories', options: settings.applicationCategories },
        lifecycle: { list: 'lifecycleStates', options: settings.lifecycleStates },
        criticality: { list: 'businessCriticalityLevels', options: settings.businessCriticalityLevels },
        cyber_criticality: { list: 'cyberCriticalityLevels', options: settings.cyberCriticalityLevels },
        recovery_wave: { list: 'recoveryWaves', options: settings.recoveryWaves },
        data_class: { list: 'dataClasses', options: settings.dataClasses },
        access_methods: { list: 'accessMethods', options: settings.accessMethods },
      }, opts.language);
    }

    // Load related data for export
    if (applications.length > 0) {
      const appIds = applications.map((a) => a.id);

      // Load owners with user data
      const ownersWithUsers = await manager.query(`
        SELECT o.application_id, o.user_id, o.owner_type, u.email
        FROM application_owners o
        JOIN users u ON u.id = o.user_id
        WHERE o.tenant_id = $2 AND o.application_id = ANY($1)
        ORDER BY o.created_at ASC
      `, [appIds, tenantId]);

      const ownersByApp = new Map<string, any[]>();
      for (const owner of ownersWithUsers) {
        if (!ownersByApp.has(owner.application_id)) {
          ownersByApp.set(owner.application_id, []);
        }
        ownersByApp.get(owner.application_id)!.push({
          owner_type: owner.owner_type,
          user: { email: owner.email },
        });
      }

      // Load data residency
      const residencyRows = await manager.query(`
        SELECT application_id, country_iso
        FROM application_data_residency
        WHERE tenant_id = $2 AND application_id = ANY($1)
        ORDER BY created_at ASC
      `, [appIds, tenantId]);

      const residencyByApp = new Map<string, any[]>();
      for (const row of residencyRows) {
        if (!residencyByApp.has(row.application_id)) {
          residencyByApp.set(row.application_id, []);
        }
        residencyByApp.get(row.application_id)!.push({ country_iso: row.country_iso });
      }

      // Vulnerabilities to review and severe ones (shared module) of the applications the list
      // reads in the user's scope, empty for an application out of service.
      const vulnerabilityCounts = await applicationVulnerabilityCounts(manager, tenantId, appIds);

      // Attach to applications
      for (const app of applications) {
        (app as any)._owners = ownersByApp.get(app.id) || [];
        (app as any)._dataResidency = residencyByApp.get(app.id) || [];
        (app as any)[VULNERABILITY_CSV_PROPERTY] = vulnerabilityListFields(vulnerabilityCounts.get(app.id));
      }
    }

    // Build CSV content - owner columns are now handled via COMPUTED fields in config
    return this.exportSvc.export(csvConfigForVulnerabilityFeed(applicationCsvConfig), applications, {
      manager,
      tenantId,
      scope,
      fields,
      preset,
      language: opts.language,
      format: opts.format,
    });
  }

  /**
   * Build export headers based on fields/preset/scope.
   */
  private buildExportHeaders(fields?: string[], preset?: string, scope?: 'template' | 'data'): string[] {
    // For template scope, use all importable fields (so users see what they can import)
    if (scope === 'template') {
      const importableFields = applicationCsvConfig.fields.filter((f) => f.importable !== false);
      return importableFields.map((f) => f.csvColumn);
    }

    // For data export, filter by exportable
    let selectedFields = csvConfigForVulnerabilityFeed(applicationCsvConfig).fields.filter((f) => f.exportable !== false);

    if (preset && applicationCsvConfig.exportPresets) {
      const presetConfig = applicationCsvConfig.exportPresets.find((p) => p.name === preset);
      if (presetConfig) {
        const presetSet = new Set(presetConfig.fields);
        selectedFields = selectedFields.filter((f) => presetSet.has(f.csvColumn));
      }
    } else if (fields && fields.length > 0) {
      const fieldSet = new Set(fields);
      selectedFields = selectedFields.filter((f) => fieldSet.has(f.csvColumn));
    }
    // No preset and no explicit fields: return all exportable fields (Full Export)

    return selectedFields.map((f) => f.csvColumn);
  }

  /**
   * Import applications from CSV file (V2).
   */
  async import(
    file: Express.Multer.File,
    params: CsvImportParams,
    opts: {
      manager: EntityManager;
      tenantId: string;
      userId?: string | null;
      /** The source of each record's history row (Kad's card); without it, the person's. */
      audit?: AuditSourceOptions;
      /** The screen language: a missing column is named by its title in this language. */
      language?: CsvLanguage;
      /** The person's rights: a name is found beyond case in the families they read. */
      access?: CsvCallerAccess;
    },
  ): Promise<CsvImportResult> {
    return opts.manager.transaction(async (manager) => {
      // The catalogs against a settings save (`lockClassificationCatalog`): FOR NO KEY UPDATE, so the
      // foreign key checks of the tenant's other tables do not wait for the import.
      await manager.query('SELECT id FROM tenants WHERE id = $1 FOR NO KEY UPDATE', [opts.tenantId]);
      await lockApplicationNames(manager, opts.tenantId);
      const result = await this.importLocked(file, params, { ...opts, manager });
      if (!params.dryRun && !result.ok && result.errors.some((error) => error.row === 0)) throw new BadRequestException(result);
      return result;
    });
  }

  private async importLocked(file: Express.Multer.File, params: CsvImportParams, opts: { manager: EntityManager; tenantId: string; userId?: string | null; language?: CsvLanguage; access?: CsvCallerAccess }): Promise<CsvImportResult> {
    // The tenant row is locked FOR NO KEY UPDATE by import(): the catalogs read here cannot change underneath.
    const itOpsSettings = await this.itOpsSettings.getSettings(opts.tenantId, { manager: opts.manager });
    // The rows the load wrote, with the application each saved: a row the operation skipped (an
    // existing application in "add new only", a new one in "update only"), found unchanged or left out
    // (it looks like an application) keeps the owners and residency of every application.
    const written: WrittenRow[] = [];
    const look: LookalikeState = { decisions: new Map(), followed: [], fields: new Map() };
    // The description of each application a row updates, as its page shows it (`settleDescriptions`).
    const descriptions = new Map<string, string | null>();
    const changesDescription = async (entity: any) => !(await sameApplicationDescription(descriptions.get(String(entity.id)), entity.description));
    const config = {
      ...applicationCsvConfig,
      lockAlso: (rows: Array<{ raw: Record<string, string>; rowNumber: number; found: any | null }>, context: CsvImportContext) =>
        this.lookalikeTargets(rows, context, look),
      settleRows: async (rows: Array<{ raw: Record<string, string>; rowNumber: number; found: any | null }>, context: CsvImportContext) =>
        this.settleDescriptions(await this.settleRows(rows, context, look), context, descriptions),
      afterValidate: async (rows: CsvImportRow[], context: CsvImportContext) => {
        await applicationCsvConfig.afterValidate!(rows, context);
        for (const row of rows) {
          // "Update APP-n": the application keeps its name, the file's name having found it (T-I3j).
          if (look.decisions.get(row.rowNumber)?.action === 'update' && row.existingEntity) row.parsed.name = row.existingEntity.name;
        }
        this.supplierFromEditor(rows, context);
      },
      sameAsStored: async (rows: CsvImportRow[], context: CsvImportContext) => {
        const same = await applicationCsvConfig.sameAsStored!(rows, context);
        const updates = rows.map((row, i) => [row, i] as const).filter(([row]) => look.decisions.get(row.rowNumber)?.action === 'update');
        if (updates.length > 0) {
          const settings = await requireImportCatalogs(context);
          for (const [row, i] of updates) look.fields.set(row.rowNumber, same[i] === true ? [] : changedApplicationColumns(row, settings));
        }
        return same;
      },
      beforeCommit: async (entities: any[], context: CsvImportContext) => {
        await applicationCsvConfig.beforeCommit!(entities, context);
        // An updated application with no document yet, whose description changes: the document of the
        // text it replaces, while the column still holds it (the save writes it next).
        if (!this.integratedDocuments) return;
        for (const entity of entities) {
          if (!entity.id || !descriptions.has(String(entity.id)) || !(await changesDescription(entity))) continue;
          await keepApplicationSeed(this.integratedDocuments, String(entity.id), { manager: context.manager, userId: context.userId, audit: context.audit });
        }
      },
      afterCommit: async (_entities: any[], context: CsvImportContext, rows: Array<{ row: CsvImportRow; entity: any }> = []) => {
        for (const { row, entity } of rows) if (entity?.id) written.push({ id: String(entity.id), raw: row.raw });
        await this.writeDescriptions(rows, context, changesDescription);
      },
    };
    // The names before the load, to find the renamed applications afterwards.
    const namesBefore = params.dryRun ? new Map<string, string>() : new Map<string, string>(
      (await opts.manager.query(`SELECT id::text AS id, name FROM applications WHERE tenant_id = $1`, [opts.tenantId]))
        .map((row: { id: string; name: string }) => [row.id, row.name] as const),
    );
    const result = await this.importSvc.import(config, file, params, { ...opts, itOpsSettings });
    // Given whenever the rows were judged, none listed included: the load sends the choices back (C6).
    if (look.followed.length > 0) {
      const entries = [...look.decisions.values()].sort((a, b) => a.line - b.line).map((decision) => lookalikeEntry(decision, look.fields.get(decision.line)));
      result.lookalikes = lookalikesResult(entries, look.followed);
    }

    // If successful and not dry run, handle owners and data residency
    if (result.ok && !params.dryRun) {
      await this.handleOwnerImport(written, opts);
      await this.handleDataResidencyImport(written, opts);
      await this.syncRenamedDocumentTitles(namesBefore, new Set(written.map((row) => row.id)), opts);
    }

    return result;
  }

  /**
   * The rows that would create an application and look like one the person reads (lot I3 of 26.11.9,
   * T-I3d): left out unless the person chose otherwise (`params.lookalikes`), created anyway, or the
   * update of that application. A row the uniqueness rule finds (by its id or name) stays an update. In
   * "update only" nothing changes; in "add new only" no row may update one. A row whose situation changed
   * since the check it was chosen on is refused, and the import writes nothing (T-I3j, review 3): the
   * application it updates changed (`CSV_LOOKALIKE_CHANGED`, its row, owners or data residency, read once
   * locked) or is gone (`CSV_LOOKALIKE_GONE`), or its name now finds an application and it would write
   * (`CSV_LOOKALIKE_NAME_FOUND`). A load refuses a row the check would have created that looks like an
   * application since (`CSV_LOOKALIKE_NEW`); a check lists it, left out (review 4, C6).
   */
  /** The lookalike decision of each row (none in "update only": no row looks like another there). */
  private async decideLookalikes(
    rows: Array<{ raw: Record<string, string>; rowNumber: number; found: any | null }>,
    context: CsvImportContext,
  ): Promise<ReturnType<typeof decideLookalikes> | null> {
    const { params } = context;
    if (params.operation === 'update_only') return null;
    const index = new ApplicationIndex(await storedApplications(context.manager, context.tenantId));
    return decideLookalikes(rows.map((row) => {
      const name = cellValue(row.raw, 'name');
      const keys = !name ? null : row.found
        ? { name, supplierId: null, editor: null }
        : { name, supplierId: this.rowSupplier(row.raw, context), editor: cellValue(row.raw, 'editor') || null };
      return { line: row.rowNumber, foundId: row.found ? String(row.found.id) : null, keys };
    }), index, params.lookalikes ?? [], { updatable: params.operation !== 'insert_only' });
  }

  /**
   * The applications the rows update as "Update APP-n" (lot I7b of 26.12.1): the load locks them with
   * those its file finds, in one statement in id order (`lockAlso`), before any write, as the change in
   * bulk locks its applications. Locked after those, they could meet it in the other order (40P01).
   */
  private async lookalikeTargets(
    rows: Array<{ raw: Record<string, string>; rowNumber: number; found: any | null }>,
    context: CsvImportContext,
    look: LookalikeState,
  ): Promise<string[]> {
    const decided = await this.decideLookalikes(rows, context);
    const targets = decided ? updateTargets(decided) : [];
    look.locked = new Set(targets);
    return targets;
  }

  private async settleRows(
    rows: Array<{ raw: Record<string, string>; rowNumber: number; found: any | null }>,
    context: CsvImportContext,
    look: LookalikeState,
  ): Promise<CsvSettledRow[]> {
    const { params } = context;
    const decided = await this.decideLookalikes(rows, context);
    if (!decided) return rows.map((row) => ({ entity: row.found }));
    look.decisions = decided.decisions;
    look.followed = decided.followed;
    // The applications updated, locked in id order (as `lockApplicationRow`, the first lock of every
    // writer of their owners), then their state read again: nothing changes them before the commit.
    // The load already holds them, with those the file finds (`lookalikeTargets`): no other order.
    // A target the load did not lock (the application it looked like went, another one looks like
    // its row since): never locked here, out of the id order; its row is refused below.
    const ids = updateTargets(decided).filter((id) => !look.locked || look.locked.has(id));
    const stored: any[] = ids.length === 0 ? [] : await context.manager.query(
      `SELECT * FROM applications WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
      [context.tenantId, ids],
    );
    const states = new Map((ids.length === 0 ? [] : await storedApplications(context.manager, context.tenantId, ids)).map((app) => [app.id, applicationState(app)]));
    return rows.map((row): CsvSettledRow => {
      // A refusal of the whole row: no column to name.
      const refuse = (code: string, message: string, ref?: string): CsvSettledRow => ({
        entity: row.found,
        errors: [{ row: row.rowNumber, message, code, ...(ref !== undefined ? { params: { ref } } : {}) }],
      });
      const holder = decided.nameFound.get(row.rowNumber);
      if (holder) {
        const ref = holder.sequential_id || holder.name;
        return refuse('CSV_LOOKALIKE_NAME_FOUND', `${ref} took this name after the check.`, ref);
      }
      const decision = decided.decisions.get(row.rowNumber);
      if (!decision) return { entity: row.found };
      const ref = decision.app?.sequential_id || decision.app?.name || '';
      if (decision.appeared && !params.dryRun) return refuse('CSV_LOOKALIKE_NEW', `The row looks like ${ref} since the check.`, ref);
      if (decision.gone) return refuse('CSV_LOOKALIKE_GONE', 'The application chosen at the check no longer exists.');
      if (decision.action === 'ignore') {
        return {
          leaveOut: true,
          warnings: decision.claimedBy === undefined ? [] : [{
            row: row.rowNumber,
            message: `Looks like ${ref}, already updated by line ${decision.claimedBy}. Left out.`,
            code: 'CSV_LOOKALIKE_SAME_RECORD',
            params: { ref, other: decision.claimedBy },
          }],
        };
      }
      if (decision.action === 'create') return { entity: null };
      if (look.locked && !look.locked.has(String(decision.id))) return refuse('CSV_LOOKALIKE_NEW', `The row looks like ${ref} since the check.`, ref);
      const entity = stored.find((app) => String(app.id) === decision.id) ?? null;
      if (!entity) return refuse('CSV_LOOKALIKE_GONE', 'The application chosen at the check no longer exists.');
      decision.state = states.get(decision.id) ?? decision.state;
      if (decision.expected !== undefined && decision.expected !== decision.state) {
        return { entity, errors: [{ row: row.rowNumber, message: `${ref} changed since the check.`, code: 'CSV_LOOKALIKE_CHANGED', params: { ref } }] };
      }
      return { entity };
    });
  }

  /**
   * The description of the application a row updates is its document's text, never the column, its
   * seed (decision P14 of 26.12.1): the clearing rule and the unchanged check read the document. An
   * application with no document yet holds it in that seed, read as the Markdown its page makes of it
   * when it opens (`prepareRecoveredContent`), as for a project's purpose (`settleWithSlotBodies`).
   */
  private async settleDescriptions(settled: CsvSettledRow[], context: CsvImportContext, descriptions: Map<string, string | null>): Promise<CsvSettledRow[]> {
    const entityOf = (row: CsvSettledRow) => ('entity' in row ? row.entity : null);
    const ids = settled.flatMap((row) => (entityOf(row) ? [String(entityOf(row).id)] : []));
    const bodies = await loadSlotBodies(context.manager, context.tenantId, 'applications', ids, [APPLICATION_DESCRIPTION_SLOT]);
    return Promise.all(settled.map(async (row) => {
      const entity = entityOf(row);
      if (!entity || !('entity' in row)) return row;
      const id = String(entity.id);
      const description = bodies.get(id)?.get(APPLICATION_DESCRIPTION_SLOT) ?? await prepareRecoveredContent(entity.description);
      descriptions.set(id, description);
      return { ...row, entity: { ...entity, description } };
    }));
  }

  /**
   * The descriptions the load wrote, into each application's document (created with it when the
   * application has none): a new application's when it has one, an updated one's when it changed.
   */
  private async writeDescriptions(
    rows: Array<{ row: CsvImportRow; entity: any }>,
    context: CsvImportContext,
    changesDescription: (entity: any) => Promise<boolean>,
  ): Promise<void> {
    if (!this.integratedDocuments) return;
    const writes: Array<{ id: string; description: string | null }> = [];
    for (const { row, entity } of rows) {
      if (!entity?.id) continue;
      const write = row.isInsert ? !!String(entity.description ?? '').trim() : await changesDescription(entity);
      if (write) writes.push({ id: String(entity.id), description: entity.description ?? null });
    }
    if (writes.length === 0) return;
    // The name and reference the documents' titles carry (a new application's is given on insert).
    const apps: Array<{ id: string; tenant_id: string; name: string; sequential_id: string | null }> = await context.manager.query(
      `SELECT id::text AS id, tenant_id::text AS tenant_id, name, sequential_id FROM applications WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [context.tenantId, writes.map((write) => write.id)],
    );
    const byId = new Map(apps.map((app) => [app.id, app]));
    for (const { id, description } of writes) {
      const app = byId.get(id);
      if (!app) continue;
      await writeApplicationDescription(this.integratedDocuments, app, description, { manager: context.manager, userId: context.userId, audit: context.audit });
    }
  }

  /**
   * The supplier a row names, as the import resolves it (Kad's proposal, the name case aside, then
   * accents aside for a person who reads the suppliers and did not undo it), else, for a blank supplier
   * cell, the one its publisher names (`editorSupplier`); null for none, and for `-`.
   */
  private rowSupplier(raw: Record<string, string>, context: CsvImportContext): string | null {
    const supplier = importCell(raw, 'supplier_name');
    if (supplier.kind === 'clear') return null;
    if (supplier.kind === 'blank') {
      const editor = cellValue(raw, 'editor');
      return editor ? this.editorSupplier(editor, context)?.id ?? null : null;
    }
    const cell = supplier.text;
    const undone = undoneMatch(context.params.unmatched, 'supplier_name', cell);
    const reads = this.resolver.matchesBeyondCase('suppliers', context.access);
    const proposal = undone || !reads ? undefined : proposalFor(context.params.proposals, 'supplier_name', cell);
    if (proposal !== undefined) {
      const target = this.resolver.resolveName('suppliers', proposal, context.resolverCache, { beyondCase: false });
      if (target.kind === 'one') return target.entry.id;
    }
    const found = this.resolver.resolveName('suppliers', cell, context.resolverCache, { beyondCase: !undone && reads });
    return found.kind === 'one' ? found.entry.id : null;
  }

  /**
   * The supplier an application's publisher names (lot I3 of 26.11.9, T-I3k): one supplier of that
   * name, exactly, case or accents aside, for a person who reads the suppliers and did not undo the
   * match (`unmatched`, column `supplier_name`, the publisher's value). Several, or none: none.
   */
  private editorSupplier(editor: string, context: CsvImportContext): { id: string; target: string; ref: string | null } | null {
    if (!this.resolver.matchesBeyondCase('suppliers', context.access)) return null;
    if (undoneMatch(context.params.unmatched, 'supplier_name', editor)) return null;
    const found = this.resolver.resolveName('suppliers', editor, context.resolverCache, { beyondCase: true });
    return found.kind === 'one' ? { id: found.entry.id, target: found.target, ref: found.ref } : null;
  }

  /**
   * A row that gives a publisher and a blank supplier cell (or no supplier column) is linked to the
   * supplier its publisher names (T-I3k), a match listed (`origin: 'editor'`) that the person may undo.
   * A supplier stored on the application the row updates is kept; `-` on the supplier removes it, and
   * the publisher links none.
   */
  private supplierFromEditor(rows: CsvImportRow[], context: CsvImportContext): void {
    for (const row of rows) {
      if (row.errors.length > 0 || importCell(row.raw, 'supplier_name').kind !== 'blank') continue;
      const editor = cellValue(row.raw, 'editor');
      const existing = row.existingEntity;
      if (!editor) continue;
      if (existing?.supplier_id) continue;
      const supplier = this.editorSupplier(editor, context);
      if (!supplier) continue;
      row.parsed.supplier_id = supplier.id;
      if (context.nameMatches) {
        noteNameMatch(context.nameMatches, {
          column: 'supplier_name', name: null, value: editor, target: supplier.target, ref: supplier.ref, origin: 'editor', reason: 'editor', undoable: true,
        }, row.rowNumber);
      }
    }
  }

  /**
   * A renamed application: its description document's title follows (`APP-4 - New name - Overview`),
   * as on a rename from the workspace.
   */
  private async syncRenamedDocumentTitles(namesBefore: Map<string, string>, written: Set<string>, opts: { manager: EntityManager; tenantId: string; userId?: string | null; audit?: AuditSourceOptions }) {
    if (!this.integratedDocuments) return;
    const renamed = [...written].filter((id) => namesBefore.has(id));
    if (renamed.length === 0) return;
    const rows: Array<{ id: string; tenant_id: string; name: string; sequential_id: string | null }> = await opts.manager.query(
      `SELECT id::text AS id, tenant_id::text AS tenant_id, name, sequential_id FROM applications WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [opts.tenantId, renamed],
    );
    for (const row of rows) {
      if (namesBefore.get(row.id) === row.name) continue;
      await this.integratedDocuments.syncTitles('applications', {
        id: row.id,
        tenant_id: row.tenant_id,
        item_number: null,
        name: row.name,
        reference_label: String(row.sequential_id || '').trim() || row.id,
      }, opts.userId ?? null, { manager: opts.manager, audit: opts.audit });
    }
  }

  /**
   * The owners the rows the load wrote name, on the application each row wrote (by its id: a row left
   * out, or that updates APP-n under another name, never reaches another one).
   */
  private async handleOwnerImport(
    written: readonly WrittenRow[],
    opts: { manager: EntityManager; tenantId: string; userId?: string | null; audit?: AuditSourceOptions },
  ) {
    const { manager, tenantId, userId } = opts;
    const rows = written.filter(({ raw }) => Object.keys(raw).some((key) => /^(business|it)_owner_email_/.test(key)));
    if (rows.length === 0) return;
    const userByEmail = await usersByEmail(manager, tenantId);

    for (const { id: appId, raw: row } of rows) {
      // The application, then its owners (`lockApplicationRow`), as every writer of them.
      await lockApplicationRow(manager, tenantId, appId);
      const ownerRepo = manager.getRepository(ApplicationOwner);
      const beforeRows = await ownerRepo.find({ where: { application_id: appId, tenant_id: tenantId } as any });

      // Owners named by the columns (deduped by owner type + user to avoid unique violations); blank
      // cells keep the stored owners of their type, `-` alone empties it.
      const ownerKeys = csvOwnerKeys(row, userByEmail, beforeRows.map((r) => `${r.owner_type}:${r.user_id}`));
      if (sameKeys(beforeRows.map((r) => `${r.owner_type}:${r.user_id}`), ownerKeys)) continue;
      const newOwners = ownerKeys.map((key) => {
        const [owner_type, user_id] = key.split(':') as ['business' | 'it', string];
        return { user_id, owner_type };
      });

      // Clear existing owners
      await manager.query(`DELETE FROM application_owners WHERE application_id = $1 AND tenant_id = $2`, [appId, tenantId]);

      // Insert new owners
      let afterRows: ApplicationOwner[] = [];
      if (newOwners.length > 0) {
        afterRows = await ownerRepo.save(
          newOwners.map((o) => ownerRepo.create({
            application_id: appId,
            user_id: o.user_id,
            owner_type: o.owner_type,
          })),
        );
      }

      const beforeState = beforeRows.map((r) => `${r.owner_type}:${r.user_id}`).sort();
      const afterState = afterRows.map((r) => `${r.owner_type}:${r.user_id}`).sort();
      if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
        await this.audit.log(
          {
            table: 'application_owners',
            recordId: appId,
            action: 'update',
            before: beforeRows.map((r) => ({ user_id: r.user_id, owner_type: r.owner_type })),
            after: afterRows.map((r) => ({ user_id: r.user_id, owner_type: r.owner_type })),
            userId: userId ?? null,
            source: opts.audit?.source,
            sourceRef: opts.audit?.sourceRef ?? null,
          },
          { manager },
        );
      }
    }
  }

  /**
   * The data residency the rows the load wrote give, on the application each row wrote (by its id): a
   * file without the column, or a blank cell, leaves residency alone; `-` clears it; the codes of a
   * filled cell are the whole list.
   */
  private async handleDataResidencyImport(
    written: readonly WrittenRow[],
    opts: { manager: EntityManager; tenantId: string; userId?: string | null; audit?: AuditSourceOptions },
  ) {
    const { manager, tenantId, userId } = opts;

    for (const { id: appId, raw: row } of written) {
      const codes = csvResidencyCodes(row);
      if (!codes) continue;

      const residencyRepo = manager.getRepository(ApplicationDataResidency);
      const beforeRows = await residencyRepo.find({ where: { application_id: appId, tenant_id: tenantId } as any });

      const beforeState = [...new Set(beforeRows.map((row) => row.country_iso.trim().toUpperCase()))].sort();
      const requestedState = [...new Set(codes)].sort();
      if (JSON.stringify(beforeState) === JSON.stringify(requestedState)) continue;

      // Clear existing residency
      await manager.query(`DELETE FROM application_data_residency WHERE application_id = $1 AND tenant_id = $2`, [appId, tenantId]);

      // Insert new residency
      const afterRows = requestedState.length === 0 ? [] : await residencyRepo.save(
        requestedState.map((iso) => residencyRepo.create({
          application_id: appId,
          tenant_id: tenantId,
          country_iso: iso,
        })),
      );

      const afterState = afterRows.map((r) => r.country_iso).sort();
      if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
        await this.audit.log(
          {
            table: 'application_data_residency',
            recordId: appId,
            action: 'update',
            before: beforeRows.map((r) => ({ country_iso: r.country_iso })),
            after: afterRows.map((r) => ({ country_iso: r.country_iso })),
            userId: userId ?? null,
            source: opts.audit?.source,
            sourceRef: opts.audit?.sourceRef ?? null,
          },
          { manager },
        );
      }
    }
  }

  /**
   * Get field metadata and presets for frontend display.
   */
  getFieldInfo(): { fields: CsvFieldInfo[]; presets: Array<{ name: string; label: string; fields: string[] }> } {
    const fields = csvConfigForVulnerabilityFeed(applicationCsvConfig).fields
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

    const presets = (applicationCsvConfig.exportPresets ?? []).map((p) => ({
      name: p.name,
      label: p.label,
      fields: p.fields,
    }));

    return { fields, presets };
  }
}

/** The applications a lookalike decision updates, in id order. */
function updateTargets(decided: ReturnType<typeof decideLookalikes>): string[] {
  return [...new Set([...decided.decisions.values()].filter((decision) => decision.action === 'update').map((decision) => String(decision.id)))].sort();
}
