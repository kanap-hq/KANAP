import type { CsvLanguage } from '../common/csv-sheet';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { PortfolioRequest } from './portfolio-request.entity';
import {
  CsvEntityConfig,
  CsvExportService,
  CsvImportService,
  CsvImportParams,
  CsvExportResult,
  CsvImportResult,
  CsvFieldInfo,
} from '../common/csv';
import type { ExportFileFormat } from '../common/xlsx';
import { portfolioRequestCsvConfig } from './portfolio-request-csv.config';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';

/**
 * Service for importing and exporting Portfolio Requests via CSV
 */
@Injectable()
export class PortfolioRequestsCsvService {
  constructor(
    @InjectRepository(PortfolioRequest) private readonly requests: Repository<PortfolioRequest>,
    private readonly exportSvc: CsvExportService,
    private readonly importSvc: CsvImportService,
    private readonly integratedDocs: IntegratedDocumentsService,
  ) {}

  private buildCsvConfig(): CsvEntityConfig {
    const baseConfig = portfolioRequestCsvConfig;

    return {
      ...baseConfig,
      beforeCommit: async (entities: any[], context) => {
        await baseConfig.beforeCommit?.(entities, context);

        for (const entity of entities) {
          if (Object.prototype.hasOwnProperty.call(entity, 'purpose')) {
            (entity as any).__csv_managed_purpose = entity.purpose ?? null;
            delete entity.purpose;
          }
          if (Object.prototype.hasOwnProperty.call(entity, 'risks')) {
            (entity as any).__csv_managed_risks = entity.risks ?? null;
            delete entity.risks;
          }
        }
      },
      afterCommit: async (entities: any[], context) => {
        for (const entity of entities) {
          const source = {
            id: entity.id,
            tenant_id: entity.tenant_id || context.tenantId,
            item_number: entity.item_number ?? null,
            name: entity.name || '',
          };

          await this.integratedDocs.provisionForRequest(
            source,
            {
              purpose: (entity as any).__csv_managed_purpose ?? null,
              risks_mitigations: (entity as any).__csv_managed_risks ?? null,
            },
            context.userId ?? null,
            { manager: context.manager },
          );

          if (Object.prototype.hasOwnProperty.call(entity, '__csv_managed_purpose')) {
            await this.integratedDocs.writeSourceSlotContent(
              'requests',
              source,
              'purpose',
              (entity as any).__csv_managed_purpose ?? null,
              context.userId ?? null,
              { manager: context.manager, logSourceActivity: false },
            );
          }

          if (Object.prototype.hasOwnProperty.call(entity, '__csv_managed_risks')) {
            await this.integratedDocs.writeSourceSlotContent(
              'requests',
              source,
              'risks_mitigations',
              (entity as any).__csv_managed_risks ?? null,
              context.userId ?? null,
              { manager: context.manager, logSourceActivity: false },
            );
          }

          await this.integratedDocs.syncTitles(
            'requests',
            source,
            context.userId ?? null,
            { manager: context.manager },
          );

          delete (entity as any).__csv_managed_purpose;
          delete (entity as any).__csv_managed_risks;
        }

        await baseConfig.afterCommit?.(entities, context);
      },
    };
  }

  private async hydrateManagedBodies(
    requests: PortfolioRequest[],
    manager: EntityManager,
    tenantId: string,
  ): Promise<void> {
    const requestIds = requests.map((request) => request.id).filter(Boolean);
    if (requestIds.length === 0) {
      return;
    }

    const rows = await manager.query<Array<{
      source_entity_id: string;
      slot_key: 'purpose' | 'risks_mitigations';
      content_markdown: string | null;
    }>>(
      `SELECT b.source_entity_id::text AS source_entity_id,
              b.slot_key,
              d.content_markdown
       FROM integrated_document_bindings b
       JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1
         AND b.source_entity_type = 'requests'
         AND b.source_entity_id = ANY($2::uuid[])
         AND b.slot_key IN ('purpose', 'risks_mitigations')`,
      [tenantId, requestIds],
    );

    const contentByRequestId = new Map<string, { purpose?: string | null; risks?: string | null }>();
    for (const row of rows) {
      const bucket = contentByRequestId.get(row.source_entity_id) || {};
      if (row.slot_key === 'purpose') {
        bucket.purpose = row.content_markdown ?? '';
      } else if (row.slot_key === 'risks_mitigations') {
        bucket.risks = row.content_markdown ?? '';
      }
      contentByRequestId.set(row.source_entity_id, bucket);
    }

    for (const request of requests) {
      const managed = contentByRequestId.get(request.id);
      request.purpose = managed?.purpose ?? '';
      request.risks = managed?.risks ?? '';
    }
  }

  /**
   * Export portfolio requests to CSV format.
   */
  async export<F extends ExportFileFormat = 'csv'>(opts: {
    manager: EntityManager;
    tenantId: string;
    /** The screen language: separator, days, decimal mark and yes or no (`csv-sheet`). */
    language: CsvLanguage;
    scope?: 'template' | 'data';
    fields?: string[];
    preset?: string;
    status?: string;
    /** `csv` (default) or `xlsx` (data only: a template is CSV). */
    format?: F;
  }): Promise<CsvExportResult<F>> {
    const { manager, tenantId, scope, fields, preset, status } = opts;

    // Build query for requests
    let queryBuilder = manager
      .getRepository(PortfolioRequest)
      .createQueryBuilder('request')
      .where('request.tenant_id = :tenantId', { tenantId });

    // Filter by status if specified
    if (status) {
      queryBuilder = queryBuilder.andWhere('request.status = :status', { status });
    }

    queryBuilder = queryBuilder.orderBy('request.created_at', 'DESC');

    // Get requests (empty for template export)
    const requests = scope === 'template' ? [] : await queryBuilder.getMany();
    if (scope !== 'template' && requests.length > 0) {
      await this.hydrateManagedBodies(requests, manager, tenantId);
    }

    return this.exportSvc.export(this.buildCsvConfig(), requests, {
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
   * Import portfolio requests from CSV file.
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
    return this.importSvc.import(this.buildCsvConfig(), file, params, opts);
  }

  /**
   * Get field metadata and presets for frontend display.
   */
  getFieldInfo(): { fields: CsvFieldInfo[]; presets: Array<{ name: string; label: string; fields: string[] }> } {
    const fields = portfolioRequestCsvConfig.fields
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

    const presets = (portfolioRequestCsvConfig.exportPresets ?? []).map((p) => ({
      name: p.name,
      label: p.label,
      fields: p.fields,
    }));

    return { fields, presets };
  }
}
