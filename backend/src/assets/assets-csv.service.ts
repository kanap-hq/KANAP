import type { CsvLanguage } from '../common/csv-sheet';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { exportCatalogLabelsIn } from '../it-ops-settings/catalog-resolve';
import { shippedLabelIn } from '../it-ops-settings/catalog-shipped-labels';
import { AssetsListService } from './services/assets-list.service';
import { OperatingSystemService } from '../technologies/operating-system.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, SelectQueryBuilder } from 'typeorm';
import { Asset } from './asset.entity';
import {
  CsvExportService,
  CsvImportService,
  CsvImportParams,
  CsvExportResult,
  CsvImportResult,
  CsvFieldInfo,
} from '../common/csv';
import type { ExportFileFormat } from '../common/xlsx';
import { clusterMembershipsOf, clusterNamesText, lockAssetNames } from './asset-rules';
import { assetEnvironmentLabel } from './asset-environments';
import { assetCsvConfig } from './asset-csv.config';
import { inIdOrder } from '../common/pagination';
import { assetVulnerabilityCounts } from '../vulnerabilities/vulnerability-reach-counts';
import {
  csvConfigForVulnerabilityFeed,
  VULNERABILITY_CSV_PROPERTY,
  vulnerabilityListFields,
} from '../vulnerabilities/vulnerability-list-column';

/**
 * Service for importing and exporting Assets via CSV
 */
@Injectable()
export class AssetsCsvService {
  constructor(
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    private readonly exportSvc: CsvExportService,
    private readonly importSvc: CsvImportService,
    private readonly itOpsSettings: ItOpsSettingsService,
    private readonly operatingSystems: OperatingSystemService,
    private readonly list: AssetsListService,
  ) {}

  /**
   * Export assets to CSV format.
   */
  async export<F extends ExportFileFormat = 'csv'>(opts: {
    manager: EntityManager;
    tenantId: string;
    /** The screen language: separator, days, decimal mark and yes or no (`csv-sheet`). */
    language: CsvLanguage;
    scope?: 'template' | 'data';
    fields?: string[];
    preset?: string;
    environment?: string;
    kind?: string;
    status?: string;
    /** The list request: filters, search and scope. The same query the grid sends. */
    query?: Record<string, unknown>;
    /** `csv` (default) or `xlsx` (data only: a template is CSV). */
    format?: F;
  }): Promise<CsvExportResult<F>> {
    const { manager, tenantId, scope, fields, preset } = opts;

    let queryBuilder = manager
      .getRepository(Asset)
      .createQueryBuilder('asset')
      .where('asset.tenant_id = :tenantId', { tenantId });

    // A template is headers only. A data export is the rows the list shows.
    const assets = scope === 'template' ? [] : await this.rowsForExport(queryBuilder, opts);
    if (assets.length) {
      // Catalog columns are the names the screen shows in the file's language. A name the tenant
      // typed stays as stored. The operating system is already the readable label of the marked link.
      // Cluster Membership is the names of the asset's real clusters, never the legacy text (empty
      // for a cluster).
      const settings = await this.itOpsSettings.getSettings(tenantId, { manager });
      const labels = await this.operatingSystems.labelsOf(manager, tenantId, assets.map((asset) => asset.id));
      const memberships = await clusterMembershipsOf(manager, tenantId, assets.map((asset) => asset.id));
      const ipTypeLabel = (code: string) => {
        const option = settings.ipAddressTypes.find((item) => item.code === code);
        if (!option) return code;
        return shippedLabelIn('ipAddressTypes', option, opts.language) ?? (option.label || code);
      };
      for (const asset of assets) {
        asset.operating_system = labels.get(asset.id) ?? null;
        asset.cluster = clusterNamesText(memberships.get(asset.id));
        exportCatalogLabelsIn(asset, {
          kind: { list: 'serverKinds', options: settings.serverKinds },
          status: { list: 'lifecycleStates', options: settings.lifecycleStates },
          domain: { list: 'domains', options: settings.domains },
          admin_zone: { list: 'adminZones', options: settings.adminZones },
        }, opts.language);
        if (asset.environment) {
          // The file shows the name, not the stored code. This row is not written back.
          (asset as { environment: string }).environment = assetEnvironmentLabel(asset.environment, opts.language);
        }
        if (Array.isArray(asset.ip_addresses)) asset.ip_addresses = asset.ip_addresses.map((ip) => ({ ...ip, type: ipTypeLabel(ip.type) }));
      }
      // Vulnerabilities to review and severe ones (shared module), empty for a retired asset.
      const vulnerabilityCounts = await assetVulnerabilityCounts(manager, tenantId, assets.map((asset) => asset.id));
      for (const asset of assets) {
        (asset as any)[VULNERABILITY_CSV_PROPERTY] = vulnerabilityListFields(vulnerabilityCounts.get(asset.id));
      }
    }

    return this.exportSvc.export(csvConfigForVulnerabilityFeed(assetCsvConfig), assets, {
      manager,
      tenantId,
      scope,
      fields,
      preset,
      language: opts.language,
      format: opts.format,
    });
  }

  /** The assets the list would show for this request, plus the older environment, kind and status filters. */
  private async rowsForExport(queryBuilder: SelectQueryBuilder<Asset>, opts: {
    manager: EntityManager;
    tenantId: string;
    language: CsvLanguage;
    environment?: string;
    kind?: string;
    status?: string;
    query?: Record<string, unknown>;
  }): Promise<Asset[]> {
    const raw = opts.query?.filters;
    let parsed: unknown = raw ?? {};
    if (typeof raw === 'string') {
      try {
        parsed = raw.trim() ? JSON.parse(raw) : {};
      } catch {
        throw new BadRequestException('The list filters could not be read.');
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('The list filters could not be read.');
    }
    const filters: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
    for (const [field, value] of Object.entries({ environment: opts.environment, kind: opts.kind, status: opts.status })) {
      if (value) filters[field] = { filterType: 'set', values: [value] };
    }
    const matching = await this.list.listIds(
      // Every matching asset: the navigation's 10,000 cap does not apply to the export.
      { ...opts.query, filters: JSON.stringify(filters), __export: true },
      // The language sorts the catalog columns, as on the list.
      { manager: opts.manager, tenantId: opts.tenantId, language: opts.language },
    );
    if (!matching.ids.length) queryBuilder.andWhere('FALSE');
    else queryBuilder.andWhere('asset.id = ANY(:ids)', { ids: matching.ids });
    // In the list's order (its sort, the id breaking ties), as the screen shows them.
    return inIdOrder(await queryBuilder.getMany(), matching.ids);
  }

  /**
   * Import assets from CSV file.
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
      await lockAssetNames(manager, opts.tenantId);
      const itOpsSettings = await this.itOpsSettings.getSettingsForWrite(opts.tenantId, manager);
      return this.importSvc.import(assetCsvConfig, file, params, { ...opts, manager, itOpsSettings });
    });
  }

  /**
   * Get field metadata and presets for frontend display.
   */
  getFieldInfo(): { fields: CsvFieldInfo[]; presets: Array<{ name: string; label: string; fields: string[] }> } {
    const config = csvConfigForVulnerabilityFeed(assetCsvConfig);
    const fields = config.fields
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

    const presets = (config.exportPresets ?? []).map((p) => ({
      name: p.name,
      label: p.label,
      fields: p.fields,
    }));

    return { fields, presets };
  }
}
