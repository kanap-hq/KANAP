import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { naturesAnd } from '../spend/budget-nature';
import { activeSql, readUsages, type UsageCaller, type UsageQuery, type Usages } from '../common/record-usages';

/**
 * The objects that name a supplier (`GET /suppliers/:id/usages`): budget lines of both natures,
 * contracts, applications and assets (support vendor). Its contacts are on the Contacts tab.
 */
export const SUPPLIER_USAGE_QUERIES: readonly UsageQuery[] = [
  {
    type: 'budget_lines',
    resource: 'budget',
    sql: `SELECT si.id, 'BL-' || si.item_number::text AS reference, si.product_name AS name, si.nature,
                 si.status::text AS status, ${activeSql('si')} AS active, count(*) OVER () AS total
            FROM spend_items si
           WHERE si.tenant_id = $1 AND si.supplier_id = $2${naturesAnd('si', ['opex', 'capex'])}
           ORDER BY active DESC, si.item_number
           LIMIT $3`,
  },
  // Read by the supplier delete check and the Used-by panel. The delete routes are reserved to
  // unscoped persons (`@ReservedToUnscopedDataAccess`), and a limited person's panel only sees the
  // contracts the policy lets them read: the count never names a hidden contract (lot 5).
  {
    type: 'contracts',
    resource: 'contracts',
    sql: `SELECT c.id, NULL::text AS reference, c.name, c.status::text AS status, ${activeSql('c')} AS active,
                 count(*) OVER () AS total
            FROM contracts c
           WHERE c.tenant_id = $1 AND c.supplier_id = $2
           ORDER BY active DESC, lower(c.name), c.id
           LIMIT $3`,
  },
  {
    type: 'applications',
    resource: 'applications',
    sql: `SELECT a.id, NULL::text AS reference, a.name, a.lifecycle AS status, ${activeSql('a')} AS active,
                 count(*) OVER () AS total
            FROM applications a
           WHERE a.tenant_id = $1 AND a.supplier_id = $2
           ORDER BY active DESC, lower(a.name), a.id
           LIMIT $3`,
  },
  {
    type: 'assets',
    resource: 'infrastructure',
    sql: `SELECT a.id, NULL::text AS reference, a.name, a.status, true AS active, count(*) OVER () AS total
            FROM assets a
           WHERE a.tenant_id = $1
             AND EXISTS (SELECT 1 FROM asset_support_info i
                          WHERE i.tenant_id = $1 AND i.asset_id = a.id AND i.vendor_id = $2)
           ORDER BY lower(a.name), a.id
           LIMIT $3`,
  },
];

export async function readSupplierUsages(
  manager: EntityManager,
  tenantId: string,
  supplierId: string,
  caller: UsageCaller,
): Promise<Usages> {
  const [supplier] = await manager.query(`SELECT 1 FROM suppliers WHERE tenant_id = $1 AND id = $2`, [tenantId, supplierId]);
  if (!supplier) throw new NotFoundException('Supplier not found');
  return readUsages(manager, tenantId, supplierId, caller, SUPPLIER_USAGE_QUERIES);
}
