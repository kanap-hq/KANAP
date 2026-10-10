import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AmountScope } from './amounts-write.util';
import { assertScopeNatures, natureAnd, type BudgetNature } from './budget-nature';

/**
 * Applications linked to an OPEX or CAPEX line, from the line's side: list and
 * replace the whole set. Every statement carries the line's tenant besides RLS.
 * A replacement locks the line's row first (FOR NO KEY UPDATE, which the link
 * keys' FOR KEY SHARE checks do not wait for): a second replacement of the
 * same line waits, then reads the set the first one committed, so the last
 * one wins and its audit row matches what is stored. Writers that take no
 * lock (the AI relation path) cannot store a link twice either: the unique key
 * (tenant_id, application_id, item) of each link table (migration
 * 1853690000000) makes the second insert wait and skip the committed link.
 */

// Table and column names come only from here: never from the caller. `nature`: the scope's lines in
// `spend_items` (`budget-nature.ts`); a line of another nature is not found.
const SCOPES: Record<AmountScope, { links: string; itemFk: string; items: string; itemNotFound: string; nature?: BudgetNature }> = {
  opex: { links: 'application_spend_items', itemFk: 'spend_item_id', items: 'spend_items', itemNotFound: 'Spend item not found', nature: 'opex' },
  capex: { links: 'application_capex_items', itemFk: 'capex_item_id', items: 'capex_items', itemNotFound: 'CAPEX item not found' },
};
assertScopeNatures('item-applications', SCOPES, (t) => t.items);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPLICATIONS_NOT_FOUND = 'One or more applications were not found.';

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
  if (nextIds.some((id) => !UUID_RE.test(id))) throw new BadRequestException(APPLICATIONS_NOT_FOUND);
  const locked = await manager.query(
    `SELECT 1 FROM ${t.items} WHERE tenant_id = $1 AND id = $2${natureAnd(null, t.nature)} FOR NO KEY UPDATE`,
    [item.tenant_id, item.id],
  );
  if (locked.length === 0) throw new NotFoundException(t.itemNotFound);
  if (nextIds.length) {
    const found: Array<{ id: string }> = await manager.query(
      `SELECT id FROM applications WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [item.tenant_id, nextIds],
    );
    if (found.length !== nextIds.length) throw new BadRequestException(APPLICATIONS_NOT_FOUND);
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
       SELECT $1, $2, app_id FROM unnest($3::uuid[]) AS app_id
       ON CONFLICT (tenant_id, application_id, ${t.itemFk}) DO NOTHING`,
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
