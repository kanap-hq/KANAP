import { naturesAnd } from '../spend/budget-nature';
import { activeSql, type UsageQuery } from '../common/record-usages';

/**
 * The objects that keep a company from being deleted, read like a supplier's usages
 * (`suppliers/supplier-usages.ts`): budget lines of both natures that it pays or that allocate to
 * it, contracts, and the cost centers that belong to it. There is no "Used by" panel for a
 * company yet; these are the delete check's groups.
 */
export const COMPANY_USAGE_QUERIES: readonly UsageQuery[] = [
  {
    type: 'budget_lines',
    resource: 'budget',
    sql: `SELECT si.id, 'BL-' || si.item_number::text AS reference, si.product_name AS name, si.nature,
                 si.status::text AS status, ${activeSql('si')} AS active, count(*) OVER () AS total
            FROM spend_items si
           WHERE si.tenant_id = $1${naturesAnd('si', ['opex', 'capex'])}
             AND (si.paying_company_id = $2
                  OR EXISTS (SELECT 1 FROM spend_versions v
                               JOIN spend_allocations a ON a.tenant_id = $1 AND a.version_id = v.id
                              WHERE v.tenant_id = $1 AND v.spend_item_id = si.id AND a.company_id = $2))
           ORDER BY active DESC, si.item_number
           LIMIT $3`,
  },
  {
    type: 'contracts',
    resource: 'contracts',
    sql: `SELECT c.id, NULL::text AS reference, c.name, c.status::text AS status, ${activeSql('c')} AS active,
                 count(*) OVER () AS total
            FROM contracts c
           WHERE c.tenant_id = $1 AND c.company_id = $2
           ORDER BY active DESC, lower(c.name), c.id
           LIMIT $3`,
  },
  {
    type: 'cost_centers',
    resource: 'cost_centers',
    sql: `SELECT cc.id, cc.code AS reference, cc.name, cc.status::text AS status, ${activeSql('cc')} AS active,
                 count(*) OVER () AS total
            FROM cost_centers cc
           WHERE cc.tenant_id = $1 AND cc.company_id = $2
           ORDER BY active DESC, cc.code, cc.id
           LIMIT $3`,
  },
];
