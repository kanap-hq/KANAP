import type { CsvLanguage } from '../common/csv-sheet';
import { Injectable } from '@nestjs/common';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { exportCatalogLabels } from '../it-ops-settings/catalog-resolve';
import { OperatingSystemService } from '../technologies/operating-system.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Asset } from './asset.entity';
import {
  CsvExportService,
  CsvImportService,
  CsvImportParams,
  CsvExportResult,
  CsvImportResult,
  CsvFieldInfo,
} from '../common/csv';
import { assetCsvConfig } from './asset-csv.config';
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
  ) {}

  /**
   * Export assets to CSV format.
   */
  async export(opts: {
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
  }): Promise<CsvExportResult> {
    const { manager, tenantId, scope, fields, preset, environment, kind, status } = opts;

    // Build query for assets
    let queryBuilder = manager
      .getRepository(Asset)
      .createQueryBuilder('asset')
      .where('asset.tenant_id = :tenantId', { tenantId });

    // Apply filters
    if (environment) {
      queryBuilder = queryBuilder.andWhere('asset.environment = :environment', { environment });
    }
    if (kind) {
      queryBuilder = queryBuilder.andWhere('asset.kind = :kind', { kind });
    }
    if (status) {
      queryBuilder = queryBuilder.andWhere('asset.status = :status', { status });
    }

    queryBuilder = queryBuilder.orderBy('asset.name', 'ASC');

    // Get assets (empty for template export)
    const assets = scope === 'template' ? [] : await queryBuilder.getMany();
    if (assets.length) {
      // Users never see codes: catalog-backed columns are exported as names (import accepts either).
      // The operating system is already the readable label of the marked link.
      const settings = await this.itOpsSettings.getSettings(tenantId, { manager });
      const labels = await this.operatingSystems.labelsOf(manager, tenantId, assets.map((asset) => asset.id));
      const ipTypeLabel = (code: string) => settings.ipAddressTypes.find((option) => option.code === code)?.label || code;
      for (const asset of assets) {
        asset.operating_system = labels.get(asset.id) ?? null;
        exportCatalogLabels(asset, { kind: settings.serverKinds, status: settings.lifecycleStates, domain: settings.domains });
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
    });
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
