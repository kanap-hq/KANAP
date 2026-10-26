import type { EntityManager } from 'typeorm';
import { hasLevel } from './relations-access';

/**
 * The modules a record can link to, each with the permission resource that reads it. A linked
 * record shows (name, reference, description, count) only to a person who reads its module, as on
 * the record's own page: the family is left out otherwise, with no counter and no mention.
 */
export const LINKED_MODULE_RESOURCES = {
  applications: 'applications',
  assets: 'infrastructure',
  technologies: 'infrastructure',
  projects: 'portfolio_projects',
  requests: 'portfolio_requests',
  tasks: 'tasks',
  contracts: 'contracts',
  budget: 'budget',
  incidents: 'incidents',
  documents: 'knowledge',
  business_processes: 'business_processes',
} as const;

export type LinkedModule = keyof typeof LINKED_MODULE_RESOURCES;

/** One flag per linked module: true when the person reads it. */
export type LinkedReads = Record<LinkedModule, boolean>;

const MODULES = Object.keys(LINKED_MODULE_RESOURCES) as LinkedModule[];
const RESOURCES = Array.from(new Set(Object.values(LINKED_MODULE_RESOURCES)));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readsFrom(canRead: (resource: string) => boolean): LinkedReads {
  const reads = {} as LinkedReads;
  for (const module of MODULES) reads[module] = canRead(LINKED_MODULE_RESOURCES[module]);
  return reads;
}

/** Nothing readable: what a caller gets without a known, enabled person. */
export const NO_LINKED_READS: LinkedReads = readsFrom(() => false);

/** The reads of a request already through the permission guard (`isAdmin`, `permissions`). */
export function linkedReadsFromContext(ctx: { isAdmin?: boolean; permissions?: Record<string, string> }): LinkedReads {
  return readsFrom((resource) => hasLevel(ctx, resource, 'reader'));
}

/**
 * The reads of a person from their roles, in one query: for services reached without the request's
 * permissions (documents, the assistant). Any level reads. An unknown or disabled person reads nothing.
 */
export async function loadLinkedReads(
  manager: EntityManager,
  userId: string | null | undefined,
  tenantId?: string | null,
): Promise<LinkedReads> {
  const user = String(userId || '').trim();
  if (!UUID_RE.test(user)) return NO_LINKED_READS;
  const tenant = String(tenantId || '').trim();
  const params: unknown[] = [user, RESOURCES];
  // The session tenant when the caller has none at hand (the manager is bound to it).
  let tenantSql = 'app_current_tenant()';
  if (UUID_RE.test(tenant)) {
    params.push(tenant);
    tenantSql = '$3::uuid';
  }
  const rows: Array<{ is_administrator: boolean | null; resource: string | null }> = await manager.query(
    `WITH ctx AS (
       SELECT u.id, u.role_id, u.tenant_id
       FROM users u
       WHERE u.id = $1::uuid
         AND u.tenant_id = ${tenantSql}
         AND u.status = 'enabled'
     ),
     role_ids AS (
       SELECT c.role_id FROM ctx c WHERE c.role_id IS NOT NULL
       UNION
       SELECT ur.role_id FROM user_roles ur JOIN ctx c ON c.id = ur.user_id AND c.tenant_id = ur.tenant_id
     )
     SELECT EXISTS (
              SELECT 1 FROM role_ids ri JOIN roles r ON r.id = ri.role_id AND r.tenant_id = (SELECT tenant_id FROM ctx)
              WHERE lower(trim(coalesce(r.role_name, ''))) = 'administrator'
            ) AS is_administrator,
            rp.resource
     FROM ctx
     LEFT JOIN role_permissions rp
       ON rp.tenant_id = ctx.tenant_id
      AND rp.role_id IN (SELECT role_id FROM role_ids)
      AND rp.resource = ANY($2::text[])`,
    params,
  );
  if (rows.length === 0) return NO_LINKED_READS;
  if (rows.some((row) => row.is_administrator === true)) return readsFrom(() => true);
  const granted = new Set(rows.map((row) => row.resource).filter((resource): resource is string => !!resource));
  return readsFrom((resource) => granted.has(resource));
}
