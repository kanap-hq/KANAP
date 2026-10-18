import type { EntityManager } from 'typeorm';

/**
 * Where a record is used: the objects that point at a supplier or a contact, grouped by type
 * (`GET /suppliers/:id/usages`, `GET /contacts/:id/usages`). Each group is read by one statement
 * with an explicit tenant predicate on every table it reads, and only when the caller may read
 * the group's objects: a group whose page the caller cannot open is left out. Empty groups are
 * left out too.
 */

/** The most objects a group lists; `total` still counts them all. */
export const USAGE_GROUP_LIMIT = 50;

export type UsageType =
  | 'budget_lines'
  | 'allocation_rules'
  | 'contracts'
  | 'applications'
  | 'assets'
  | 'technologies'
  | 'cost_centers'
  | 'departments'
  | 'users'
  | 'locations'
  | 'tasks'
  | 'interfaces'
  | 'projects'
  | 'requests'
  | 'team_members'
  | 'suppliers';

export type UsageItem = {
  id: string;
  /** Business reference (`BL-12`, `PRJ-3`, `REQ-4`), null for objects that have none. */
  reference: string | null;
  name: string;
  /** Budget lines only. */
  nature?: 'opex' | 'capex';
  /** The stored status (budget lines and contracts: `enabled`/`disabled`; applications: lifecycle; portfolio: workflow status). */
  status: string | null;
  /** False once the object is disabled or past its end of validity. */
  active: boolean;
  /** Contact usages only: the contact's roles on the object (types or free text, by group). */
  roles?: string[];
};

export type UsageGroup = { type: UsageType; total: number; items: UsageItem[] };
export type Usages = { total: number; groups: UsageGroup[] };

/** What PermissionGuard leaves on the request (`@Tenant()` hands it on). */
export type UsageCaller = { isAdmin?: boolean; permissions?: Record<string, string> };

/**
 * One group's statement. Parameters: `$1` tenant id, `$2` record id, `$3` limit. Columns: `id`,
 * `reference`, `name`, `status`, `active`, `total` (`count(*) OVER ()`), and `nature` or `roles`
 * where the group has them.
 */
export type UsageQuery = { type: UsageType; resource: string; sql: string };

const RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

/** Whether the caller reads `resource` (an administrator reads everything). */
export function canReadResource(caller: UsageCaller, resource: string): boolean {
  if (caller.isAdmin) return true;
  return (RANK[caller.permissions?.[resource] ?? ''] ?? 0) >= RANK.reader;
}

type Row = {
  id: string;
  reference: string | null;
  name: string | null;
  status: string | null;
  active: boolean;
  total: string | number;
  nature?: 'opex' | 'capex';
  roles?: string[] | null;
};

export async function readUsages(
  manager: EntityManager,
  tenantId: string,
  recordId: string,
  caller: UsageCaller,
  queries: readonly UsageQuery[],
): Promise<Usages> {
  const groups: UsageGroup[] = [];
  // One statement per group, in turn: they share the request's connection.
  for (const query of queries) {
    if (!canReadResource(caller, query.resource)) continue;
    const rows: Row[] = await manager.query(query.sql, [tenantId, recordId, USAGE_GROUP_LIMIT]);
    if (rows.length === 0) continue;
    groups.push({
      type: query.type,
      total: Number(rows[0].total),
      items: rows.map((row) => ({
        id: row.id,
        reference: row.reference ?? null,
        name: row.name ?? '',
        ...(row.nature ? { nature: row.nature } : {}),
        status: row.status ?? null,
        active: row.active !== false,
        ...(row.roles !== undefined ? { roles: (row.roles ?? []).filter((role) => typeof role === 'string' && role.length > 0) } : {}),
      })),
    });
  }
  return { total: groups.reduce((sum, group) => sum + group.total, 0), groups };
}

/** `active` of a record with an enabled/disabled status and an end of validity. */
export function activeSql(alias: string): string {
  return `(${alias}.status::text = 'enabled' AND (${alias}.disabled_at IS NULL OR ${alias}.disabled_at > now()))`;
}
