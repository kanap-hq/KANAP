import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Task } from './task.entity';
import {
  CsvExportService,
  CsvImportService,
  CsvExportOptions,
  CsvImportOptions,
  CsvImportParams,
  CsvExportResult,
  CsvImportResult,
  CsvFieldInfo,
  CsvFieldType,
} from '../common/csv';
import { taskCsvConfig } from './task-csv.config';

/**
 * Service for importing and exporting Tasks via CSV
 */
@Injectable()
export class TasksCsvService {
  constructor(
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    private readonly exportSvc: CsvExportService,
    private readonly importSvc: CsvImportService,
  ) {}

  /**
   * Export tasks to CSV format.
   *
   * @param opts Export options
   * @returns Export result with filename and content
   */
  async export(opts: {
    manager: EntityManager;
    tenantId: string;
    scope?: 'template' | 'data';
    fields?: string[];
    preset?: string;
    relatedObjectType?: string;
    relatedObjectId?: string;
  }): Promise<CsvExportResult> {
    const { manager, tenantId, scope, fields, preset, relatedObjectType, relatedObjectId } = opts;

    // Build query for tasks
    let queryBuilder = manager
      .getRepository(Task)
      .createQueryBuilder('task')
      .where('task.tenant_id = :tenantId', { tenantId });

    // Filter by related object if specified
    if (relatedObjectType) {
      queryBuilder = queryBuilder.andWhere('task.related_object_type = :relatedObjectType', { relatedObjectType });
    }
    if (relatedObjectId) {
      queryBuilder = queryBuilder.andWhere('task.related_object_id = :relatedObjectId', { relatedObjectId });
    }

    queryBuilder = queryBuilder.orderBy('task.created_at', 'DESC');

    // Get tasks (empty for template export)
    const tasks = scope === 'template' ? [] : await queryBuilder.getMany();

    // Pre-load related object names for export
    if (tasks.length > 0) {
      await this.loadRelatedObjectNames(tasks, manager, tenantId);
    }

    return this.exportSvc.export(taskCsvConfig, tasks, {
      manager,
      tenantId,
      scope,
      fields,
      preset,
    });
  }

  /**
   * Import tasks from CSV file.
   *
   * @param file Uploaded file
   * @param params Import parameters
   * @param opts Import options
   * @returns Import result with counts and errors
   */
  async import(
    file: Express.Multer.File,
    params: CsvImportParams,
    opts: CsvImportOptions,
  ): Promise<CsvImportResult> {
    // First run the base import
    const result = await this.importSvc.import(taskCsvConfig, file, params, opts);

    // If successful and not dry run, handle viewers and owners
    if (result.ok && !params.dryRun) {
      await this.handleViewerOwnerImport(file, opts);
    }

    return result;
  }

  /**
   * Pre-load related object names for export.
   * Attaches _relatedObjectName to each task entity.
   */
  private async loadRelatedObjectNames(
    tasks: Task[],
    manager: EntityManager,
    tenantId: string,
  ): Promise<void> {
    // Group tasks by related object type
    const byType = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.related_object_type || !task.related_object_id) continue;
      const type = task.related_object_type;
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push(task);
    }

    // Table mapping
    // `where`: a `spend_item` names an OPEX line (`spend/budget-nature.ts`).
    const tableMap: Record<string, { table: string; nameColumn: string; where?: string }> = {
      project: { table: 'portfolio_projects', nameColumn: 'name' },
      spend_item: { table: 'spend_items', nameColumn: 'product_name', where: ` AND nature = 'opex'` },
      contract: { table: 'contracts', nameColumn: 'name' },
      capex_item: { table: 'spend_items', nameColumn: 'product_name', where: ` AND nature = 'capex'` },
      incident: { table: 'incidents', nameColumn: "'INC-' || item_number::text" },
    };

    // Load names for each type
    for (const [type, typeTasks] of byType.entries()) {
      const mapping = tableMap[type];
      if (!mapping) continue;

      const ids = [...new Set(typeTasks.map((t) => t.related_object_id))];

      const rows = await manager.query(
        `SELECT id, ${mapping.nameColumn} AS name FROM ${mapping.table} WHERE id = ANY($1) AND tenant_id = $2${mapping.where ?? ''}`,
        [ids, tenantId],
      );

      const nameById = new Map<string, string>();
      for (const row of rows) {
        nameById.set(row.id, row.name);
      }

      // Attach names to tasks
      for (const task of typeTasks) {
        const relatedObjectId = task.related_object_id;
        (task as any)._relatedObjectName = relatedObjectId ? (nameById.get(relatedObjectId) ?? '') : '';
      }
    }
  }

  /**
   * Handle viewer and owner import from CSV after main import.
   */
  private async handleViewerOwnerImport(
    file: Express.Multer.File,
    opts: { manager: EntityManager; tenantId: string },
  ): Promise<void> {
    const { manager, tenantId } = opts;

    // Re-parse the file to get viewer/owner columns
    const { parseString } = await import('@fast-csv/parse');
    const { decodeCsvBufferUtf8OrThrow } = await import('../common/encoding');

    const text = decodeCsvBufferUtf8OrThrow(file.buffer);
    const rows: Record<string, string>[] = [];

    await new Promise<void>((resolve, reject) => {
      parseString(text, { headers: true, delimiter: ';', ignoreEmpty: true })
        .on('data', (row) => rows.push(row))
        .on('end', () => resolve())
        .on('error', (err) => reject(err));
    });

    // Load user lookup
    const users = await manager.query(`SELECT id, email FROM users WHERE tenant_id = $1`, [tenantId]);
    const userByEmail = new Map<string, string>();
    for (const u of users) {
      userByEmail.set(String(u.email).toLowerCase(), u.id);
    }

    // Table mapping for resolving related_object_name (mirrors taskCsvConfig.beforeCommit)
    const relatedTableMap: Record<string, { table: string; nameColumn: string; where?: string }> = {
      project: { table: 'portfolio_projects', nameColumn: 'name' },
      spend_item: { table: 'spend_items', nameColumn: 'product_name', where: ` AND nature = 'opex'` },
      contract: { table: 'contracts', nameColumn: 'name' },
      capex_item: { table: 'spend_items', nameColumn: 'product_name', where: ` AND nature = 'capex'` },
      incident: { table: 'incidents', nameColumn: "'INC-' || item_number::text" },
    };
    const normalizeType = (raw: string): string => {
      const t = raw.trim().toLowerCase().replace(/\s+/g, '_');
      if (t === 'capex') return 'capex_item';
      if (t === 'spend') return 'spend_item';
      return t;
    };
    const relatedIdCache = new Map<string, string | null>();
    const resolveRelatedId = async (row: Record<string, string>): Promise<string | null> => {
      const explicit = (row['related_object_id'] || '').trim();
      if (explicit) return explicit;
      const type = normalizeType(row['related_object_type'] || '');
      const name = (row['related_object_name'] || '').trim();
      const mapping = relatedTableMap[type];
      if (!mapping || !name) return null;
      const cacheKey = `${type}||${name.toLowerCase()}`;
      if (!relatedIdCache.has(cacheKey)) {
        const found = await manager.query(
          `SELECT id FROM ${mapping.table} WHERE tenant_id = $1${mapping.where ?? ''} AND LOWER(${mapping.nameColumn}) = LOWER($2) LIMIT 1`,
          [tenantId, name],
        );
        relatedIdCache.set(cacheKey, found.length ? found[0].id : null);
      }
      return relatedIdCache.get(cacheKey) ?? null;
    };

    // Process each row
    for (const row of rows) {
      const taskTitle = (row['title'] || '').trim();
      if (!taskTitle) continue;
      const relatedObjectId = await resolveRelatedId(row);

      // Find task by upsert key (title + related object; standalone tasks have none)
      const taskRows = relatedObjectId
        ? await manager.query(
            `SELECT id, viewer_ids, owner_ids FROM tasks WHERE tenant_id = $1 AND LOWER(title) = LOWER($2) AND related_object_id = $3 LIMIT 1`,
            [tenantId, taskTitle, relatedObjectId],
          )
        : await manager.query(
            `SELECT id, viewer_ids, owner_ids FROM tasks WHERE tenant_id = $1 AND LOWER(title) = LOWER($2) AND related_object_id IS NULL LIMIT 1`,
            [tenantId, taskTitle],
          );
      if (taskRows.length === 0) continue;
      const task = taskRows[0];

      // Collect viewer IDs from columns
      const viewerIds: string[] = [];
      for (let i = 1; i <= 4; i++) {
        const email = (row[`viewer_email_${i}`] || '').trim().toLowerCase();
        if (email && userByEmail.has(email)) {
          viewerIds.push(userByEmail.get(email)!);
        }
      }

      // Collect owner IDs from columns
      const ownerIds: string[] = [];
      for (let i = 1; i <= 4; i++) {
        const email = (row[`owner_email_${i}`] || '').trim().toLowerCase();
        if (email && userByEmail.has(email)) {
          ownerIds.push(userByEmail.get(email)!);
        }
      }

      // Update task with viewer and owner arrays (only if columns were present)
      const hasViewerColumns = [1, 2, 3, 4].some((i) => `viewer_email_${i}` in row);
      const hasOwnerColumns = [1, 2, 3, 4].some((i) => `owner_email_${i}` in row);

      if (hasViewerColumns || hasOwnerColumns) {
        const updates: string[] = [];
        const params: any[] = [task.id];
        let paramIndex = 2;

        if (hasViewerColumns) {
          updates.push(`viewer_ids = $${paramIndex}`);
          params.push(viewerIds.length > 0 ? viewerIds : null);
          paramIndex++;
        }

        if (hasOwnerColumns) {
          updates.push(`owner_ids = $${paramIndex}`);
          params.push(ownerIds.length > 0 ? ownerIds : null);
          paramIndex++;
        }

        if (updates.length > 0) {
          await manager.query(
            `UPDATE tasks SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1`,
            params,
          );
        }
      }
    }
  }

  /**
   * Get field metadata and presets for frontend display.
   */
  getFieldInfo(): { fields: CsvFieldInfo[]; presets: Array<{ name: string; label: string; fields: string[] }> } {
    const fields = taskCsvConfig.fields
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

    const presets = (taskCsvConfig.exportPresets ?? []).map((p) => ({
      name: p.name,
      label: p.label,
      fields: p.fields,
    }));

    return { fields, presets };
  }
}
