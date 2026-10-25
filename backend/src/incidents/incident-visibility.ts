import { EntityManager } from 'typeorm';

/**
 * Who is looking at the incident register. `isAdmin` means incidents:admin
 * (Administrator already short-circuits to that).
 */
export type IncidentViewer = {
  userId: string | null;
  isAdmin: boolean;
};

export type IncidentVisibilityRow = {
  confidential?: boolean | null;
  reporter_user_id?: string | null;
  owner_user_id?: string | null;
};

/**
 * Statuses that freeze the record: the incident itself, its journal, its
 * attachments and its review document all refuse writes until it is reopened.
 *
 * Single source of truth for the incident side (`assertEditable`, CSV import)
 * and for the Knowledge side (`document-entity-visibility`), which is why it
 * lives in this Nest-free module.
 */
export const INCIDENT_FROZEN_STATUSES: ReadonlySet<string> = new Set(['closed', 'cancelled']);

/** The single refusal message for every write blocked by the closure freeze. */
export const INCIDENT_LOCKED_MESSAGE = 'This incident is closed. Reopen it to make changes.';

export function isFrozenIncidentStatus(status: string | null | undefined): boolean {
  return INCIDENT_FROZEN_STATUSES.has(String(status ?? ''));
}

export function incidentViewerFromContext(ctx: {
  userId?: string | null;
  isAdmin?: boolean;
  permissions?: Record<string, string | undefined> | null;
}): IncidentViewer {
  const permissions = ctx.permissions || {};
  return {
    userId: ctx.userId ? String(ctx.userId) : null,
    isAdmin: ctx.isAdmin === true || permissions.incidents === 'admin',
  };
}

/**
 * A1: confidential rows are visible to incidents:admin, the reporter and the owner.
 * Missing viewer fails closed.
 */
export function incidentVisibleToViewer(
  incident: IncidentVisibilityRow,
  viewer?: IncidentViewer | null,
): boolean {
  if (!incident.confidential) return true;
  if (viewer?.isAdmin) return true;
  const userId = String(viewer?.userId || '').trim();
  if (!userId) return false;
  return incident.reporter_user_id === userId || incident.owner_user_id === userId;
}

/**
 * The confidentiality rule as SQL, in both polarities.
 *
 * Callers that select the rows a viewer may see use `visible`; callers that
 * exclude the rows a viewer may not see (the document ACL, which anti-joins
 * through `integrated_document_bindings`) use `hidden`. The two are exact
 * complements built here once, so no surface can restate the rule and drift
 * from the register.
 *
 * `hidden` uses `IS NOT TRUE` rather than `NOT (...)`: a null reporter/owner
 * would otherwise make the comparison unknown and let the row through.
 */
export type IncidentConfidentialityPredicate = {
  /** True for a registry admin: nothing is restricted, both fragments are empty. */
  unrestricted: boolean;
  /** Rows the viewer may see. */
  visible: string;
  /** Rows the viewer may not see. */
  hidden: string;
};

export function incidentConfidentialityPredicate(
  alias: string,
  viewer: IncidentViewer | null | undefined,
  params: unknown[],
): IncidentConfidentialityPredicate {
  if (viewer?.isAdmin) return { unrestricted: true, visible: '', hidden: '' };
  const confidential = `${alias}.confidential`;
  const userId = String(viewer?.userId || '').trim();
  if (!userId) {
    return { unrestricted: false, visible: `${confidential} = false`, hidden: `${confidential} = true` };
  }
  params.push(userId);
  const placeholder = `$${params.length}`;
  const owns = `${alias}.reporter_user_id = ${placeholder} OR ${alias}.owner_user_id = ${placeholder}`;
  return {
    unrestricted: false,
    visible: `(${confidential} = false OR ${owns})`,
    hidden: `${confidential} = true AND (${owns}) IS NOT TRUE`,
  };
}

/**
 * SQL fragment with a leading AND. Admins get an empty string (see every row).
 */
export function incidentVisibilitySql(
  alias: string,
  viewer: IncidentViewer | null | undefined,
  params: unknown[],
): string {
  const predicate = incidentConfidentialityPredicate(alias, viewer, params);
  return predicate.unrestricted ? '' : ` AND ${predicate.visible}`;
}

/**
 * Task rows naming an incident the viewer may not see.
 *
 * The single predicate every task read applies. It is empty for a registry admin
 * (the query text is unchanged, no subquery), and otherwise a keyed anti-join:
 * a task names one incident at most, so the check is one primary-key lookup per
 * row whatever the surface. The incident is read on its current row, so a task
 * whose incident no longer exists stays visible, as it reads today.
 */
export function taskIncidentVisibilitySql(
  taskAlias: string,
  viewer: IncidentViewer | null | undefined,
  params: unknown[],
): string {
  const confidentiality = incidentConfidentialityPredicate('i_task_visibility', viewer, params);
  if (confidentiality.unrestricted) return '';
  return ` AND (${taskAlias}.related_object_type IS DISTINCT FROM 'incident' OR NOT EXISTS (
    SELECT 1
    FROM incidents i_task_visibility
    WHERE i_task_visibility.id = ${taskAlias}.related_object_id
      AND i_task_visibility.tenant_id = ${taskAlias}.tenant_id
      AND (${confidentiality.hidden})
  ))`;
}

/** The same task predicate as named parameters, for a TypeORM QueryBuilder. */
export function taskIncidentVisibilityQueryBuilderClause(
  taskAlias: string,
  viewer: IncidentViewer | null | undefined,
  paramName = 'taskIncidentViewerId',
): { clause: string; params: Record<string, unknown> } {
  const params: unknown[] = [];
  const sql = taskIncidentVisibilitySql(taskAlias, viewer, params);
  if (!sql) return { clause: '', params: {} };
  return {
    clause: sql.replace(/^\s*AND\s+/, '').replace(/\$1\b/g, `:${paramName}`),
    params: params.length > 0 ? { [paramName]: params[0] } : {},
  };
}

/** Related-object label on tasks: INC-N only when the incident is confidential. */
export function incidentRelatedLabelSql(alias: string): string {
  return `CASE WHEN ${alias}.id IS NULL THEN NULL WHEN ${alias}.confidential THEN 'INC-' || ${alias}.item_number::text ELSE 'INC-' || ${alias}.item_number::text || ' · ' || ${alias}.title END`;
}

/** Title for task search / index: omitted when confidential. */
export function incidentRelatedTitleSql(alias: string): string {
  return `CASE WHEN ${alias}.confidential THEN NULL ELSE ${alias}.title END`;
}

/** RBAC levels on the `incidents` resource, ranked. */
export const INCIDENT_LEVEL_RANK: Record<string, number> = {
  reader: 1, contributor: 2, member: 3, admin: 4,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The raw role facts every incident viewer is derived from. */
export type IncidentRoleFacts = {
  /** The user exists in this tenant **and** the account is enabled. */
  userOk: boolean;
  isAdministrator: boolean;
  /** Highest `incidents` level granted by the user's roles (0 = none). */
  levelRank: number;
};

const NO_INCIDENT_ROLE_FACTS: IncidentRoleFacts = Object.freeze({
  userOk: false,
  isAdministrator: false,
  levelRank: 0,
});

function coerceBoolean(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1 || value === '1';
}

/**
 * Legacy `users.role_id` + `user_roles`, Administrator short-circuit, and the
 * highest `incidents` RBAC level — in one query, for one user.
 *
 * A disabled account (or one that does not belong to the tenant) comes back
 * with `userOk: false`, which every viewer built from it treats as "no rights":
 * the register path and the document path can no longer disagree on it.
 *
 * Some internal surfaces carry a non-UUID actor label instead of a real user id
 * (headless agent runs, tool harnesses); those are not users, so the query is
 * skipped rather than crashing on a cast.
 */
export async function loadIncidentRoleFacts(
  manager: EntityManager,
  userId: string | null | undefined,
  tenantId: string | null | undefined,
): Promise<IncidentRoleFacts> {
  const normalized = String(userId || '').trim();
  const tenant = String(tenantId || '').trim();
  if (!normalized || !tenant || !UUID_RE.test(normalized) || !UUID_RE.test(tenant)) {
    return NO_INCIDENT_ROLE_FACTS;
  }

  const rows = await manager.query<Array<{
    user_ok: boolean | string;
    is_administrator: boolean | string;
    level_rank: number | string | null;
  }>>(
    `WITH ctx AS (
       SELECT u.id AS user_id, u.role_id
       FROM users u
       WHERE u.id = $1
         AND u.tenant_id = $2
         AND u.status = 'enabled'
     ),
     role_ids AS (
       SELECT c.role_id AS role_id FROM ctx c WHERE c.role_id IS NOT NULL
       UNION
       SELECT ur.role_id
       FROM user_roles ur
       WHERE ur.user_id = $1
         AND ur.tenant_id = $2
         AND EXISTS (SELECT 1 FROM ctx)
     )
     SELECT
       EXISTS (SELECT 1 FROM ctx) AS user_ok,
       EXISTS (
         SELECT 1
         FROM role_ids ri
         JOIN roles r ON r.id = ri.role_id AND r.tenant_id = $2
         WHERE lower(coalesce(r.role_name, '')) = 'administrator'
       ) AS is_administrator,
       (
         SELECT max(
           CASE rp.level
             WHEN 'admin' THEN 4
             WHEN 'member' THEN 3
             WHEN 'contributor' THEN 2
             WHEN 'reader' THEN 1
             ELSE 0
           END)
         FROM role_permissions rp
         WHERE rp.tenant_id = $2
           AND rp.resource = 'incidents'
           AND rp.role_id IN (SELECT role_id FROM role_ids)
       ) AS level_rank`,
    [normalized, tenant],
  );

  const row = rows[0];
  if (!row || !coerceBoolean(row.user_ok)) return NO_INCIDENT_ROLE_FACTS;
  return {
    userOk: true,
    isAdministrator: coerceBoolean(row.is_administrator),
    levelRank: Number(row.level_rank ?? 0) || 0,
  };
}

/** `incidents:admin` (or Administrator) from already-loaded role facts. */
export function isIncidentAdminFromFacts(facts: IncidentRoleFacts): boolean {
  return facts.userOk && (facts.isAdministrator || facts.levelRank >= INCIDENT_LEVEL_RANK.admin);
}

/**
 * Resolve incidents:admin (or Administrator) for callers that are not already
 * behind PermissionGuard on the incidents resource (chat, task sub-routes).
 */
export async function resolveIncidentViewer(
  manager: EntityManager,
  userId: string | null | undefined,
  tenantId: string | null | undefined,
): Promise<IncidentViewer> {
  const normalized = String(userId || '').trim();
  const tenant = String(tenantId || '').trim();
  if (!normalized || !tenant) return { userId: normalized || null, isAdmin: false };
  const facts = await loadIncidentRoleFacts(manager, normalized, tenant);
  return { userId: normalized, isAdmin: isIncidentAdminFromFacts(facts) };
}
