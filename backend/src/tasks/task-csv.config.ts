import {
  ArrayStrategy,
  CsvEntityConfig,
  CsvExportContext,
  CsvFieldType,
  CsvImportContext,
} from '../common/csv';
import { allocateItemNumbers } from '../common/item-number.service';

/**
 * CSV configuration for Tasks entity
 *
 * Field order matches TaskWorkspacePage.tsx sidebar sections:
 * - Basic: title, description
 * - Context: related_object, phase, priority_level, category, stream
 * - Status: status
 * - Dates: start_date, due_date
 * - People: assignee, creator, viewers, owners
 * - Other: labels
 */
export const taskCsvConfig: CsvEntityConfig = {
  entityName: 'task',
  tableName: 'tasks',
  displayName: 'Tasks',
  // For linked tasks: title + related_object_id. For standalone: title alone (matched via id).
  upsertKey: ['title'],
  fields: [
    // Identity
    {
      csvColumn: 'id',
      entityProperty: 'id',
      type: CsvFieldType.STRING,
      isIdentityColumn: true,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'ID',
      group: 'Identity',
    },

    // === BASIC FIELDS ===
    {
      csvColumn: 'title',
      entityProperty: 'title',
      type: CsvFieldType.STRING,
      required: true,
      defaultExport: true,
      label: 'Title',
      group: 'Basic',
    },
    {
      csvColumn: 'description',
      entityProperty: 'description',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Description',
      group: 'Basic',
    },

    // === CONTEXT (Related object, phase, priority, category, stream) ===
    {
      csvColumn: 'task_type_name',
      entityProperty: 'task_type_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_task_types',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Task Type',
      group: 'Context',
    },
    {
      csvColumn: 'related_object_type',
      entityProperty: 'related_object_type',
      type: CsvFieldType.ENUM,
      enumValues: ['spend_item', 'contract', 'capex_item', 'project', 'incident'],
      required: false, // Optional for standalone tasks
      defaultExport: true,
      label: 'Related Object Type',
      group: 'Context',
    },
    {
      csvColumn: 'related_object_id',
      entityProperty: 'related_object_id',
      type: CsvFieldType.STRING,
      required: false, // Not required if related_object_name is provided
      exportable: true,
      importable: true,
      defaultExport: true,
      label: 'Related Object ID',
      group: 'Context',
    },
    {
      csvColumn: 'related_object_name',
      entityProperty: '_related_object_name', // Temporary field for import; pre-loaded for export
      type: CsvFieldType.COMPUTED,
      required: false,
      exportable: true,
      importable: true,
      defaultExport: true,
      label: 'Related Object Name',
      group: 'Context',
      // Export reads pre-loaded _relatedObjectName (set by TasksCsvService.export)
      exportFn: (entity: any) => entity._relatedObjectName ?? '',
    },
    {
      csvColumn: 'phase_name',
      entityProperty: 'phase_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_project_phases',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Phase',
      group: 'Context',
    },
    {
      csvColumn: 'priority_level',
      entityProperty: 'priority_level',
      type: CsvFieldType.ENUM,
      enumValues: ['blocker', 'high', 'normal', 'low', 'optional'],
      required: false,
      defaultExport: true,
      label: 'Priority Level',
      group: 'Context',
    },
    {
      csvColumn: 'category_name',
      entityProperty: 'category_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_categories',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Category',
      group: 'Context',
    },
    {
      csvColumn: 'stream_name',
      entityProperty: 'stream_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_streams',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Stream',
      group: 'Context',
    },
    {
      csvColumn: 'source_name',
      entityProperty: 'source_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_sources',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: false,
      label: 'Source',
      group: 'Context',
    },
    {
      csvColumn: 'company_name',
      entityProperty: 'company_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'companies',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: false,
      label: 'Company',
      group: 'Context',
    },

    // === STATUS ===
    {
      csvColumn: 'status',
      entityProperty: 'status',
      type: CsvFieldType.ENUM,
      enumValues: ['open', 'in_progress', 'pending', 'in_testing', 'done', 'cancelled'],
      required: false,
      defaultExport: true,
      label: 'Status',
      group: 'Status',
    },

    // === DATES ===
    {
      csvColumn: 'start_date',
      entityProperty: 'start_date',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'Start Date',
      group: 'Dates',
    },
    {
      csvColumn: 'due_date',
      entityProperty: 'due_date',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'Due Date',
      group: 'Dates',
    },

    // === PEOPLE ===
    {
      csvColumn: 'assignee_email',
      entityProperty: 'assignee_user_id',
      type: CsvFieldType.FK_BY_EMAIL,
      fkEntity: 'users',
      fkLookupColumn: 'email',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Assignee Email',
      group: 'People',
    },
    {
      csvColumn: 'creator_email',
      entityProperty: 'creator_id',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Requestor Email',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        if (!entity.creator_id) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === entity.creator_id) {
            return user._originalLookupValue ?? '';
          }
        }
        return '';
      },
    },
    // Viewers - explicit columns matching Apps/Assets pattern
    {
      csvColumn: 'viewer_email_1',
      entityProperty: '_viewer_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'Viewer Email 1',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.viewer_ids;
        if (!Array.isArray(ids) || !ids[0]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[0]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'viewer_email_2',
      entityProperty: '_viewer_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'Viewer Email 2',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.viewer_ids;
        if (!Array.isArray(ids) || !ids[1]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[1]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'viewer_email_3',
      entityProperty: '_viewer_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'Viewer Email 3',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.viewer_ids;
        if (!Array.isArray(ids) || !ids[2]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[2]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'viewer_email_4',
      entityProperty: '_viewer_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'Viewer Email 4',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.viewer_ids;
        if (!Array.isArray(ids) || !ids[3]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[3]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    // Owners - explicit columns matching Apps/Assets pattern
    {
      csvColumn: 'owner_email_1',
      entityProperty: '_owner_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: false,
      label: 'Owner Email 1',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.owner_ids;
        if (!Array.isArray(ids) || !ids[0]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[0]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'owner_email_2',
      entityProperty: '_owner_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: false,
      label: 'Owner Email 2',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.owner_ids;
        if (!Array.isArray(ids) || !ids[1]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[1]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'owner_email_3',
      entityProperty: '_owner_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: false,
      label: 'Owner Email 3',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.owner_ids;
        if (!Array.isArray(ids) || !ids[2]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[2]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },
    {
      csvColumn: 'owner_email_4',
      entityProperty: '_owner_emails',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: false,
      label: 'Owner Email 4',
      group: 'People',
      exportFn: (entity: any, context: CsvExportContext) => {
        const ids = entity.owner_ids;
        if (!Array.isArray(ids) || !ids[3]) return '';
        const lookup = context.resolverCache.get('users');
        if (!lookup) return '';
        for (const [, user] of lookup.entries()) {
          if (user.id === ids[3]) return user._originalLookupValue ?? '';
        }
        return '';
      },
    },

    // === OTHER ===
    {
      csvColumn: 'labels',
      entityProperty: 'labels',
      type: CsvFieldType.ARRAY,
      arrayStrategy: ArrayStrategy.COMMA_SEPARATED,
      required: false,
      defaultExport: true,
      label: 'Labels',
      group: 'Other',
    },
  ],

  // Export presets
  exportPresets: [
    {
      name: 'enrichment',
      label: 'Data Enrichment',
      // Only importable fields - excludes computed fields like creator_email
      fields: [
        'id', 'title', 'description',
        'related_object_type', 'related_object_id', 'related_object_name', 'phase_name',
        'priority_level', 'category_name', 'stream_name',
        'status', 'start_date', 'due_date',
        'assignee_email',
        'viewer_email_1', 'viewer_email_2', 'viewer_email_3', 'viewer_email_4',
        'owner_email_1', 'owner_email_2', 'owner_email_3', 'owner_email_4',
        'labels',
      ],
    },
  ],

  /**
   * Hook to normalize status, priority_level, related_object_type values and resolve
   * related_object_name to related_object_id before commit.
   * Accepts both codes and common labels for enum fields.
   */
  beforeCommit: async (entities: any[], context: CsvImportContext) => {
    // Status label to code mapping
    const statusLookup = new Map<string, string>([
      // Codes map to themselves
      ['open', 'open'],
      ['in_progress', 'in_progress'],
      ['pending', 'pending'],
      ['in_testing', 'in_testing'],
      ['done', 'done'],
      ['cancelled', 'cancelled'],
      // Common labels
      ['in progress', 'in_progress'],
      ['active', 'in_progress'],
      ['working', 'in_progress'],
      ['in testing', 'in_testing'],
      ['testing', 'in_testing'],
      ['completed', 'done'],
      ['complete', 'done'],
      ['finished', 'done'],
      ['closed', 'done'],
      ['canceled', 'cancelled'],
      ['cancelled', 'cancelled'],
    ]);

    // Priority level label to code mapping
    const priorityLookup = new Map<string, string>([
      // Codes map to themselves
      ['blocker', 'blocker'],
      ['high', 'high'],
      ['normal', 'normal'],
      ['low', 'low'],
      ['optional', 'optional'],
      // Common labels
      ['critical', 'blocker'],
      ['urgent', 'blocker'],
      ['medium', 'normal'],
      ['default', 'normal'],
      ['nice to have', 'optional'],
      ['nice-to-have', 'optional'],
    ]);

    // Related object type label to code mapping
    const objectTypeLookup = new Map<string, string>([
      // Codes map to themselves
      ['spend_item', 'spend_item'],
      ['contract', 'contract'],
      ['capex_item', 'capex_item'],
      ['project', 'project'],
      ['incident', 'incident'],
      // Common labels
      ['spend item', 'spend_item'],
      ['spend', 'spend_item'],
      ['capex item', 'capex_item'],
      ['capex', 'capex_item'],
    ]);

    // Table mapping for related object resolution. `where`: a `spend_item` names an OPEX line
    // (`spend/budget-nature.ts`), never a line of another nature with the same name.
    const tableMap: Record<string, { table: string; nameColumn: string; where?: string }> = {
      project: { table: 'portfolio_projects', nameColumn: 'name' },
      spend_item: { table: 'spend_items', nameColumn: 'product_name', where: ` AND nature = 'opex'` },
      contract: { table: 'contracts', nameColumn: 'name' },
      capex_item: { table: 'capex_items', nameColumn: 'description' },
      incident: { table: 'incidents', nameColumn: "'INC-' || item_number::text" },
    };

    // First pass: normalize enum values
    for (const entity of entities) {
      if (entity.status) {
        const input = String(entity.status).trim().toLowerCase();
        const resolved = statusLookup.get(input);
        if (resolved) entity.status = resolved;
      }

      if (entity.priority_level) {
        const input = String(entity.priority_level).trim().toLowerCase();
        const resolved = priorityLookup.get(input);
        if (resolved) entity.priority_level = resolved;
      }

      if (entity.related_object_type) {
        const input = String(entity.related_object_type).trim().toLowerCase();
        const resolved = objectTypeLookup.get(input);
        if (resolved) entity.related_object_type = resolved;
      }
    }

    // Second pass: resolve related_object_name to related_object_id
    // Group entities by type to batch queries
    const byType = new Map<string, Array<{ entity: any; name: string }>>();

    for (const entity of entities) {
      // Skip if already has an ID or no name provided
      if (entity.related_object_id) {
        // Clean up temporary field
        delete entity._related_object_name;
        continue;
      }

      const name = entity._related_object_name;
      if (!name || !entity.related_object_type) {
        // Validation will catch missing required fields
        delete entity._related_object_name;
        continue;
      }

      const type = entity.related_object_type;
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push({ entity, name: String(name).trim() });
    }

    // Resolve names to IDs for each type
    for (const [type, items] of byType.entries()) {
      const mapping = tableMap[type];
      if (!mapping) continue;

      const { table, nameColumn, where } = mapping;
      const names = items.map((i) => i.name.toLowerCase());

      const rows = await context.manager.query(
        `SELECT id, ${nameColumn} AS name FROM ${table} WHERE tenant_id = $1${where ?? ''} AND LOWER(${nameColumn}) = ANY($2)`,
        [context.tenantId, names],
      );

      // Build lookup map
      const idByName = new Map<string, string>();
      for (const row of rows) {
        idByName.set(String(row.name).toLowerCase(), row.id);
      }

      // Resolve each entity
      for (const { entity, name } of items) {
        const id = idByName.get(name.toLowerCase());
        if (id) {
          entity.related_object_id = id;
        } else {
          throw new Error(
            `Related object not found: "${name}" (type: ${type}). ` +
            `Make sure the ${type.replace('_', ' ')} exists before importing tasks.`,
          );
        }
        // Clean up temporary field
        delete entity._related_object_name;
      }
    }

    // Re-scope phase_id: the generic FK resolver matches phase names
    // tenant-wide, so a repeated name ("Design", "Build") can resolve to
    // another project's phase. Re-anchor each phase to the task's project.
    const phaseEntities = entities.filter(
      (e) => e.phase_id && e.related_object_type === 'project' && e.related_object_id,
    );
    if (phaseEntities.length > 0) {
      const phaseIds = [...new Set(phaseEntities.map((e) => e.phase_id))];
      const phaseRows = await context.manager.query(
        `SELECT id, name, project_id FROM portfolio_project_phases WHERE tenant_id = $1 AND id = ANY($2)`,
        [context.tenantId, phaseIds],
      );
      const phaseById = new Map<string, any>(phaseRows.map((p: any) => [p.id, p]));
      const misScoped = phaseEntities.filter((e) => {
        const phase = phaseById.get(e.phase_id);
        return phase && phase.project_id !== e.related_object_id;
      });
      if (misScoped.length > 0) {
        const projectIds = [...new Set(misScoped.map((e) => e.related_object_id))];
        const names = [...new Set(misScoped.map((e) => String(phaseById.get(e.phase_id).name).toLowerCase()))];
        const scopedRows = await context.manager.query(
          `SELECT id, name, project_id FROM portfolio_project_phases WHERE tenant_id = $1 AND project_id = ANY($2) AND LOWER(name) = ANY($3)`,
          [context.tenantId, projectIds, names],
        );
        const scopedByKey = new Map<string, string>(
          scopedRows.map((p: any) => [`${p.project_id}|${String(p.name).toLowerCase()}`, p.id]),
        );
        for (const entity of misScoped) {
          const phaseName = String(phaseById.get(entity.phase_id).name);
          const scopedId = scopedByKey.get(`${entity.related_object_id}|${phaseName.toLowerCase()}`);
          if (scopedId) {
            entity.phase_id = scopedId;
          } else {
            throw new Error(
              `Phase "${phaseName}" does not exist in the project of task "${entity.title}". ` +
              `Create the phase in that project first, or clear the phase_name column.`,
            );
          }
        }
      }
    }

    // Final validation: linked tasks require related_object_id
    // Standalone tasks (no related_object_type) are allowed
    for (const entity of entities) {
      const hasType = !!entity.related_object_type;
      const hasId = !!entity.related_object_id;

      if (hasType && !hasId) {
        // Has type but no ID - error, should have been resolved from name
        throw new Error(
          `Task "${entity.title}" has a related_object_type but no related_object_id. ` +
          `Provide either related_object_id or related_object_name to link the task.`,
        );
      }

      // Standalone tasks are valid - no type and no id
    }

    // Viewer/owner emails are handled by TasksCsvService.handleViewerOwnerImport
    // after the main import; drop the temp props so they never reach save/audit.
    for (const entity of entities) {
      delete entity._viewer_emails;
      delete entity._owner_emails;
    }

    // Assign item_numbers to new entities
    const newEntities = entities.filter(e => !e.item_number);
    if (newEntities.length > 0) {
      const firstNumber = await allocateItemNumbers(
        'task', context.tenantId, newEntities.length, context.manager,
      );
      newEntities.forEach((e, i) => { e.item_number = firstNumber + i; });
    }
  },
};
