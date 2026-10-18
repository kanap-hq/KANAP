import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { naturesAnd } from '../spend/budget-nature';
import { activeSql, readUsages, type UsageCaller, type UsageQuery, type Usages } from '../common/record-usages';

/** The contact's free-text roles on an object, trimmed, without blanks, sorted. */
const textRoles = (alias: string) =>
  `array_remove(array_agg(DISTINCT NULLIF(btrim(${alias}.role), '') ORDER BY NULLIF(btrim(${alias}.role), '')), NULL)`;
/** The contact's typed roles on an object (`supplier_contact_role`), in the type's order. */
const typedRoles = (alias: string) => `array_agg(DISTINCT ${alias}.role ORDER BY ${alias}.role)::text[]`;

/**
 * The objects a contact is linked to (`GET /contacts/:id/usages`), one row per object with the
 * contact's roles on it: suppliers, budget lines of both natures, contracts, applications, assets
 * and technologies (support contacts), locations, projects and requests.
 */
export const CONTACT_USAGE_QUERIES: readonly UsageQuery[] = [
  {
    type: 'suppliers',
    resource: 'suppliers',
    sql: `SELECT s.id, NULL::text AS reference, s.name, s.status::text AS status, ${activeSql('s')} AS active,
                 ${typedRoles('l')} AS roles, count(*) OVER () AS total
            FROM supplier_contacts l
            JOIN suppliers s ON s.tenant_id = l.tenant_id AND s.id = l.supplier_id
           WHERE l.tenant_id = $1 AND l.contact_id = $2
           GROUP BY s.id
           ORDER BY active DESC, lower(s.name), s.id
           LIMIT $3`,
  },
  {
    type: 'budget_lines',
    resource: 'budget',
    sql: `SELECT si.id, 'BL-' || si.item_number::text AS reference, si.product_name AS name, si.nature,
                 si.status::text AS status, ${activeSql('si')} AS active, ${typedRoles('l')} AS roles,
                 count(*) OVER () AS total
            FROM spend_item_contacts l
            JOIN spend_items si ON si.tenant_id = l.tenant_id AND si.id = l.spend_item_id
           WHERE l.tenant_id = $1 AND l.contact_id = $2${naturesAnd('si', ['opex', 'capex'])}
           GROUP BY si.id
           ORDER BY active DESC, si.item_number
           LIMIT $3`,
  },
  {
    type: 'contracts',
    resource: 'contracts',
    sql: `SELECT c.id, NULL::text AS reference, c.name, c.status::text AS status, ${activeSql('c')} AS active,
                 ${typedRoles('l')} AS roles, count(*) OVER () AS total
            FROM contract_contacts l
            JOIN contracts c ON c.tenant_id = l.tenant_id AND c.id = l.contract_id
           WHERE l.tenant_id = $1 AND l.contact_id = $2
           GROUP BY c.id
           ORDER BY active DESC, lower(c.name), c.id
           LIMIT $3`,
  },
  {
    type: 'applications',
    resource: 'applications',
    sql: `SELECT a.id, NULL::text AS reference, a.name, a.lifecycle AS status, ${activeSql('a')} AS active,
                 ${textRoles('l')} AS roles, count(*) OVER () AS total
            FROM application_support_contacts l
            JOIN applications a ON a.tenant_id = l.tenant_id AND a.id = l.application_id
           WHERE l.tenant_id = $1 AND l.contact_id = $2
           GROUP BY a.id
           ORDER BY active DESC, lower(a.name), a.id
           LIMIT $3`,
  },
  {
    type: 'assets',
    resource: 'infrastructure',
    sql: `SELECT a.id, NULL::text AS reference, a.name, a.status, true AS active,
                 ${textRoles('l')} AS roles, count(*) OVER () AS total
            FROM asset_support_contacts l
            JOIN assets a ON a.tenant_id = l.tenant_id AND a.id = l.asset_id
           WHERE l.tenant_id = $1 AND l.contact_id = $2
           GROUP BY a.id
           ORDER BY lower(a.name), a.id
           LIMIT $3`,
  },
  {
    type: 'technologies',
    resource: 'infrastructure',
    // A retired technology is inactive: listed after the others, marked as such.
    sql: `SELECT t.id, 'TEC-' || t.item_number::text AS reference, t.name, t.lifecycle AS status, t.lifecycle <> 'retired' AS active,
                 ${textRoles('l')} AS roles, count(*) OVER () AS total
            FROM technology_support_contacts l
            JOIN technologies t ON t.tenant_id = l.tenant_id AND t.id = l.technology_id
           WHERE l.tenant_id = $1 AND l.contact_id = $2
           GROUP BY t.id
           ORDER BY active DESC, lower(t.name), t.id
           LIMIT $3`,
  },
  {
    type: 'locations',
    resource: 'locations',
    sql: `SELECT o.id, NULL::text AS reference, o.name, NULL::text AS status, true AS active,
                 ${textRoles('l')} AS roles, count(*) OVER () AS total
            FROM location_contacts l
            JOIN locations o ON o.tenant_id = l.tenant_id AND o.id = l.location_id
           WHERE l.tenant_id = $1 AND l.contact_id = $2
           GROUP BY o.id
           ORDER BY lower(o.name), o.id
           LIMIT $3`,
  },
  {
    type: 'projects',
    resource: 'portfolio_projects',
    sql: `SELECT p.id, 'PRJ-' || p.item_number::text AS reference, p.name, p.status, true AS active,
                 ARRAY[]::text[] AS roles, count(*) OVER () AS total
            FROM portfolio_projects p
           WHERE p.tenant_id = $1
             AND EXISTS (SELECT 1 FROM portfolio_project_contacts l
                          WHERE l.tenant_id = $1 AND l.project_id = p.id AND l.contact_id = $2)
           ORDER BY p.item_number
           LIMIT $3`,
  },
  {
    type: 'requests',
    resource: 'portfolio_requests',
    sql: `SELECT r.id, 'REQ-' || r.item_number::text AS reference, r.name, r.status, true AS active,
                 ARRAY[]::text[] AS roles, count(*) OVER () AS total
            FROM portfolio_requests r
           WHERE r.tenant_id = $1
             AND EXISTS (SELECT 1 FROM portfolio_request_contacts l
                          WHERE l.tenant_id = $1 AND l.request_id = r.id AND l.contact_id = $2)
           ORDER BY r.item_number
           LIMIT $3`,
  },
];

export async function readContactUsages(
  manager: EntityManager,
  tenantId: string,
  contactId: string,
  caller: UsageCaller,
): Promise<Usages> {
  const [contact] = await manager.query(`SELECT 1 FROM contacts WHERE tenant_id = $1 AND id = $2`, [tenantId, contactId]);
  if (!contact) throw new NotFoundException('Contact not found');
  return readUsages(manager, tenantId, contactId, caller, CONTACT_USAGE_QUERIES);
}
