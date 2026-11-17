import type { CsvLanguage } from '../common/csv-sheet';
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
} from '../common/csv';
import type { ExportFileFormat } from '../common/xlsx';
import {
  CONTRACT_OUTSIDE_ACCESS,
  TASK_INHERITED_CLASSIFICATION,
  taskCsvConfig,
  taskProjectClassifications,
} from './task-csv.config';
import { inIdOrder } from '../common/pagination';
import { isLimitedTransaction } from '../data-access/line-write-checks';
import {
  IncidentViewer,
  taskIncidentVisibilityQueryBuilderClause,
} from '../incidents/incident-visibility';

/** The task types of a budget line, which a limited person may see tasks of without the line. */
const LINE_TYPES = new Set(['spend_item', 'capex_item']);

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
  async export<F extends ExportFileFormat = 'csv'>(opts: {
    manager: EntityManager;
    tenantId: string;
    /** The screen language: separator, days, decimal mark and yes or no (`csv-sheet`). */
    language: CsvLanguage;
    scope?: 'template' | 'data';
    fields?: string[];
    preset?: string;
    relatedObjectType?: string;
    relatedObjectId?: string;
    /** A task of an incident the reader cannot see stays out of the file (empty for incidents:admin). */
    viewer?: IncidentViewer | null;
    /**
     * The rows of the list the screen shows, in its order (`listIds` of the list's query, every
     * page): only these, in this order. Absent: the whole register (API scripts).
     */
    ids?: string[];
    /** `csv` (default) or `xlsx` (data only: a template is CSV). */
    format?: F;
  }): Promise<CsvExportResult<F>> {
    const { manager, tenantId, scope, fields, preset, relatedObjectType, relatedObjectId, viewer, ids } = opts;

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

    // Export follows the list: a task of an incident the reader cannot see is absent.
    const incidentVisibility = taskIncidentVisibilityQueryBuilderClause('task', viewer);
    if (incidentVisibility.clause) {
      queryBuilder = queryBuilder.andWhere(incidentVisibility.clause, incidentVisibility.params);
    }

    if (ids) queryBuilder = queryBuilder.andWhere(ids.length ? 'task.id = ANY(:ids)' : 'FALSE', { ids });
    queryBuilder = queryBuilder.orderBy('task.created_at', 'DESC');

    // Get tasks (empty for template export), in the list's order when it gives them
    const read = scope === 'template' ? [] : await queryBuilder.getMany();
    const tasks = ids ? inIdOrder(read, ids) : read;

    // Pre-load related object names for export
    if (tasks.length > 0) {
      await this.loadRelatedObjectNames(tasks, manager, tenantId, opts.language);
      await this.loadInheritedClassification(tasks, manager, tenantId);
    }

    return this.exportSvc.export(taskCsvConfig, tasks, {
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
    // The viewers and owners are written with the task (`taskCsvConfig`, `importPeople`).
    return this.importSvc.import(taskCsvConfig, file, params, opts);
  }

  /**
   * Pre-load related object names for export.
   * Attaches _relatedObjectName to each task entity.
   */
  private async loadRelatedObjectNames(
    tasks: Task[],
    manager: EntityManager,
    tenantId: string,
    language: CsvLanguage,
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

    // A limited person's export shows no trace of a line out of access (spec §5.4, §5.6): a task
    // they see (a participation) of a line they cannot read exports neither its name nor its id. A
    // contract they cannot read gives the list's label instead of its name (lot R4 of 26.11.9).
    const limited = await isLimitedTransaction(manager);

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
        const hidden = limited && relatedObjectId && !nameById.has(relatedObjectId);
        if (hidden && (LINE_TYPES.has(type) || type === 'contract')) {
          task.related_object_id = null;
        }
        (task as any)._relatedObjectName = hidden && type === 'contract'
          ? CONTRACT_OUTSIDE_ACCESS[language] ?? CONTRACT_OUTSIDE_ACCESS.en
          : relatedObjectId ? (nameById.get(relatedObjectId) ?? '') : '';
      }
    }
  }

  /**
   * The classification the list shows: a task of a project without a value of its own takes its
   * project's (`TASK_INHERITED_CLASSIFICATION`). Set on the exported copies only; the import reads
   * that value back as unchanged (`taskCsvConfig.afterValidate`).
   */
  private async loadInheritedClassification(tasks: Task[], manager: EntityManager, tenantId: string): Promise<void> {
    const projectTasks = tasks.filter((task) => task.related_object_type === 'project' && task.related_object_id);
    if (projectTasks.length === 0) return;
    const projects = await taskProjectClassifications(manager, tenantId, projectTasks.map((task) => task.related_object_id!));
    for (const task of projectTasks) {
      const project = projects.get(task.related_object_id!.toLowerCase());
      if (!project) continue;
      for (const key of TASK_INHERITED_CLASSIFICATION) {
        if (task[key] == null) task[key] = project[key];
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
