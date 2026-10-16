import { naturesAnd } from '../spend/budget-nature';
import { activeSql, type UsageQuery } from '../common/record-usages';

/**
 * The objects that keep a company from being deleted, read like a supplier's usages
 * (`suppliers/supplier-usages.ts`): budget lines of both natures that it pays or that allocate to
 * it, the default allocation methods of the years that spread over it, contracts, cost centers,
 * departments, users, locations it operates, tasks, applications, interfaces, portfolio projects
 * and requests, and the team members it is the default company of. Every key into companies is ON DELETE RESTRICT (migration 1854090000000) except its own
 * yearly metrics, which go with it. There is no "Used by" panel for a company yet; these are the
 * delete check's groups.
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
    // A year's default allocation method spread over chosen companies: an array, which no foreign key covers.
    type: 'allocation_rules',
    resource: 'budget_ops',
    sql: `SELECT r.id, NULL::text AS reference, r.fiscal_year::text AS name, r.status, true AS active, count(*) OVER () AS total
            FROM allocation_rules r
           WHERE r.tenant_id = $1 AND $2 = ANY (r.company_ids)
           ORDER BY r.fiscal_year, r.id
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
  {
    type: 'departments',
    resource: 'departments',
    sql: `SELECT d.id, NULL::text AS reference, d.name, d.status::text AS status, ${activeSql('d')} AS active,
                 count(*) OVER () AS total
            FROM departments d
           WHERE d.tenant_id = $1 AND d.company_id = $2
           ORDER BY active DESC, lower(d.name), d.id
           LIMIT $3`,
  },
  {
    type: 'users',
    resource: 'users',
    sql: `SELECT u.id, NULL::text AS reference, trim(concat_ws(' ', u.first_name, u.last_name)) AS name, u.status,
                 u.status = 'enabled' AS active, count(*) OVER () AS total
            FROM users u
           WHERE u.tenant_id = $1 AND u.company_id = $2
           ORDER BY active DESC, lower(u.last_name), lower(u.first_name), u.id
           LIMIT $3`,
  },
  {
    type: 'locations',
    resource: 'locations',
    sql: `SELECT l.id, NULL::text AS reference, l.name, NULL::text AS status, true AS active, count(*) OVER () AS total
            FROM locations l
           WHERE l.tenant_id = $1 AND l.operating_company_id = $2
           ORDER BY lower(l.name), l.id
           LIMIT $3`,
  },
  {
    type: 'tasks',
    resource: 'tasks',
    sql: `SELECT t.id, 'T-' || t.item_number::text AS reference, t.title AS name, t.status, true AS active,
                 count(*) OVER () AS total
            FROM tasks t
           WHERE t.tenant_id = $1 AND t.company_id = $2
           ORDER BY t.item_number, t.id
           LIMIT $3`,
  },
  {
    type: 'applications',
    resource: 'applications',
    sql: `SELECT a.id, NULL::text AS reference, a.name, a.lifecycle AS status, ${activeSql('a')} AS active,
                 count(*) OVER () AS total
            FROM applications a
           WHERE a.tenant_id = $1
             AND EXISTS (SELECT 1 FROM application_companies l
                          WHERE l.tenant_id = $1 AND l.application_id = a.id AND l.company_id = $2)
           ORDER BY active DESC, lower(a.name), a.id
           LIMIT $3`,
  },
  {
    type: 'interfaces',
    resource: 'applications',
    sql: `SELECT i.id, i.interface_id AS reference, i.name, i.lifecycle AS status, true AS active, count(*) OVER () AS total
            FROM interfaces i
           WHERE i.tenant_id = $1
             AND EXISTS (SELECT 1 FROM interface_companies l
                          WHERE l.tenant_id = $1 AND l.interface_id = i.id AND l.company_id = $2)
           ORDER BY lower(i.name), i.id
           LIMIT $3`,
  },
  {
    type: 'projects',
    resource: 'portfolio_projects',
    sql: `SELECT p.id, 'PRJ-' || p.item_number::text AS reference, p.name, p.status, true AS active, count(*) OVER () AS total
            FROM portfolio_projects p
           WHERE p.tenant_id = $1 AND p.company_id = $2
           ORDER BY p.item_number, p.id
           LIMIT $3`,
  },
  {
    type: 'requests',
    resource: 'portfolio_requests',
    sql: `SELECT r.id, 'REQ-' || r.item_number::text AS reference, r.name, r.status, true AS active, count(*) OVER () AS total
            FROM portfolio_requests r
           WHERE r.tenant_id = $1 AND r.company_id = $2
           ORDER BY r.item_number, r.id
           LIMIT $3`,
  },
  {
    type: 'team_members',
    resource: 'portfolio_settings',
    sql: `SELECT m.id, NULL::text AS reference, trim(concat_ws(' ', u.first_name, u.last_name)) AS name, NULL::text AS status,
                 true AS active, count(*) OVER () AS total
            FROM portfolio_team_member_configs m
            LEFT JOIN users u ON u.tenant_id = $1 AND u.id = m.user_id
           WHERE m.tenant_id = $1 AND m.default_company_id = $2
           ORDER BY lower(u.last_name), m.id
           LIMIT $3`,
  },
];
