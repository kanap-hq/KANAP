import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { withSavepoint } from '../common/savepoint.util';
import { SupplierContactRole } from './supplier-contact.entity';

/**
 * Manual attach of a contact to an OPEX line, a CAPEX line or a contract,
 * idempotent (plan planning/perf-scale, lot 3A, Annexe A #14).
 *
 * Each link table is unique on (tenant_id, owner, contact_id, role). The
 * insert is `ON CONFLICT DO NOTHING` on that key, then the link of the key is
 * read: two users attaching the same contact and role at once, or a manual
 * attach meeting the supplier sync, both succeed with one link (the one
 * committed first, whatever its origin), instead of a unique violation.
 */
const TABLES = {
  spend_item_contacts: 'spend_item_id',
  capex_item_contacts: 'capex_item_id',
  contract_contacts: 'contract_id',
} as const;

export type ContactLinkTable = keyof typeof TABLES;

export async function attachManualContactLink(
  manager: EntityManager,
  table: ContactLinkTable,
  link: { tenantId: string; ownerId: string; contactId: string; role: SupplierContactRole },
): Promise<{ id: string; created: boolean }> {
  const ownerFk = TABLES[table];
  const params = [link.tenantId, link.ownerId, link.contactId, link.role];
  // A second pass only when the link met on insert was removed before it could be read.
  for (let attempt = 0; ; attempt++) {
    const inserted: Array<{ id: string }> = await manager.query(
      `INSERT INTO ${table} (tenant_id, ${ownerFk}, contact_id, role, origin)
       VALUES ($1, $2, $3, $4, 'manual')
       ON CONFLICT (tenant_id, ${ownerFk}, contact_id, role) DO NOTHING
       RETURNING id`,
      params,
    );
    if (inserted[0]) return { id: inserted[0].id, created: true };
    const [existing] = await manager.query(
      `SELECT id FROM ${table} WHERE tenant_id = $1 AND ${ownerFk} = $2 AND contact_id = $3 AND role = $4`,
      params,
    );
    if (existing) return { id: existing.id, created: false };
    if (attempt >= 1) throw new ConflictException(LINK_REMOVED);
  }
}

/** Only when another request removes the link between two statements of the attach. */
export const LINK_REMOVED = 'The contact was removed from this record meanwhile. Please try again.';

/**
 * The supplier contact sync that follows a supplier change inside a line or
 * contract update. It runs under its own savepoint and never fails the update
 * (a lock wait that gives up, a link changed meanwhile): the update is kept,
 * the failure logged, and the contacts stay as they were until the next sync.
 */
export async function syncSupplierContactsWithinUpdate(manager: EntityManager, owner: string, sync: () => Promise<void>): Promise<void> {
  try {
    await withSavepoint(manager, sync);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[contacts] supplier contacts of ${owner} not synced, the update is kept: ${(error as Error)?.message ?? error}`);
  }
}
