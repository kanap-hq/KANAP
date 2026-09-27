import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AmountScope } from './amounts-write.util';

/**
 * Applications linked to an OPEX or CAPEX line, from the line's side: list and
 * replace the whole set. Every statement carries the line's tenant besides RLS.
 * Replacing the whole set cannot create duplicates, so `application_capex_items`
 * needs no unique constraint for this path.
 */

// Table and column names come only from here: never from the caller.
const SCOPES = {
  opex: { links: 'application_spend_items', itemFk: 'spend_item_id' },
  capex: { links: 'application_capex_items', itemFk: 'capex_item_id' },
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The line, as read under the current tenant (its `tenant_id` scopes every statement). */
export type ApplicationsItem = { id: string; tenant_id: string };

export type ItemApplicationsDeps = {
  manager: EntityManager;
  audit: Pick<AuditService, 'log'>;
};

export async function listItemApplications(manager: EntityManager, scope: AmountScope, item: ApplicationsItem) {
  const t = SCOPES[scope];
  const rows: Array<{ id: string; name: string }> = await manager.query(
    `SELECT l.application_id AS id, a.name
     FROM ${t.links} l
     JOIN applications a ON a.id = l.application_id AND a.tenant_id = l.tenant_id
     WHERE l.tenant_id = $1 AND l.${t.itemFk} = $2
     ORDER BY a.name ASC, l.application_id ASC`,
    [item.tenant_id, item.id],
  );
  return { items: rows };
}

/**
 * Replace the line's applications with `applicationIds` (trimmed, deduplicated).
 * Every id must name an application of the tenant (400 otherwise). One audit
 * row on the link table when the set changes: `recordId` the line, before and
 * after the sorted application ids, as the AI relation path writes it.
 */
export async function replaceItemApplications(
  deps: ItemApplicationsDeps,
  scope: AmountScope,
  item: ApplicationsItem,
  applicationIds: string[],
  userId: string | null,
) {
  const { manager } = deps;
  const t = SCOPES[scope];
  // Stored ids are lower case: an upper-case id must compare equal to its stored twin.
  const nextIds = Array.from(new Set((applicationIds || []).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean))).sort();
  if (nextIds.length) {
    if (nextIds.some((id) => !UUID_RE.test(id))) throw new BadRequestException('One or more applications not found');
    const found: Array<{ id: string }> = await manager.query(
      `SELECT id FROM applications WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [item.tenant_id, nextIds],
    );
    if (found.length !== nextIds.length) throw new BadRequestException('One or more applications not found');
  }

  const current: Array<{ application_id: string }> = await manager.query(
    `SELECT DISTINCT application_id FROM ${t.links} WHERE tenant_id = $1 AND ${t.itemFk} = $2`,
    [item.tenant_id, item.id],
  );
  const beforeIds = current.map((r) => r.application_id).sort();

  await manager.query(`DELETE FROM ${t.links} WHERE tenant_id = $1 AND ${t.itemFk} = $2`, [item.tenant_id, item.id]);
  if (nextIds.length) {
    await manager.query(
      `INSERT INTO ${t.links} (tenant_id, ${t.itemFk}, application_id)
       SELECT $1, $2, app_id FROM unnest($3::uuid[]) AS app_id`,
      [item.tenant_id, item.id, nextIds],
    );
  }

  if (JSON.stringify(beforeIds) !== JSON.stringify(nextIds)) {
    await deps.audit.log(
      { table: t.links, recordId: item.id, action: 'update', before: beforeIds, after: nextIds, userId },
      { manager },
    );
  }
  return listItemApplications(manager, scope, item);
}
