import type { EntityManager } from 'typeorm';
import { loadSlotBodies, sameSlotBody } from '../knowledge/integrated-document-bodies';
import type { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';

/**
 * The description of an application is the text of its `overview` document (decision P14 of
 * 26.12.1): the page shows it, the import, the API and Kad write it, the export, Kad, the MCP server
 * and the delete read it. The column `applications.description` is its seed only: the text the
 * document starts from when the page first opens the application (`repairSourceSlot`), read while
 * no document exists. Once the document exists nothing reads the column (the search index carries no
 * description since migration 1856300000000): the import, the API and Kad still write it with the
 * document, an edit of the document on the page leaves it behind, and it is never copied back into it.
 */
export const APPLICATION_DESCRIPTION_SLOT = 'overview' as const;

/** The description of the application `alias` names in SQL: its document's text, else the seed. */
export function applicationDescriptionSql(alias: string): string {
  return `COALESCE((SELECT COALESCE(dd.content_markdown, '')
      FROM integrated_document_bindings db
      JOIN documents dd ON dd.id = db.document_id AND dd.tenant_id = db.tenant_id
     WHERE db.tenant_id = ${alias}.tenant_id AND db.source_entity_type = 'applications'
       AND db.source_entity_id = ${alias}.id AND db.slot_key = '${APPLICATION_DESCRIPTION_SLOT}'), ${alias}.description)`;
}

/**
 * The descriptions of some applications, by id: the text of each one's document, else (no document
 * yet) its seed, `description` as given. One query.
 */
export async function applicationDescriptions(
  manager: { query: (sql: string, params: unknown[]) => Promise<any[]> },
  tenantId: string,
  apps: ReadonlyArray<{ id: string; description?: string | null }>,
): Promise<Map<string, string | null>> {
  const ids = apps.map((app) => String(app.id));
  const bodies = await loadSlotBodies(manager, tenantId, 'applications', ids, [APPLICATION_DESCRIPTION_SLOT]);
  return new Map(apps.map((app) => [String(app.id), bodies.get(String(app.id))?.get(APPLICATION_DESCRIPTION_SLOT) ?? app.description ?? null]));
}

type DescriptionWriteOpts = {
  manager: EntityManager;
  userId?: string | null;
  /** The source of the document's history row (Kad's card); without it, the person's. */
  audit?: { source?: string; sourceRef?: string | null };
};

/**
 * Before a write changes the description of an application that has no document yet, while its
 * column still holds the text it replaces: the document the page makes of that seed when it first
 * opens the application (`repairSourceSlot`, as `repairBeforeSlotWrite` for the projects), so the
 * document's history starts from the replaced text. Nothing when the document exists.
 */
export async function keepApplicationSeed(documents: IntegratedDocumentsService, applicationId: string, opts: DescriptionWriteOpts): Promise<void> {
  await documents.repairSourceSlot('applications', applicationId, APPLICATION_DESCRIPTION_SLOT, {
    manager: opts.manager,
    actorUserId: opts.userId ?? null,
    audit: opts.audit,
  });
}

/**
 * The description written into the application's document, a new version of it (the document is
 * created with it when the application has none). Nothing when the text is the document's already.
 */
export async function writeApplicationDescription(
  documents: IntegratedDocumentsService,
  app: { id: string; tenant_id: string; name: string; sequential_id?: string | null },
  description: string | null | undefined,
  opts: DescriptionWriteOpts,
): Promise<void> {
  await documents.writeSourceSlotContent(
    'applications',
    { id: app.id, tenant_id: app.tenant_id, item_number: null, name: app.name, reference_label: String(app.sequential_id || '').trim() || app.id },
    APPLICATION_DESCRIPTION_SLOT,
    description ?? '',
    opts.userId ?? null,
    // The application's own history row says the description changed (its `description`): no other.
    { manager: opts.manager, logSourceActivity: false, audit: opts.audit },
  );
}

/** Gives each application its description as the page shows it (`applicationDescriptions`), in place. */
export async function withApplicationDescriptions<T extends { id: string; description?: string | null }>(
  manager: { query: (sql: string, params: unknown[]) => Promise<any[]> },
  tenantId: string,
  apps: T[],
): Promise<T[]> {
  if (apps.length === 0) return apps;
  const descriptions = await applicationDescriptions(manager, tenantId, apps);
  for (const app of apps) app.description = descriptions.get(String(app.id)) ?? null;
  return apps;
}

/** Whether `value` says what the stored description says (both normalized as a write normalizes them). */
export function sameApplicationDescription(stored: string | null | undefined, value: unknown): Promise<boolean> {
  return sameSlotBody(stored ?? '', value, 'description');
}
