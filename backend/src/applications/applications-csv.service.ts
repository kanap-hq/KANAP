import { writeCsvHeader, type CsvLanguage } from '../common/csv-sheet';
import { ApplicationsListService } from './services/applications-list.service';
import { classificationReadState } from './services/application-classification';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { exportCatalogLabelsIn } from '../it-ops-settings/catalog-resolve';
import { applicationNameKey, lockApplicationNames, lockApplicationRow } from './application-rules';
import { requireImportCatalogs } from '../it-ops-settings/catalog-resolve';
import { noteNameMatch, proposalFor, undoneMatch } from '../common/name-matching';
import type { CsvImportContext, CsvImportRow, CsvSettledRow, ImportLookalikeChoice } from '../common/csv';
import {
  ApplicationIndex,
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
import { AuditService } from '../audit/audit.service';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';
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
  csvColumnOfHeader,
} from '../common/csv';
import type { ExportFileFormat } from '../common/xlsx';
import { applicationCsvConfig, changedApplicationColumns, csvOwnerKeys, sameKeys, usersByEmail } from './application-csv.config';
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
 * - Numbered owner columns (business_owner_email_1..4, it_owner_email_1..4)
 * - Proper FK resolution
 * - Two-phase import with validation
 */

type ExportLanguage = 'en' | 'fr' | 'de' | 'es';

/** The screen's names of the fixed values (not tenant catalogs), per export language. Both columns are export-only. */
const FIXED_EXPORT_LABELS: Record<string, Record<string, Record<ExportLanguage, string>>> = {
  classification_review_state: {
    incomplete: { en: 'To complete', fr: 'À compléter', de: 'Zu vervollständigen', es: 'Por completar' },
    stale: { en: 'Review needed', fr: 'À revoir', de: 'Erneut prüfen', es: 'Por revisar' },
    reviewed: { en: 'Reviewed', fr: 'Revu', de: 'Geprüft', es: 'Revisado' },
  },
  users_mode: {
    manual: { en: 'Manual', fr: 'Manuel', de: 'Manuell', es: 'Manual' },
    // The screen offers "Derived" and "Manual" only; both derived modes read as "Derived".
    it_users: { en: 'Derived', fr: 'Dérivé', de: 'Abgeleitet', es: 'Derivado' },
    headcount: { en: 'Derived', fr: 'Dérivé', de: 'Abgeleitet', es: 'Derivado' },
  },
};

export function exportFixedLabelsIn(row: Record<string, any>, language: ExportLanguage): void {
  for (const [field, labels] of Object.entries(FIXED_EXPORT_LABELS)) {
    const label = labels[String(row[field])]?.[language];
    if (label) row[field] = label;
  }
}

/**
 * What one import learns of the rows that look like an application (lot I3 of 26.11.9): the decisions,
 * the choices followed, the columns each update changes, and the application each update writes, by
 * the name key of its row (the owners and the data residency find it there, the row's name being
 * another one).
 */
type LookalikeState = {
  decisions: Map<number, LookalikeDecision>;
  followed: ImportLookalikeChoice[];
  fields: Map<number, string[]>;
  updatedByName: Map<string, string>;
};

/** The headers of a file read again after the import, by column: a header may be a title of any language. */
const csvColumns = (headers: Array<string | null | undefined>) =>
  headers.map((header) => (header == null ? header : csvColumnOfHeader(applicationCsvConfig, header)));

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
    // In the list's order (its sort, the id breaking ties), as the screen shows them.
    const applications = inIdOrder(await queryBuilder.getMany(), matching.ids);
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
    // The applications the load wrote: a row the operation skipped (an existing application in
    // "add new only", a new one in "update only") or found unchanged keeps its owners and residency.
    const written = new Set<string>();
    const look: LookalikeState = { decisions: new Map(), followed: [], fields: new Map(), updatedByName: new Map() };
    const config = {
      ...applicationCsvConfig,
      settleRows: (rows: Array<{ raw: Record<string, string>; rowNumber: number; found: any | null }>, context: CsvImportContext) =>
        this.settleRows(rows, context, look),
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
      afterCommit: async (entities: any[]) => {
        for (const entity of entities) if (entity?.id) written.add(String(entity.id));
      },
    };
    // The names before the load, to find the renamed applications afterwards.
    const namesBefore = params.dryRun ? new Map<string, string>() : new Map<string, string>(
      (await opts.manager.query(`SELECT id::text AS id, name FROM applications WHERE tenant_id = $1`, [opts.tenantId]))
        .map((row: { id: string; name: string }) => [row.id, row.name] as const),
    );
    const result = await this.importSvc.import(config, file, params, { ...opts, itOpsSettings });
    if (look.decisions.size > 0) {
      const entries = [...look.decisions.values()].sort((a, b) => a.line - b.line).map((decision) => lookalikeEntry(decision, look.fields.get(decision.line)));
      result.lookalikes = lookalikesResult(entries, look.followed);
    }

    // If successful and not dry run, handle owners and data residency
    if (result.ok && !params.dryRun) {
      await this.handleOwnerImport(file, params.mode, written, opts, look.updatedByName);
      await this.handleDataResidencyImport(file, params.mode, written, opts, look.updatedByName);
      await this.syncRenamedDocumentTitles(namesBefore, written, opts);
    }

    return result;
  }

  /**
   * The rows that would create an application and look like one the person reads (lot I3 of 26.11.9,
   * T-I3d): left out unless the person chose otherwise (`params.lookalikes`), created anyway, or the
   * update of that application. A row the uniqueness rule finds (by its id or name) stays an update. In
   * "update only" nothing changes; in "add new only" no row may update one. An update whose application
   * changed since the check is refused (`CSV_LOOKALIKE_CHANGED`): the import writes nothing.
   */
  private async settleRows(
    rows: Array<{ raw: Record<string, string>; rowNumber: number; found: any | null }>,
    context: CsvImportContext,
    look: LookalikeState,
  ): Promise<CsvSettledRow[]> {
    const { params } = context;
    if (params.operation === 'update_only') return rows.map((row) => ({ entity: row.found }));
    const index = new ApplicationIndex(await storedApplications(context.manager, context.tenantId));
    const decided = decideLookalikes(rows.map((row) => {
      const name = String(row.raw.name ?? '').trim();
      return {
        line: row.rowNumber,
        foundId: row.found ? String(row.found.id) : null,
        keys: row.found || !name ? null : { name, supplierId: this.rowSupplier(row.raw, context), editor: String(row.raw.editor ?? '').trim() || null },
      };
    }), index, params.lookalikes ?? [], { updatable: params.operation !== 'insert_only' });
    look.decisions = decided.decisions;
    look.followed = decided.followed;
    const ids = [...decided.decisions.values()].filter((decision) => decision.action === 'update').map((decision) => decision.id);
    const stored: any[] = ids.length === 0 ? [] : await context.manager.query(
      `SELECT * FROM applications WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [context.tenantId, ids],
    );
    return rows.map((row): CsvSettledRow => {
      const decision = decided.decisions.get(row.rowNumber);
      if (!decision) return { entity: row.found };
      const ref = decision.app?.sequential_id || decision.app?.name || '';
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
      const entity = stored.find((app) => String(app.id) === decision.id) ?? null;
      if (decision.stale || !entity) {
        return { entity, errors: [{ row: row.rowNumber, column: 'name', message: `${ref} changed since the check.`, code: 'CSV_LOOKALIKE_CHANGED', params: { ref } }] };
      }
      look.updatedByName.set(applicationNameKey(row.raw.name), decision.id);
      return { entity };
    });
  }

  /**
   * The supplier a row names, as the import resolves it (Kad's proposal, the name case aside, then
   * accents aside for a person who reads the suppliers and did not undo it), else the one its
   * publisher names (`editorSupplier`); null for none.
   */
  private rowSupplier(raw: Record<string, string>, context: CsvImportContext): string | null {
    const cell = String(raw.supplier_name ?? '').trim();
    if (!cell) {
      const editor = String(raw.editor ?? '').trim();
      return editor ? this.editorSupplier(editor, context)?.id ?? null : null;
    }
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
   * A row that gives a publisher and no supplier is linked to the supplier its publisher names (T-I3k),
   * a match listed (`origin: 'editor'`) that the person may undo. A supplier stored on the application
   * the row updates is kept, except by full replace with a blank supplier cell (a file without the
   * supplier column says nothing of it).
   */
  private supplierFromEditor(rows: CsvImportRow[], context: CsvImportContext): void {
    for (const row of rows) {
      if (row.errors.length > 0 || String(row.raw.supplier_name ?? '').trim() !== '') continue;
      const editor = String(row.raw.editor ?? '').trim();
      const existing = row.existingEntity;
      if (!editor) continue;
      if (existing?.supplier_id && (context.params.mode === 'enrich' || !('supplier_name' in row.raw))) continue;
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
  private async syncRenamedDocumentTitles(namesBefore: Map<string, string>, written: Set<string>, opts: { manager: EntityManager; tenantId: string; userId?: string | null }) {
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
      }, opts.userId ?? null, { manager: opts.manager });
    }
  }

  /**
   * Handle owner import from CSV after main import.
   */
  private async handleOwnerImport(
    file: Express.Multer.File,
    mode: CsvImportParams['mode'],
    written: Set<string>,
    opts: { manager: EntityManager; tenantId: string; userId?: string | null },
    updatedByName: ReadonlyMap<string, string> = new Map(),
  ) {
    const { manager, tenantId, userId } = opts;

    // Re-parse the file to get owner columns
    const { parseString } = await import('@fast-csv/parse');
    const { csvSeparatorOf, readImportText } = await import('../common/csv-sheet/read');

    // The CSV text of the file, or of the first sheet of a workbook, as the main import read it.
    const text = (await readImportText(file.buffer)).text;
    const rows: Record<string, string>[] = [];

    await new Promise<void>((resolve, reject) => {
      parseString(text, { headers: csvColumns, delimiter: csvSeparatorOf(text) ?? ';', ignoreEmpty: true })
        .on('data', (row) => rows.push(row))
        .on('end', () => resolve())
        .on('error', (err) => reject(err));
    });

    const userByEmail = await usersByEmail(manager, tenantId);

    // Process each row
    for (const row of rows) {
      const appName = (row['name'] || '').trim();
      if (!Object.keys(row).some((key) => /^(business|it)_owner_email_/.test(key))) continue;
      if (!appName) continue;

      const appId = await this.importedApplicationId(manager, tenantId, row, updatedByName);
      if (!appId || !written.has(String(appId))) continue;

      // The application, then its owners (`lockApplicationRow`), as every writer of them.
      await lockApplicationRow(manager, tenantId, appId);
      const ownerRepo = manager.getRepository(ApplicationOwner);
      const beforeRows = await ownerRepo.find({ where: { application_id: appId, tenant_id: tenantId } as any });

      // Owners named by the columns (deduped by owner type + user to avoid unique violations);
      // empty cells keep the stored owners of their type, except in replace mode.
      const ownerKeys = csvOwnerKeys(row, userByEmail, beforeRows.map((r) => `${r.owner_type}:${r.user_id}`), mode);
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
          },
          { manager },
        );
      }
    }
  }

  /**
   * The application a loaded row wrote: by its id column when it names one of the tenant's
   * applications, then the application a row that looked like it updated ("Update APP-n", under
   * another name: lot I3 of 26.11.9), else by its name (an ambiguous name was refused by the validation).
   */
  private async importedApplicationId(
    manager: EntityManager,
    tenantId: string,
    row: Record<string, string>,
    updatedByName: ReadonlyMap<string, string> = new Map(),
  ): Promise<string | null> {
    const id = (row['id'] || '').trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      const byId = await manager.query(`SELECT id FROM applications WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      if (byId.length) return byId[0].id;
    }
    const updated = updatedByName.get(applicationNameKey(row['name']));
    if (updated) return updated;
    const byName = await manager.query(
      `SELECT id FROM applications WHERE tenant_id = $1 AND lower(btrim(name)) = lower(btrim($2)) ORDER BY created_at ASC, id ASC LIMIT 1`,
      [tenantId, (row['name'] || '').trim()],
    );
    return byName[0]?.id ?? null;
  }

  /**
   * Handle data residency import from CSV after main import.
   */
  private async handleDataResidencyImport(
    file: Express.Multer.File,
    mode: CsvImportParams['mode'],
    written: Set<string>,
    opts: { manager: EntityManager; tenantId: string; userId?: string | null },
    updatedByName: ReadonlyMap<string, string> = new Map(),
  ) {
    const { manager, tenantId, userId } = opts;

    // Re-parse the file
    const { parseString } = await import('@fast-csv/parse');
    const { csvSeparatorOf, readImportText } = await import('../common/csv-sheet/read');

    // The CSV text of the file, or of the first sheet of a workbook, as the main import read it.
    const text = (await readImportText(file.buffer)).text;
    const rows: Record<string, string>[] = [];

    await new Promise<void>((resolve, reject) => {
      parseString(text, { headers: csvColumns, delimiter: csvSeparatorOf(text) ?? ';', ignoreEmpty: true })
        .on('data', (row) => rows.push(row))
        .on('end', () => resolve())
        .on('error', (err) => reject(err));
    });

    // Process each row: a file without the column leaves residency alone.
    for (const row of rows) {
      const appName = (row['name'] || '').trim();
      if (!Object.prototype.hasOwnProperty.call(row, 'data_residency')) continue;
      const residencyRaw = row['data_residency'] || '';
      if (!appName) continue;

      const appId = await this.importedApplicationId(manager, tenantId, row, updatedByName);
      if (!appId || !written.has(String(appId))) continue;

      // Parse residency codes
      const codes = residencyRaw
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c.length === 2);

      // An empty cell keeps the stored residency, except in replace mode, where it clears it.
      if (codes.length === 0 && mode !== 'replace') continue;

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
