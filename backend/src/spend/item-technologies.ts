import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AmountScope } from './amounts-write.util';
import { natureAnd, type BudgetNature } from './budget-nature';
import { assertLinesEditable } from '../data-access/line-write-checks';

/**
 * Technologies linked to an OPEX or CAPEX line, from the line's side, on the model of its
 * applications (`item-applications.ts`): list and replace the whole set. Every statement carries
 * the line's tenant besides RLS. A replacement locks the line's row first (FOR NO KEY UPDATE): a
 * second replacement of the same line waits, then reads the set the first one committed, so the
 * last one wins and its audit row matches what is stored. A link written meanwhile from the
 * technology's side (which locks the technology's row) is skipped by the unique key
 * (tenant_id, technology_id, spend_item_id) and `ON CONFLICT DO NOTHING`.
 */

// Table names come only from here. `nature`: the scope's lines in `spend_items` (`budget-nature.ts`);
// a line of another nature is not found. `technology_spend_items` holds the links of both natures.
const SCOPES: Record<AmountScope, { itemNotFound: string; nature: BudgetNature }> = {
  opex: { itemNotFound: 'Spend item not found', nature: 'opex' },
  capex: { itemNotFound: 'CAPEX item not found', nature: 'capex' },
};

const LINKS = 'technology_spend_items';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TECHNOLOGIES_NOT_FOUND = 'One or more technologies were not found.';

/** The line, as read under the current tenant (its `tenant_id` scopes every statement). */
export type TechnologiesItem = { id: string; tenant_id: string };

export type ItemTechnologiesDeps = {
  manager: EntityManager;
  audit: Pick<AuditService, 'log'>;
};

export type ItemTechnology = { id: string; name: string; reference: string };

export async function listItemTechnologies(manager: EntityManager, item: TechnologiesItem): Promise<{ items: ItemTechnology[] }> {
  const rows: ItemTechnology[] = await manager.query(
    `SELECT t.id, t.name, 'TEC-' || t.item_number AS reference
       FROM ${LINKS} l
       JOIN technologies t ON t.tenant_id = l.tenant_id AND t.id = l.technology_id
      WHERE l.tenant_id = $1 AND l.spend_item_id = $2
      ORDER BY t.name ASC, t.id ASC`,
    [item.tenant_id, item.id],
  );
  return { items: rows };
}

/**
 * Replace the line's technologies with `technologyIds` (trimmed, deduplicated). Every id must name
 * a technology of the tenant (400 otherwise, nothing written). One audit row on the link table
 * when the set changes: `recordId` the line, before and after the sorted technology ids.
 */
export async function replaceItemTechnologies(
  deps: ItemTechnologiesDeps,
  scope: AmountScope,
  item: TechnologiesItem,
  technologyIds: string[],
  userId: string | null,
) {
  const { manager } = deps;
  const t = SCOPES[scope];
  // Stored ids are lower case: an upper-case id must compare equal to its stored twin.
  const nextIds = Array.from(new Set((technologyIds || []).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean))).sort();
  if (nextIds.some((id) => !UUID_RE.test(id))) throw new BadRequestException(TECHNOLOGIES_NOT_FOUND);
  const locked = await manager.query(
    `SELECT 1 FROM spend_items WHERE tenant_id = $1 AND id = $2${natureAnd(null, t.nature)} FOR NO KEY UPDATE`,
    [item.tenant_id, item.id],
  );
  if (locked.length === 0) {
    // A readable line the person may not modify takes no lock: the clear 403, else absent.
    await assertLinesEditable(manager, [item.id]);
    throw new NotFoundException(t.itemNotFound);
  }
  if (nextIds.length) {
    const found: Array<{ id: string }> = await manager.query(
      `SELECT id FROM technologies WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [item.tenant_id, nextIds],
    );
    if (found.length !== nextIds.length) throw new BadRequestException(TECHNOLOGIES_NOT_FOUND);
  }

  const current: Array<{ technology_id: string }> = await manager.query(
    `SELECT DISTINCT technology_id FROM ${LINKS} WHERE tenant_id = $1 AND spend_item_id = $2`,
    [item.tenant_id, item.id],
  );
  const beforeIds = current.map((row) => row.technology_id).sort();
  const removed = beforeIds.filter((id) => !nextIds.includes(id));
  const added = nextIds.filter((id) => !beforeIds.includes(id));

  if (removed.length) {
    await manager.query(
      `DELETE FROM ${LINKS} WHERE tenant_id = $1 AND spend_item_id = $2 AND technology_id = ANY($3::uuid[])`,
      [item.tenant_id, item.id, removed],
    );
  }
  if (added.length) {
    await manager.query(
      `INSERT INTO ${LINKS} (tenant_id, spend_item_id, technology_id)
       SELECT $1, $2, technology_id FROM unnest($3::uuid[]) AS technology_id
       ON CONFLICT (tenant_id, technology_id, spend_item_id) DO NOTHING`,
      [item.tenant_id, item.id, added],
    );
  }
  if (removed.length || added.length) {
    await deps.audit.log(
      { table: LINKS, recordId: item.id, action: 'update', before: beforeIds, after: nextIds, userId },
      { manager },
    );
  }
  return listItemTechnologies(manager, item);
}
