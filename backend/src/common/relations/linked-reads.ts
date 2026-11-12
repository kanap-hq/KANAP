import type { EntityManager } from 'typeorm';
import { hasLevel } from './relations-access';
import { codedForbidden, outsideParticipation } from '../../auth/module-right-required';
import { resolveBusinessContributorScopeForUser, type ParticipationAccessScope } from '../../auth/business-contributor-scope';
import { idsInScope } from '../../portfolio/portfolio-linked-reads';

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
/** The older names a role row may still carry (`permissions.service.ts` RESOURCE_ALIASES). */
const RESOURCE_ALIASES: Record<string, string> = { opex: 'budget', capex: 'budget' };
const RESOURCES = [...new Set(Object.values(LINKED_MODULE_RESOURCES)), ...Object.keys(RESOURCE_ALIASES)];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readsFrom(canRead: (resource: string) => boolean): LinkedReads {
  const reads = {} as LinkedReads;
  for (const module of MODULES) reads[module] = canRead(LINKED_MODULE_RESOURCES[module]);
  return reads;
}

/**
 * A write that links records of `module` (a replacement of the links, even an empty one, which would
 * remove links the person does not see) needs a read of that module, as the Relations tab shows it:
 * 403 `LINKED_MODULE_NOT_READABLE` otherwise, the code of the same rule on a document's links
 * (`KnowledgeService.assertRelationWriteAllowed`). For a request already through the permission guard.
 */
export function assertLinkedModuleRead(ctx: { isAdmin?: boolean; permissions?: Record<string, string> } | null | undefined, module: LinkedModule): void {
  const resource = LINKED_MODULE_RESOURCES[module];
  if (!hasLevel(ctx ?? {}, resource, 'reader')) {
    throw codedForbidden('LINKED_MODULE_NOT_READABLE', `You cannot change the ${module} linked here: you do not read that module.`, { resources: [resource] });
  }
}

/** The linked modules a Business Contributor reads inside their participation only, with their resource. */
const PARTICIPATION_RESOURCES: Partial<Record<LinkedModule, string>> = {
  projects: 'portfolio_projects',
  requests: 'portfolio_requests',
  applications: 'applications',
  tasks: 'tasks',
};

type LinkWriteContext = {
  isAdmin?: boolean;
  permissions?: Record<string, string>;
  manager?: EntityManager;
  queryRunner?: { manager?: EntityManager } | null;
  userId?: string | null;
  user?: { sub?: string | null } | null;
  tenantId?: string | null;
  tenant?: { id?: string | null } | null;
};

/** The linked modules whose records a Business Contributor reads inside their participation. */
export type ParticipationLinkedModule = 'projects' | 'requests' | 'applications' | 'tasks';

/**
 * The participation scope of a person on the records of `module`, for a service reached without the
 * request (Kad): undefined when the person reads every record of the module, or the module has none.
 */
export async function linkedParticipationScope(
  manager: EntityManager,
  userId: string | null | undefined,
  tenantId: string | null | undefined,
  module: LinkedModule,
): Promise<ParticipationAccessScope | undefined> {
  const resource = PARTICIPATION_RESOURCES[module];
  if (!resource) return undefined;
  return resolveBusinessContributorScopeForUser({ manager, userId: String(userId || ''), tenantId: tenantId ?? null, isAdmin: false }, resource, 'reader');
}

/** The participation scope of the route's person on `module`, with the manager to read it; none for an administrator. */
async function contextScope(
  ctx: LinkWriteContext,
  module: LinkedModule,
): Promise<{ manager: EntityManager; scope: ParticipationAccessScope } | null> {
  if (!PARTICIPATION_RESOURCES[module] || ctx.isAdmin === true) return null;
  const manager = ctx.manager ?? ctx.queryRunner?.manager;
  if (!manager) return null;
  const scope = await linkedParticipationScope(manager, ctx.userId ?? ctx.user?.sub ?? '', ctx.tenantId ?? ctx.tenant?.id ?? null, module);
  return scope ? { manager, scope } : null;
}

/**
 * A write that links the records `ids` of `module`: the module read (`assertLinkedModuleRead`), and,
 * as on a document's links, a Business Contributor links only records of their participation (403
 * `OUTSIDE_PARTICIPATION`). `ctx`: the route's `@Tenant()` context or its request.
 */
export async function assertLinkedRecordsReadable(ctx: LinkWriteContext, module: LinkedModule, ids: unknown[]): Promise<void> {
  assertLinkedModuleRead(ctx, module);
  // Stored ids are lower case: an upper-case id names the same record.
  const wanted = (Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim().toLowerCase()).filter((id) => UUID_RE.test(id));
  if (wanted.length === 0) return;
  const scoped = await contextScope(ctx, module);
  if (!scoped) return;
  const visible = await idsInScope(scoped.manager, module as ParticipationLinkedModule, wanted, scoped.scope);
  if (wanted.some((id) => !visible.has(id))) {
    throw outsideParticipation(module, `You can only link ${module} you take part in.`);
  }
}

/**
 * The stored links among `stored` (ids of `module` records) a replacement may remove: those the
 * person reads. Undefined for a person who reads every record of the module. The others are never
 * removed, also when stored by someone else meanwhile (`replacedLinks`). `ctx`: the route's
 * `@Tenant()` context or its request.
 */
export async function removableLinks(ctx: LinkWriteContext, module: ParticipationLinkedModule, stored: string[]): Promise<string[] | undefined> {
  const scoped = await contextScope(ctx, module);
  if (!scoped) return undefined;
  const ids = stored.map((id) => String(id).toLowerCase());
  const visible = await idsInScope(scoped.manager, module, ids, scoped.scope);
  return ids.filter((id) => visible.has(id));
}

/** The items among `items` (records of `module`) the person reads: a route's answer names no other. */
export async function readableLinkedItems<T extends { id: string }>(ctx: LinkWriteContext, module: ParticipationLinkedModule, items: T[]): Promise<T[]> {
  const scoped = await contextScope(ctx, module);
  if (!scoped) return items;
  const visible = await idsInScope(scoped.manager, module, items.map((item) => String(item.id).toLowerCase()), scoped.scope);
  return items.filter((item) => visible.has(String(item.id).toLowerCase()));
}

/**
 * A replacement of a record's links, from the stored ones (`before`): the links to remove (stored,
 * not in `next`, and among `removable` when given), the links to add, and the set stored after.
 * A link outside `removable` stays: it is neither deleted nor written again.
 */
export function replacedLinks(before: string[], next: string[], removable?: string[]): { removed: string[]; added: string[]; after: string[] } {
  const stored = Array.from(new Set(before.map((id) => String(id).toLowerCase())));
  const wanted = Array.from(new Set(next.map((id) => String(id).trim().toLowerCase()).filter(Boolean)));
  const wantedSet = new Set(wanted);
  const storedSet = new Set(stored);
  const mayRemove = removable ? new Set(removable.map((id) => String(id).toLowerCase())) : null;
  const removed = stored.filter((id) => !wantedSet.has(id) && (!mayRemove || mayRemove.has(id)));
  const removedSet = new Set(removed);
  return {
    removed,
    added: wanted.filter((id) => !storedSet.has(id)),
    after: [...stored.filter((id) => !removedSet.has(id)), ...wanted.filter((id) => !storedSet.has(id))],
  };
}

/**
 * The links among `linked` (ids of `module` records) that a Business Contributor with `scope` does
 * not see: a replacement of the links keeps them, as on a document's links.
 */
export async function linksOutsideScope(
  manager: EntityManager,
  module: ParticipationLinkedModule,
  linked: string[],
  scope: { userId: string } | undefined,
): Promise<string[]> {
  if (!scope || linked.length === 0) return [];
  const visible = await idsInScope(manager, module, linked, scope);
  return linked.filter((id) => !visible.has(id));
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
  const granted = new Set(rows
    .map((row) => (row.resource ? RESOURCE_ALIASES[row.resource] ?? row.resource : null))
    .filter((resource): resource is string => !!resource));
  return readsFrom((resource) => granted.has(resource));
}
