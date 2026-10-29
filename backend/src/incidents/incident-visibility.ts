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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * The same viewer from an Express request: JwtAuthGuard puts the user id in
 * `req.user.sub` (never `req.userId`), PermissionGuard puts `isAdmin` and
 * `permissions` on the request itself.
 */
export function incidentViewerFromRequest(req: {
  user?: { sub?: string | null } | null;
  isAdmin?: boolean;
  permissions?: Record<string, string | undefined> | null;
} | null | undefined): IncidentViewer {
  return incidentViewerFromContext({
    userId: req?.user?.sub ?? null,
    isAdmin: req?.isAdmin,
    permissions: req?.permissions,
  });
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
 * The viewer as SQL can compare it: `users.id` is a uuid, so a non-uuid actor
 * label (headless agent runs, tool harnesses, AI specs) owns no incident. It
 * still fails closed for a restricted one.
 */
function incidentViewerForSql(
  viewer: IncidentViewer | null | undefined,
): IncidentViewer | null | undefined {
  if (!viewer || viewer.isAdmin) return viewer;
  const userId = String(viewer.userId || '').trim();
  if (!userId) return viewer;
  return UUID_RE.test(userId) ? viewer : { userId: null, isAdmin: false };
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
  const confidentiality = incidentConfidentialityPredicate('i_task_visibility', incidentViewerForSql(viewer), params);
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

/**
 * Whether the viewer hides at least one restricted incident in this tenant.
 *
 * Read once before an audit query: with no hidden incident the predicate is
 * omitted entirely, so a workspace without a restricted incident pays nothing
 * on its audit log. A registry admin never pays the query.
 */
export async function hasHiddenIncidents(
  manager: EntityManager,
  viewer: IncidentViewer | null | undefined,
  tenantId: string | null | undefined,
): Promise<boolean> {
  const tenant = String(tenantId || '').trim();
  if (!tenant || viewer?.isAdmin) return false;
  const params: unknown[] = [tenant];
  const confidentiality = incidentConfidentialityPredicate(
    'i_hidden',
    incidentViewerForSql(viewer),
    params,
  );
  if (confidentiality.unrestricted) return false;
  const rows = await manager.query(
    `SELECT 1
     FROM incidents i_hidden
     WHERE i_hidden.tenant_id = $1
       AND (${confidentiality.hidden})
     LIMIT 1`,
    params,
  );
  return rows.length > 0;
}

/**
 * Audit-log rows that describe an incident the viewer may not see, in one
 * predicate over the log alias (`a` in `AuditLogsService`).
 *
 * A row is tied to its incident by what its table means: `incidents` and the
 * three link tables store the incident id in `record_id` (the relations service
 * audits a link change under the incident), an entry or an attachment is joined
 * through its `incident_id`, the review through its integrated binding, and a
 * task through its `related_object_id` (its application and asset link rows
 * store the task id in `record_id`). The incident is read on its current
 * row, so a line about a deleted incident stays visible, as today.
 *
 * Every branch is an uncorrelated `record_id IN (subquery)` keyed by the
 * tenant, so PostgreSQL evaluates each subquery once and hashes it, instead of
 * probing the outer row. The tenant is a parameter when the caller has one;
 * `app_current_tenant()` is only the direct-call fallback.
 *
 * Empty for a registry admin: no branch, no parameter, no cost.
 */
export function auditLogIncidentVisibilitySql(
  auditAlias: string,
  viewer: IncidentViewer | null | undefined,
  tenantId: string | null | undefined,
  params: unknown[],
): string {
  const normalizedViewer = incidentViewerForSql(viewer);
  if (normalizedViewer?.isAdmin) return '';
  const tenant = String(tenantId || '').trim();
  let tenantRef = 'app_current_tenant()';
  if (tenant) {
    params.push(tenant);
    tenantRef = `$${params.length}`;
  }
  const confidentiality = incidentConfidentialityPredicate('i_audit', normalizedViewer, params);
  if (confidentiality.unrestricted) return '';

  const recordId = `${auditAlias}.record_id`;
  const hidden = confidentiality.hidden;

  const incidentIds = `SELECT i_audit.id
        FROM incidents i_audit
        WHERE i_audit.tenant_id = ${tenantRef}
          AND (${hidden})`;
  const entryIds = `SELECT e_audit.id
        FROM incident_entries e_audit
        JOIN incidents i_audit
          ON i_audit.id = e_audit.incident_id
         AND i_audit.tenant_id = e_audit.tenant_id
        WHERE e_audit.tenant_id = ${tenantRef}
          AND (${hidden})`;
  const attachmentIds = `SELECT at_audit.id
        FROM incident_attachments at_audit
        JOIN incidents i_audit
          ON i_audit.id = at_audit.incident_id
         AND i_audit.tenant_id = at_audit.tenant_id
        WHERE at_audit.tenant_id = ${tenantRef}
          AND (${hidden})`;
  const reviewDocumentIds = `SELECT b_audit.document_id
        FROM integrated_document_bindings b_audit
        JOIN incidents i_audit
          ON i_audit.id = b_audit.source_entity_id
         AND i_audit.tenant_id = b_audit.tenant_id
        WHERE b_audit.tenant_id = ${tenantRef}
          AND b_audit.source_entity_type = 'incidents'
          AND (${hidden})`;
  const taskIds = `SELECT t_audit.id
        FROM tasks t_audit
        JOIN incidents i_audit
          ON i_audit.id = t_audit.related_object_id
         AND i_audit.tenant_id = t_audit.tenant_id
        WHERE t_audit.tenant_id = ${tenantRef}
          AND t_audit.related_object_type = 'incident'
          AND (${hidden})`;
  const taskChildIds = (childTable: 'task_attachments' | 'task_time_entries') => `SELECT c_audit.id
        FROM ${childTable} c_audit
        JOIN tasks t_audit
          ON t_audit.id = c_audit.task_id
         AND t_audit.tenant_id = c_audit.tenant_id
        JOIN incidents i_audit
          ON i_audit.id = t_audit.related_object_id
         AND i_audit.tenant_id = t_audit.tenant_id
        WHERE c_audit.tenant_id = ${tenantRef}
          AND t_audit.related_object_type = 'incident'
          AND (${hidden})`;
  const documentAttachmentIds = `SELECT da_audit.id
        FROM document_attachments da_audit
        JOIN integrated_document_bindings b_audit
          ON b_audit.document_id = da_audit.document_id
         AND b_audit.tenant_id = da_audit.tenant_id
        JOIN incidents i_audit
          ON i_audit.id = b_audit.source_entity_id
         AND i_audit.tenant_id = b_audit.tenant_id
        WHERE da_audit.tenant_id = ${tenantRef}
          AND b_audit.source_entity_type = 'incidents'
          AND (${hidden})`;
  const documentIncidentIds = `SELECT di_audit.id
        FROM document_incidents di_audit
        JOIN incidents i_audit
          ON i_audit.id = di_audit.incident_id
         AND i_audit.tenant_id = di_audit.tenant_id
        WHERE di_audit.tenant_id = ${tenantRef}
          AND (${hidden})`;

  return ` AND NOT (
      (${auditAlias}.table_name IN ('incidents', 'incident_assets', 'incident_applications', 'incident_technologies') AND ${recordId} IN (${incidentIds}))
      OR (${auditAlias}.table_name = 'incident_entries' AND ${recordId} IN (${entryIds}))
      OR (${auditAlias}.table_name = 'incident_attachments' AND ${recordId} IN (${attachmentIds}))
      OR (${auditAlias}.table_name = 'documents' AND ${recordId} IN (${reviewDocumentIds}))
      OR (${auditAlias}.table_name IN ('tasks', 'task_applications', 'task_assets') AND ${recordId} IN (${taskIds}))
      OR (${auditAlias}.table_name = 'task_attachments' AND ${recordId} IN (${taskChildIds('task_attachments')}))
      OR (${auditAlias}.table_name = 'task_time_entries' AND ${recordId} IN (${taskChildIds('task_time_entries')}))
      OR (${auditAlias}.table_name = 'document_attachments' AND ${recordId} IN (${documentAttachmentIds}))
      OR (${auditAlias}.table_name = 'document_incidents' AND ${recordId} IN (${documentIncidentIds}))
  )`;
}

/** The same audit predicate as named parameters, for a TypeORM QueryBuilder. */
export function auditLogIncidentVisibilityQueryBuilderClause(
  auditAlias: string,
  viewer: IncidentViewer | null | undefined,
  tenantId: string | null | undefined,
  paramPrefix = 'auditIncident',
): { clause: string; params: Record<string, unknown> } {
  const params: unknown[] = [];
  const sql = auditLogIncidentVisibilitySql(auditAlias, viewer, tenantId, params);
  if (!sql) return { clause: '', params: {} };
  let clause = sql.replace(/^\s*AND\s+/, '');
  const tenantProvided = String(tenantId || '').trim().length > 0;
  const suffixes = tenantProvided ? ['TenantId', 'ViewerId'] : ['ViewerId'];
  const named: Record<string, unknown> = {};
  params.forEach((value, index) => {
    const name = `${paramPrefix}${suffixes[index] ?? `Extra${index}`}`;
    clause = clause.replace(new RegExp(`\\$${index + 1}\\b`, 'g'), `:${name}`);
    named[name] = value;
  });
  return { clause, params: named };
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
