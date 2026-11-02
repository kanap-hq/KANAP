import { NotFoundException } from '@nestjs/common';
import { requestContextMissing } from './module-right-required';
import { EntityManager, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { PermissionLevel } from '../permissions/permissions.service';

export type ParticipationAccessScope = {
  userId: string;
};

const LEVEL_RANK: Record<PermissionLevel, number> = {
  reader: 1,
  contributor: 2,
  member: 3,
  admin: 4,
};

type RoleScopeRow = {
  role_id: string;
  role_name: string;
  level: PermissionLevel | null;
};

type ScopeResolutionInput = {
  manager: EntityManager;
  userId: string;
  tenantId?: string | null;
  isAdmin?: boolean;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function managerFromRequest(req: any): EntityManager | null {
  return req?.queryRunner?.manager ?? null;
}

export async function resolveBusinessContributorScope(
  req: any,
  resource: string,
  unrestrictedLevel: PermissionLevel = 'reader',
): Promise<ParticipationAccessScope | undefined> {
  if (req?.isAdmin === true) return undefined;

  const userId = String(req?.user?.sub || '').trim();
  if (!userId) return undefined;

  const cacheKey = `${resource}:${unrestrictedLevel}`;
  req.__businessContributorScopeCache ??= {};
  if (Object.prototype.hasOwnProperty.call(req.__businessContributorScopeCache, cacheKey)) {
    return req.__businessContributorScopeCache[cacheKey];
  }

  const manager = managerFromRequest(req);
  if (!manager) {
    throw requestContextMissing('Access scope could not be resolved');
  }

  const scope = await resolveBusinessContributorScopeForUser({
    manager,
    userId,
    tenantId: req?.tenant?.id ?? null,
    isAdmin: req?.isAdmin === true,
  }, resource, unrestrictedLevel);
  req.__businessContributorScopeCache[cacheKey] = scope;
  return scope;
}

export async function resolveBusinessContributorScopeForUser(
  input: ScopeResolutionInput,
  resource: string,
  unrestrictedLevel: PermissionLevel = 'reader',
): Promise<ParticipationAccessScope | undefined> {
  if (input.isAdmin === true) return undefined;

  const userId = String(input.userId || '').trim();
  if (!userId) return undefined;
  if (!isUuid(userId)) return undefined;

  const tenantId = input.tenantId ?? null;
  const rows = await input.manager.query(
    `
      SELECT DISTINCT
        r.id::text AS role_id,
        LOWER(TRIM(r.role_name)) AS role_name,
        rp.level AS level
      FROM (
        SELECT u.role_id
        FROM users u
        WHERE u.id = $1
          AND ($3::uuid IS NULL OR u.tenant_id = $3::uuid)
        UNION
        SELECT ur.role_id
        FROM user_roles ur
        WHERE ur.user_id = $1
          AND ($3::uuid IS NULL OR ur.tenant_id = $3::uuid)
      ) assigned_roles
      JOIN roles r ON r.id = assigned_roles.role_id
      LEFT JOIN role_permissions rp
        ON rp.role_id = r.id
       AND rp.resource = $2
      WHERE ($3::uuid IS NULL OR r.tenant_id = $3::uuid)
    `,
    [userId, resource, tenantId],
  ) as RoleScopeRow[];

  const hasBusinessContributor = rows.some((row) => row.role_name === 'business contributor');
  if (!hasBusinessContributor || rows.some((row) => row.role_name === 'administrator')) {
    return undefined;
  }

  const minRank = LEVEL_RANK[unrestrictedLevel] ?? LEVEL_RANK.reader;
  const hasUnrestrictedRole = rows.some((row) => (
    row.role_name !== 'business contributor'
    && row.level
    && (LEVEL_RANK[row.level] ?? 0) >= minRank
  ));

  return hasUnrestrictedRole ? undefined : { userId };
}

export function requestParticipantCondition(alias: string, userRef: string): string {
  const userUuid = `CAST(${userRef} AS uuid)`;
  return `(
    ${alias}.requestor_id = ${userUuid}
    OR ${alias}.created_by_id = ${userUuid}
    OR ${alias}.business_sponsor_id = ${userUuid}
    OR ${alias}.business_lead_id = ${userUuid}
    OR ${alias}.it_sponsor_id = ${userUuid}
    OR ${alias}.it_lead_id = ${userUuid}
    OR EXISTS (
      SELECT 1
      FROM portfolio_request_team rt_scope
      WHERE rt_scope.request_id = ${alias}.id
        AND rt_scope.tenant_id = ${alias}.tenant_id
        AND rt_scope.user_id = ${userUuid}
    )
  )`;
}

export function projectParticipantCondition(alias: string, userRef: string): string {
  const userUuid = `CAST(${userRef} AS uuid)`;
  return `(
    ${alias}.business_sponsor_id = ${userUuid}
    OR ${alias}.business_lead_id = ${userUuid}
    OR ${alias}.it_sponsor_id = ${userUuid}
    OR ${alias}.it_lead_id = ${userUuid}
    OR EXISTS (
      SELECT 1
      FROM portfolio_project_team pt_scope
      WHERE pt_scope.project_id = ${alias}.id
        AND pt_scope.tenant_id = ${alias}.tenant_id
        AND pt_scope.user_id = ${userUuid}
    )
  )`;
}

export function taskParticipantCondition(alias: string, userRef: string): string {
  const userUuid = `CAST(${userRef} AS uuid)`;
  const userText = `CAST(${userRef} AS text)`;
  return `(
    ${alias}.assignee_user_id = ${userUuid}
    OR ${alias}.creator_id = ${userUuid}
    OR ${alias}.owner_ids ? ${userText}
    OR ${alias}.viewer_ids ? ${userText}
    OR (
      ${alias}.related_object_type = 'project'
      AND EXISTS (
        SELECT 1
        FROM portfolio_projects p_scope
        WHERE p_scope.id = ${alias}.related_object_id
          AND p_scope.tenant_id = ${alias}.tenant_id
          AND ${projectParticipantCondition('p_scope', userRef)}
      )
    )
  )`;
}

export function applicationParticipantCondition(alias: string, userRef: string): string {
  const userUuid = `CAST(${userRef} AS uuid)`;
  return `EXISTS (
    SELECT 1
    FROM application_owners ao_scope
    WHERE ao_scope.application_id = ${alias}.id
      AND ao_scope.tenant_id = ${alias}.tenant_id
      AND ao_scope.user_id = ${userUuid}
      AND ao_scope.owner_type IN ('business', 'it')
  )`;
}

export function applyRequestParticipantScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  accessScope: ParticipationAccessScope | undefined,
  alias = 'r',
): void {
  if (!accessScope) return;
  qb.andWhere(requestParticipantCondition(alias, ':accessScopeUserId'), {
    accessScopeUserId: accessScope.userId,
  });
}

export function applyProjectParticipantScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  accessScope: ParticipationAccessScope | undefined,
  alias = 'p',
): void {
  if (!accessScope) return;
  qb.andWhere(projectParticipantCondition(alias, ':accessScopeUserId'), {
    accessScopeUserId: accessScope.userId,
  });
}

export function applyApplicationParticipantScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  accessScope: ParticipationAccessScope | undefined,
  alias = 'a',
): void {
  if (!accessScope) return;
  qb.andWhere(applicationParticipantCondition(alias, ':accessScopeUserId'), {
    accessScopeUserId: accessScope.userId,
  });
}

export function notFoundForScopedAccess(entityName: string): NotFoundException {
  return new NotFoundException(`${entityName} not found`);
}
