import {
  INTEGRATED_DOCUMENT_SLOT_DEFINITIONS,
  MANAGED_DOCS_FOLDER_DEFINITIONS,
  MANAGED_DOCS_LIBRARY_DISPLAY_ORDER,
  MANAGED_DOCS_LIBRARY_NAME,
  MANAGED_DOCS_LIBRARY_SLUG,
  type IntegratedDocumentSlotDefinition,
  type IntegratedDocumentSourceEntityType,
  type ManagedDocsFolderDefinition,
  ManagedDocsFolderSystemKey,
} from './integrated-document.constants';
import { markdownToSearchText } from '../common/markdown-search-text';

type SqlExecutor = {
  query<T = any>(query: string, parameters?: any[]): Promise<T[]>;
};

export type ManagedDocsSeedDefinitions = {
  folderDefinitions: readonly ManagedDocsFolderDefinition[];
  slotDefinitions: readonly IntegratedDocumentSlotDefinition[];
};

export type SeedManagedDocsKnowledgeAssetsOptions = {
  supportedSourceEntityTypes?: readonly IntegratedDocumentSourceEntityType[];
  /**
   * Frozen definitions supplied by the caller. A migration passes its own literal
   * copy so a later edit of the shared constants cannot change what that migration
   * seeded. When set, `supportedSourceEntityTypes` is ignored.
   */
  definitions?: ManagedDocsSeedDefinitions;
};

export function getManagedDocsSeedDefinitions(
  options: SeedManagedDocsKnowledgeAssetsOptions = {},
): ManagedDocsSeedDefinitions {
  if (options.definitions) {
    return options.definitions;
  }

  if (!options.supportedSourceEntityTypes?.length) {
    return {
      folderDefinitions: MANAGED_DOCS_FOLDER_DEFINITIONS,
      slotDefinitions: INTEGRATED_DOCUMENT_SLOT_DEFINITIONS,
    };
  }

  const supportedSourceEntityTypes = new Set(options.supportedSourceEntityTypes);
  return {
    folderDefinitions: MANAGED_DOCS_FOLDER_DEFINITIONS.filter((definition) =>
      supportedSourceEntityTypes.has(definition.sourceEntityType),
    ),
    slotDefinitions: INTEGRATED_DOCUMENT_SLOT_DEFINITIONS.filter((definition) =>
      supportedSourceEntityTypes.has(definition.sourceEntityType),
    ),
  };
}

async function ensureLibrary(
  executor: SqlExecutor,
  tenantId: string,
  params: {
    name: string;
    slug: string;
    isSystem: boolean;
    displayOrder: number;
    updateExisting?: boolean;
  },
): Promise<string> {
  if (params.updateExisting) {
    await executor.query(
      `INSERT INTO document_libraries (tenant_id, name, slug, is_system, display_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, slug)
       DO UPDATE SET
         name = EXCLUDED.name,
         is_system = EXCLUDED.is_system,
         display_order = EXCLUDED.display_order,
         updated_at = now()`,
      [tenantId, params.name, params.slug, params.isSystem, params.displayOrder],
    );
  }
  if (!params.updateExisting) {
    await executor.query(
      `INSERT INTO document_libraries (tenant_id, name, slug, is_system, display_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, slug) DO NOTHING`,
      [tenantId, params.name, params.slug, params.isSystem, params.displayOrder],
    );
  }
  const rows = await executor.query<{ id: string }>(
    `SELECT id
     FROM document_libraries
     WHERE tenant_id = app_current_tenant()
       AND slug = $1
     LIMIT 1`,
    [params.slug],
  );
  if (!rows[0]?.id) {
    throw new Error(`Failed to resolve document library ${params.slug} for tenant ${tenantId}`);
  }
  return String(rows[0].id);
}

async function ensureManagedFolder(
  executor: SqlExecutor,
  tenantId: string,
  params: {
    libraryId: string;
    systemKey: ManagedDocsFolderSystemKey;
    name: string;
    displayOrder: number;
  },
): Promise<string> {
  const existingByKey = await executor.query<{ id: string }>(
    `SELECT id
     FROM document_folders
     WHERE tenant_id = app_current_tenant()
       AND library_id = $1
       AND system_key = $2
     LIMIT 1`,
    [params.libraryId, params.systemKey],
  );
  const existing =
    existingByKey[0]
    ?? (
      await executor.query<{ id: string }>(
        `SELECT id
         FROM document_folders
         WHERE tenant_id = app_current_tenant()
           AND library_id = $1
           AND parent_id IS NULL
           AND lower(name) = lower($2)
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
        [params.libraryId, params.name],
      )
    )[0];

  if (existing?.id) {
    await executor.query(
      `UPDATE document_folders
       SET name = $2,
           parent_id = NULL,
           display_order = $3,
           system_key = $4,
           updated_at = now()
       WHERE id = $1`,
      [existing.id, params.name, params.displayOrder, params.systemKey],
    );
  }
  if (!existing?.id) {
    await executor.query(
      `INSERT INTO document_folders (
         tenant_id,
         name,
         parent_id,
         library_id,
         display_order,
         system_key
       )
       VALUES ($1, $2, NULL, $3, $4, $5)`,
      [tenantId, params.name, params.libraryId, params.displayOrder, params.systemKey],
    );
  }

  const rows = await executor.query<{ id: string }>(
    `SELECT id
     FROM document_folders
     WHERE tenant_id = app_current_tenant()
       AND library_id = $1
       AND system_key = $2
     LIMIT 1`,
    [params.libraryId, params.systemKey],
  );
  if (!rows[0]?.id) {
    throw new Error(`Failed to resolve managed folder ${params.systemKey} for tenant ${tenantId}`);
  }
  return String(rows[0].id);
}

async function ensureManagedDocumentType(
  executor: SqlExecutor,
  tenantId: string,
  params: {
    name: string;
    systemKey: string;
    description: string;
    displayOrder: number;
  },
): Promise<string> {
  const existingByKey = await executor.query<{ id: string }>(
    `SELECT id
     FROM document_types
     WHERE tenant_id = app_current_tenant()
       AND system_key = $1
     LIMIT 1`,
    [params.systemKey],
  );
  const existing =
    existingByKey[0]
    ?? (
      await executor.query<{ id: string }>(
        `SELECT id
         FROM document_types
         WHERE tenant_id = app_current_tenant()
           AND lower(name) = lower($1)
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
        [params.name],
      )
    )[0];

  if (existing?.id) {
    await executor.query(
      `UPDATE document_types
       SET name = $2,
           description = $3,
           is_active = true,
           is_system = true,
           is_default = false,
           display_order = $4,
           system_key = $5,
           updated_at = now()
       WHERE id = $1`,
      [existing.id, params.name, params.description, params.displayOrder, params.systemKey],
    );
  }
  if (!existing?.id) {
    await executor.query(
      `INSERT INTO document_types (
         tenant_id,
         name,
         description,
         template_content,
         is_active,
         is_system,
         is_default,
         display_order,
         system_key
       )
       VALUES ($1, $2, $3, NULL, true, true, false, $4, $5)`,
      [tenantId, params.name, params.description, params.displayOrder, params.systemKey],
    );
  }

  const rows = await executor.query<{ id: string }>(
    `SELECT id
     FROM document_types
     WHERE tenant_id = app_current_tenant()
       AND system_key = $1
     LIMIT 1`,
    [params.systemKey],
  );
  if (!rows[0]?.id) {
    throw new Error(`Failed to resolve managed document type ${params.systemKey} for tenant ${tenantId}`);
  }
  return String(rows[0].id);
}

async function allocateDocumentItemNumber(executor: SqlExecutor, tenantId: string): Promise<number> {
  const rows = await executor.query<{ item_number: number }>(
    `INSERT INTO item_sequences (tenant_id, entity_type, next_val)
     VALUES ($1, 'document', 2)
     ON CONFLICT (tenant_id, entity_type)
     DO UPDATE SET next_val = item_sequences.next_val + 1
     RETURNING next_val - 1 AS item_number`,
    [tenantId],
  );
  return Number(rows[0].item_number);
}

async function resolveExistingTemplateDocumentId(
  executor: SqlExecutor,
  templateDocumentId: string | null | undefined,
): Promise<string | null> {
  const id = String(templateDocumentId || '').trim();
  if (!id) return null;

  const rows = await executor.query<{ id: string }>(
    `SELECT d.id
     FROM documents d
     JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
     WHERE d.id = $1
       AND d.tenant_id = app_current_tenant()
       AND dl.slug = 'templates'
     LIMIT 1`,
    [id],
  );
  return rows[0]?.id ? String(rows[0].id) : null;
}

async function ensureTemplateDocument(
  executor: SqlExecutor,
  tenantId: string,
  params: {
    templatesLibraryId: string;
    documentTypeId: string;
    title: string;
    summary: string;
    contentMarkdown?: string | null;
  },
): Promise<string> {
  const existing = await executor.query<{ id: string }>(
    `SELECT d.id
     FROM documents d
     JOIN document_libraries dl ON dl.id = d.library_id AND dl.tenant_id = d.tenant_id
     WHERE d.tenant_id = app_current_tenant()
       AND dl.slug = 'templates'
       AND d.library_id = $1
       AND d.document_type_id = $2
       AND d.title = $3
     ORDER BY d.created_at ASC, d.id ASC
     LIMIT 1`,
    [params.templatesLibraryId, params.documentTypeId, params.title],
  );
  // The body is indexed for the search from content_plain (documents_search_vector_sync), as for
  // any document saved from Knowledge: derive it from the Markdown on both paths.
  const contentMarkdown = params.contentMarkdown ?? '';
  const contentPlain = markdownToSearchText(contentMarkdown);
  if (existing[0]?.id) {
    await executor.query(
      `UPDATE documents
       SET summary = $2,
           content_markdown = $3,
           content_plain = $4,
           updated_at = now()
       WHERE id = $1`,
      [existing[0].id, params.summary, contentMarkdown, contentPlain],
    );
    return String(existing[0].id);
  }

  const itemNumber = await allocateDocumentItemNumber(executor, tenantId);
  const rows = await executor.query<{ id: string }>(
    `INSERT INTO documents (
       tenant_id,
       item_number,
       title,
       summary,
       content_markdown,
       content_plain,
       folder_id,
       library_id,
       document_type_id,
       template_document_id,
       status,
       revision,
       current_version_number,
       published_at
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       $8,
       NULL,
       $6,
       $7,
       NULL,
       'published',
       1,
       0,
       now()
     )
     RETURNING id`,
    [
      tenantId,
      itemNumber,
      params.title,
      params.summary,
      contentMarkdown,
      params.templatesLibraryId,
      params.documentTypeId,
      contentPlain,
    ],
  );
  return String(rows[0].id);
}

export async function seedManagedDocsKnowledgeAssets(
  executor: SqlExecutor,
  tenantId: string,
  options: SeedManagedDocsKnowledgeAssetsOptions = {},
): Promise<void> {
  await executor.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

  const { folderDefinitions, slotDefinitions } = getManagedDocsSeedDefinitions(options);

  await ensureLibrary(executor, tenantId, {
    name: 'Documents',
    slug: 'documents',
    isSystem: false,
    displayOrder: 0,
  });
  const templatesLibraryId = await ensureLibrary(executor, tenantId, {
    name: 'Templates',
    slug: 'templates',
    isSystem: true,
    displayOrder: 1,
  });
  const managedDocsLibraryId = await ensureLibrary(executor, tenantId, {
    name: MANAGED_DOCS_LIBRARY_NAME,
    slug: MANAGED_DOCS_LIBRARY_SLUG,
    isSystem: true,
    displayOrder: MANAGED_DOCS_LIBRARY_DISPLAY_ORDER,
    updateExisting: true,
  });

  const folderIds = new Map<ManagedDocsFolderSystemKey, string>();
  for (const folderDefinition of folderDefinitions) {
    const folderId = await ensureManagedFolder(executor, tenantId, {
      libraryId: managedDocsLibraryId,
      systemKey: folderDefinition.systemKey,
      name: folderDefinition.name,
      displayOrder: folderDefinition.displayOrder,
    });
    folderIds.set(folderDefinition.systemKey, folderId);
  }

  const documentTypeIds = new Map<string, string>();
  for (const [index, slotDefinition] of slotDefinitions.entries()) {
    const documentTypeId = await ensureManagedDocumentType(executor, tenantId, {
      name: slotDefinition.documentTypeName,
      systemKey: slotDefinition.documentTypeSystemKey,
      description: slotDefinition.documentTypeDescription,
      displayOrder: slotDefinition.documentTypeDisplayOrder ?? 100 + index,
    });
    documentTypeIds.set(slotDefinition.documentTypeSystemKey, documentTypeId);
  }

  for (const slotDefinition of slotDefinitions) {
    const existingSettingRows = await executor.query<{ template_document_id: string | null }>(
      `SELECT template_document_id
       FROM integrated_document_slot_settings
       WHERE tenant_id = app_current_tenant()
         AND source_entity_type = $1
         AND slot_key = $2
       LIMIT 1`,
      [slotDefinition.sourceEntityType, slotDefinition.slotKey],
    );

    let templateDocumentId = await resolveExistingTemplateDocumentId(
      executor,
      existingSettingRows[0]?.template_document_id,
    );
    if (!templateDocumentId) {
      templateDocumentId = await ensureTemplateDocument(executor, tenantId, {
        templatesLibraryId,
        documentTypeId: documentTypeIds.get(slotDefinition.documentTypeSystemKey)!,
        title: slotDefinition.templateTitle,
        summary: slotDefinition.templateSummary,
        contentMarkdown: slotDefinition.templateContentMarkdown ?? '',
      });
    }

    await executor.query(
      `INSERT INTO integrated_document_slot_settings (
         tenant_id,
         source_entity_type,
         slot_key,
         display_name,
         folder_id,
         document_type_id,
         template_document_id,
         is_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (tenant_id, source_entity_type, slot_key)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         folder_id = EXCLUDED.folder_id,
         document_type_id = EXCLUDED.document_type_id,
         template_document_id = EXCLUDED.template_document_id,
         is_active = true,
         updated_at = now()`,
      [
        tenantId,
        slotDefinition.sourceEntityType,
        slotDefinition.slotKey,
        slotDefinition.displayName,
        folderIds.get(slotDefinition.folderSystemKey)!,
        documentTypeIds.get(slotDefinition.documentTypeSystemKey)!,
        templateDocumentId,
      ],
    );
  }
}
