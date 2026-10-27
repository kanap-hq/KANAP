import type { CsvLanguage } from '../common/csv-sheet';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { PortfolioProject } from './portfolio-project.entity';
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
import { portfolioProjectCsvConfig } from './portfolio-project-csv.config';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';

/**
 * Service for importing and exporting Portfolio Projects via CSV
 */
@Injectable()
export class PortfolioProjectsCsvService {
  constructor(
    @InjectRepository(PortfolioProject) private readonly projects: Repository<PortfolioProject>,
    private readonly exportSvc: CsvExportService,
    private readonly importSvc: CsvImportService,
    private readonly integratedDocs: IntegratedDocumentsService,
  ) {}

  private buildCsvConfig(): CsvEntityConfig {
    const baseConfig = portfolioProjectCsvConfig;

    return {
      ...baseConfig,
      beforeCommit: async (entities: any[], context) => {
        await baseConfig.beforeCommit?.(entities, context);

        for (const entity of entities) {
          if (Object.prototype.hasOwnProperty.call(entity, 'purpose')) {
            (entity as any).__csv_managed_purpose = entity.purpose ?? null;
            delete entity.purpose;
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

          await this.integratedDocs.provisionForProject(
            source,
            {
              purpose: (entity as any).__csv_managed_purpose ?? null,
            },
            context.userId ?? null,
            { manager: context.manager },
          );

          if (Object.prototype.hasOwnProperty.call(entity, '__csv_managed_purpose')) {
            await this.integratedDocs.writeSourceSlotContent(
              'projects',
              source,
              'purpose',
              (entity as any).__csv_managed_purpose ?? null,
              context.userId ?? null,
              { manager: context.manager, logSourceActivity: false },
            );
          }

          await this.integratedDocs.syncTitles(
            'projects',
            source,
            context.userId ?? null,
            { manager: context.manager },
          );

          delete (entity as any).__csv_managed_purpose;
        }

        await baseConfig.afterCommit?.(entities, context);
      },
    };
  }

  private async hydrateManagedBodies(
    projects: PortfolioProject[],
    manager: EntityManager,
    tenantId: string,
  ): Promise<void> {
    const projectIds = projects.map((project) => project.id).filter(Boolean);
    if (projectIds.length === 0) {
      return;
    }

    const rows = await manager.query<Array<{
      source_entity_id: string;
      content_markdown: string | null;
    }>>(
      `SELECT b.source_entity_id::text AS source_entity_id,
              d.content_markdown
       FROM integrated_document_bindings b
       JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1
         AND b.source_entity_type = 'projects'
         AND b.source_entity_id = ANY($2::uuid[])
         AND b.slot_key = 'purpose'`,
      [tenantId, projectIds],
    );

    const purposeByProjectId = new Map<string, string | null>();
    for (const row of rows) {
      purposeByProjectId.set(row.source_entity_id, row.content_markdown ?? '');
    }

    for (const project of projects) {
      project.purpose = purposeByProjectId.get(project.id) ?? '';
    }
  }

  /**
   * Export portfolio projects to CSV format.
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

    // Build query for projects
    let queryBuilder = manager
      .getRepository(PortfolioProject)
      .createQueryBuilder('project')
      .where('project.tenant_id = :tenantId', { tenantId });

    // Filter by status if specified
    if (status) {
      queryBuilder = queryBuilder.andWhere('project.status = :status', { status });
    }

    queryBuilder = queryBuilder.orderBy('project.created_at', 'DESC');

    // Get projects (empty for template export)
    const projects = scope === 'template' ? [] : await queryBuilder.getMany();
    if (scope !== 'template' && projects.length > 0) {
      await this.hydrateManagedBodies(projects, manager, tenantId);
    }

    return this.exportSvc.export(this.buildCsvConfig(), projects, {
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
   * Import portfolio projects from CSV file.
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
    const fields = portfolioProjectCsvConfig.fields
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

    const presets = (portfolioProjectCsvConfig.exportPresets ?? []).map((p) => ({
      name: p.name,
      label: p.label,
      fields: p.fields,
    }));

    return { fields, presets };
  }
}
