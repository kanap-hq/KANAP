import { writeCsvHeader, type CsvLanguage } from '../common/csv-sheet';
import { ApplicationsListService } from './services/applications-list.service';
import { classificationReadState } from './services/application-classification';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { exportCatalogLabelsIn } from '../it-ops-settings/catalog-resolve';
import { lockApplicationNames } from './application-rules';
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
  CsvImportParams,
  CsvExportResult,
  CsvImportResult,
  CsvFieldInfo,
  CsvResolverService,
} from '../common/csv';
import { applicationCsvConfig, csvOwnerKeys, sameKeys, usersByEmail } from './application-csv.config';
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
  async export(opts: {
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
  }): Promise<CsvExportResult> {
    const { manager, tenantId, scope, fields, preset, lifecycle, criticality, status } = opts;

    // For template export, just return headers (all importable fields)
    if (scope === 'template') {
      const headers = this.buildExportHeaders(fields, preset, 'template');
      return {
        filename: 'application_template.csv',
        content: writeCsvHeader(opts.language, headers),
        rowCount: 0,
        warnings: [],
      };
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

    queryBuilder = queryBuilder.orderBy('app.name', 'ASC');

    const filters = typeof opts.query?.filters === 'string' ? JSON.parse(opts.query.filters) : { ...(opts.query?.filters as any || {}) };
    for (const [field, value] of Object.entries({ lifecycle, criticality, status })) if (value) filters[field] = { filterType: 'set', values: [value] };
    const matching = await this.listService.listIds({ ...opts.query, filters: JSON.stringify(filters), __classificationExport: true }, { manager, tenantId });
    if (!matching.ids.length) queryBuilder.andWhere('FALSE');
    else queryBuilder.andWhere('app.id = ANY(:ids)', { ids: matching.ids });
    const applications = await queryBuilder.getMany();
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
    },
  ): Promise<CsvImportResult> {
    return opts.manager.transaction(async (manager) => {
      await manager.query('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', [opts.tenantId]);
      await lockApplicationNames(manager, opts.tenantId);
      const result = await this.importLocked(file, params, { ...opts, manager });
      if (!params.dryRun && !result.ok && result.errors.some((error) => error.row === 0)) throw new BadRequestException(result);
      return result;
    });
  }

  private async importLocked(file: Express.Multer.File, params: CsvImportParams, opts: { manager: EntityManager; tenantId: string; userId?: string | null }): Promise<CsvImportResult> {
    // The tenant row is locked FOR UPDATE by import(): the catalogs read here cannot change underneath.
    const itOpsSettings = await this.itOpsSettings.getSettings(opts.tenantId, { manager: opts.manager });
    // The applications the load wrote: a row the operation skipped (an existing application in
    // "add new only", a new one in "update only") or found unchanged keeps its owners and residency.
    const written = new Set<string>();
    const config = {
      ...applicationCsvConfig,
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

    // If successful and not dry run, handle owners and data residency
    if (result.ok && !params.dryRun) {
      await this.handleOwnerImport(file, params.mode, written, opts);
      await this.handleDataResidencyImport(file, params.mode, written, opts);
      await this.syncRenamedDocumentTitles(namesBefore, written, opts);
    }

    return result;
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
  private async handleOwnerImport(file: Express.Multer.File, mode: CsvImportParams['mode'], written: Set<string>, opts: { manager: EntityManager; tenantId: string; userId?: string | null }) {
    const { manager, tenantId, userId } = opts;

    // Re-parse the file to get owner columns
    const { parseString } = await import('@fast-csv/parse');
    const { decodeCsv } = await import('../common/csv-sheet/decode');
    const { csvSeparatorOf } = await import('../common/csv-sheet/read');

    const text = decodeCsv(file.buffer).text;
    const rows: Record<string, string>[] = [];

    await new Promise<void>((resolve, reject) => {
      parseString(text, { headers: true, delimiter: csvSeparatorOf(text) ?? ';', ignoreEmpty: true })
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

      const appId = await this.importedApplicationId(manager, tenantId, row);
      if (!appId || !written.has(String(appId))) continue;

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
   * applications, else by its name (an ambiguous name was refused by the validation).
   */
  private async importedApplicationId(manager: EntityManager, tenantId: string, row: Record<string, string>): Promise<string | null> {
    const id = (row['id'] || '').trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      const byId = await manager.query(`SELECT id FROM applications WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      if (byId.length) return byId[0].id;
    }
    const byName = await manager.query(
      `SELECT id FROM applications WHERE tenant_id = $1 AND lower(btrim(name)) = lower(btrim($2)) ORDER BY created_at ASC, id ASC LIMIT 1`,
      [tenantId, (row['name'] || '').trim()],
    );
    return byName[0]?.id ?? null;
  }

  /**
   * Handle data residency import from CSV after main import.
   */
  private async handleDataResidencyImport(file: Express.Multer.File, mode: CsvImportParams['mode'], written: Set<string>, opts: { manager: EntityManager; tenantId: string; userId?: string | null }) {
    const { manager, tenantId, userId } = opts;

    // Re-parse the file
    const { parseString } = await import('@fast-csv/parse');
    const { decodeCsv } = await import('../common/csv-sheet/decode');
    const { csvSeparatorOf } = await import('../common/csv-sheet/read');

    const text = decodeCsv(file.buffer).text;
    const rows: Record<string, string>[] = [];

    await new Promise<void>((resolve, reject) => {
      parseString(text, { headers: true, delimiter: csvSeparatorOf(text) ?? ';', ignoreEmpty: true })
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

      const appId = await this.importedApplicationId(manager, tenantId, row);
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
