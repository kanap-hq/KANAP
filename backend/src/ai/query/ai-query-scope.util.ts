import { BadRequestException } from '@nestjs/common';
import {
  ParticipationAccessScope,
  applicationParticipantCondition,
  projectParticipantCondition,
  requestParticipantCondition,
  resolveBusinessContributorScopeForUser,
  taskParticipantCondition,
} from '../../auth/business-contributor-scope';
import {
  DocumentIncidentViewer,
  resolveDocumentIncidentViewer,
} from '../../knowledge/document-entity-visibility';
import { IncidentViewer, resolveIncidentViewer } from '../../incidents/incident-visibility';
import { AiExecutionContextWithManager, AiQueryScope } from '../ai.types';

export type ScopedAiEntityType =
  | 'accounts'
  | 'analytics_categories'
  | 'applications'
  | 'assets'
  | 'budget_lines'
  | 'business_processes'
  | 'chargeback'
  | 'chargeback_lines'
  | 'chart_of_accounts'
  | 'companies'
  | 'connections'
  | 'contacts'
  | 'contracts'
  | 'data_access'
  | 'departments'
  | 'documents'
  | 'incidents'
  | 'interfaces'
  | 'locations'
  | 'projects'
  | 'requests'
  | 'role_permissions'
  | 'roles'
  | 'suppliers'
  | 'support_deadlines'
  | 'support_gaps'
  | 'tasks'
  | 'technologies'
  | 'technology_versions'
  | 'users'
  | 'vulnerabilities'
  | 'cost_centers';

export type ResolvedAiScope = {
  requested: AiQueryScope;
  resolved: boolean;
  team_name?: string | null;
};

export type ParticipationScopedAiEntityType = 'applications' | 'projects' | 'requests' | 'tasks';

const PARTICIPATION_SCOPE_RESOURCE: Record<ParticipationScopedAiEntityType, string> = {
  applications: 'applications',
  projects: 'portfolio_projects',
  requests: 'portfolio_requests',
  tasks: 'tasks',
};

export function isParticipationScopedAiEntityType(
  entityType: ScopedAiEntityType,
): entityType is ParticipationScopedAiEntityType {
  return entityType === 'applications' || entityType === 'projects' || entityType === 'requests' || entityType === 'tasks';
}

export async function resolveAiParticipationAccessScope(
  context: AiExecutionContextWithManager,
  entityType: ScopedAiEntityType,
): Promise<ParticipationAccessScope | undefined> {
  if (!isParticipationScopedAiEntityType(entityType)) return undefined;
  if (typeof context.manager?.query !== 'function') return undefined;

  const cacheHost = context as AiExecutionContextWithManager & {
    __aiParticipationAccessScopeCache?: Partial<Record<ParticipationScopedAiEntityType, ParticipationAccessScope | undefined>>;
  };
  cacheHost.__aiParticipationAccessScopeCache ??= {};
  if (Object.prototype.hasOwnProperty.call(cacheHost.__aiParticipationAccessScopeCache, entityType)) {
    return cacheHost.__aiParticipationAccessScopeCache[entityType];
  }

  const scope = await resolveBusinessContributorScopeForUser({
    manager: context.manager,
    userId: context.userId,
    tenantId: context.tenantId,
  }, PARTICIPATION_SCOPE_RESOURCE[entityType], 'reader');
  cacheHost.__aiParticipationAccessScopeCache[entityType] = scope;
  return scope;
}

/**
 * The incident register viewer, memoized for the life of one AI execution
 * context: search, list, detail, filter values, aggregates and task mutations
 * all ask the same question for the same user, and each answer costs one role
 * query. A registry admin then gets an empty SQL predicate (see
 * `taskIncidentVisibilitySql`).
 */
export async function resolveAiIncidentViewer(
  context: AiExecutionContextWithManager,
): Promise<IncidentViewer> {
  const cacheHost = context as AiExecutionContextWithManager & {
    __aiIncidentViewer?: Promise<IncidentViewer>;
  };
  cacheHost.__aiIncidentViewer ??= resolveIncidentViewer(
    context.manager,
    context.userId ?? null,
    context.tenantId,
  );
  return cacheHost.__aiIncidentViewer;
}

/**
 * `resolveDocumentIncidentViewer`, memoized for the life of one AI execution
 * context — the same request-scoped cache the participation scope already uses.
 *
 * Every documents-touching AI surface (search, list, aggregate, filter values,
 * mutations) needs the same answer for the same user, and it costs one role
 * query each time. The viewer only depends on the user and the tenant, both
 * fixed for a context.
 */
export async function resolveAiDocumentIncidentViewer(
  context: AiExecutionContextWithManager,
): Promise<DocumentIncidentViewer> {
  const cacheHost = context as AiExecutionContextWithManager & {
    __aiDocumentIncidentViewer?: Promise<DocumentIncidentViewer>;
  };
  cacheHost.__aiDocumentIncidentViewer ??= resolveDocumentIncidentViewer(
    context.manager,
    context.userId ?? null,
    context.tenantId,
  );
  return cacheHost.__aiDocumentIncidentViewer;
}

export function participantConditionForAiEntity(
  entityType: ParticipationScopedAiEntityType,
  alias: string,
  userRef: string,
): string {
  if (entityType === 'applications') return applicationParticipantCondition(alias, userRef);
  if (entityType === 'projects') return projectParticipantCondition(alias, userRef);
  if (entityType === 'requests') return requestParticipantCondition(alias, userRef);
  return taskParticipantCondition(alias, userRef);
}

/**
 * `AND <participation condition on alias>` when the person reads this family in their
 * participation scope only (`resolveAiParticipationAccessScope`), else an empty string. The user
 * id is pushed into `params`.
 */
export async function aiParticipationScopeSql(
  context: AiExecutionContextWithManager,
  entityType: ParticipationScopedAiEntityType,
  alias: string,
  params: unknown[],
): Promise<string> {
  const scope = await resolveAiParticipationAccessScope(context, entityType);
  if (!scope) return '';
  params.push(scope.userId);
  return `AND ${participantConditionForAiEntity(entityType, alias, `$${params.length}`)}`;
}

export async function resolveCurrentUserTeam(
  context: AiExecutionContextWithManager,
): Promise<{ teamId: string | null; teamName: string | null }> {
  const rows = await context.manager.query(
    `SELECT tmc.team_id,
            pt.name AS team_name
     FROM portfolio_team_member_configs tmc
     LEFT JOIN portfolio_teams pt
       ON pt.id = tmc.team_id
      AND pt.tenant_id = tmc.tenant_id
     WHERE tmc.tenant_id = $1
       AND tmc.user_id = $2
     LIMIT 1`,
    [context.tenantId, context.userId],
  );
  return {
    teamId: rows[0]?.team_id ?? null,
    teamName: rows[0]?.team_name ?? null,
  };
}

export async function applyScopeToAiQuery(
  context: AiExecutionContextWithManager,
  entityType: ScopedAiEntityType,
  query: Record<string, any>,
  scope?: AiQueryScope,
): Promise<{ query: Record<string, any>; scope: ResolvedAiScope | null }> {
  if (!scope) {
    return { query, scope: null };
  }

  if (scope === 'me') {
    if (entityType === 'tasks') {
      return {
        query: { ...query, involvedUserId: context.userId },
        scope: { requested: scope, resolved: true },
      };
    }
    if (entityType === 'projects' || entityType === 'requests') {
      return {
        query: { ...query, involvedUserId: context.userId },
        scope: { requested: scope, resolved: true },
      };
    }
    throw new BadRequestException(`scope "${scope}" is not supported for ${entityType}.`);
  }

  if (scope === 'my_team') {
    const { teamId, teamName } = await resolveCurrentUserTeam(context);
    if (!teamId) {
      return {
        query,
        scope: { requested: scope, resolved: false, team_name: teamName },
      };
    }
    if (entityType === 'tasks') {
      return {
        query: { ...query, teamId },
        scope: { requested: scope, resolved: true, team_name: teamName },
      };
    }
    if (entityType === 'projects' || entityType === 'requests') {
      return {
        query: { ...query, involvedTeamId: teamId },
        scope: { requested: scope, resolved: true, team_name: teamName },
      };
    }
    throw new BadRequestException(`scope "${scope}" is not supported for ${entityType}.`);
  }

  return { query, scope: null };
}
