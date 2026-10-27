import { NotFoundException } from '@nestjs/common';
import { resolveBusinessContributorScopeForUser } from '../../auth/business-contributor-scope';
import { PermissionLevel } from '../../permissions/permissions.service';
import { AiExecutionContextWithManager } from '../ai.types';
import { participantConditionForAiEntity, ParticipationScopedAiEntityType } from '../query/ai-query-scope.util';

/**
 * The level each Plaid write needs: the level of the screen route that makes the same change
 * (lot D11). Every write needs `member` on its module, except the ones listed here, which the
 * screen opens to a contributor. `ai-write-levels.spec.ts` holds the table operation x family,
 * compares it with the guards of the routes and breaks when a route changes level.
 * - `update_business_record` on a project: `PATCH /portfolio/projects/:id` (contributor), within
 *   the fields the project page lets a contributor change (`CONTRIBUTOR_WRITABLE_FIELDS`).
 * - `update_entity_relations` on a project or a request: the Relations tab of both pages,
 *   `POST|DELETE /portfolio/{projects,requests}/:id/relations/:kind` (contributor).
 */
const CONTRIBUTOR_WRITE_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  update_business_record: ['projects'],
  update_entity_relations: ['projects', 'requests'],
};

/** The level a write tool needs on its module for one family (`entity_type`). */
export function aiWriteLevel(toolName: string, family: unknown): PermissionLevel {
  const normalized = String(family ?? '').trim();
  return CONTRIBUTOR_WRITE_FAMILIES[toolName]?.includes(normalized) ? 'contributor' : 'member';
}

/**
 * The fields a person who holds only `contributor` on the module may write, per tool and family.
 * The project page lets a contributor change the purpose only (its editor saves through
 * `PATCH /portfolio/projects/:id/integrated-documents/purpose`, contributor); the name, the
 * status and every other field of the page need `member` (`canManage`, ProjectWorkspacePage).
 * `PATCH /portfolio/projects/:id` itself accepts a contributor for every field: the stricter
 * rule of the page is kept until a product decision opens more (lot D11, brief: strictest level).
 */
export const CONTRIBUTOR_WRITABLE_FIELDS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  update_business_record: { projects: ['purpose'] },
};

/** The modules a contributor may change through Plaid, in plain words, for the refusals. */
export const CONTRIBUTOR_PLAIN_SCOPES: Readonly<Record<string, string>> = {
  portfolio_projects: 'projects they take part in (their purpose and their links to applications, assets and budget lines)',
  portfolio_requests: 'requests they take part in (their links to applications, assets, budget lines and business processes)',
};

/**
 * Every (module, level) a write tool may need, for the tools offered to the person: the modules
 * of the tool at `member`, and the modules of its contributor families at `contributor`.
 */
export function aiWriteRequirements(
  toolName: string,
  resources: readonly string[],
): Array<{ resource: string; level: PermissionLevel }> {
  const requirements = resources.map((resource) => ({ resource, level: 'member' as PermissionLevel }));
  for (const family of CONTRIBUTOR_WRITE_FAMILIES[toolName] ?? []) {
    const scoped = WRITE_SCOPED_FAMILIES[family as ParticipationScopedAiEntityType];
    if (scoped && resources.includes(scoped.resource)) {
      requirements.push({ resource: scoped.resource, level: 'contributor' });
    }
  }
  return requirements;
}

/**
 * The families a Business Contributor writes in their participation scope only, as the screen
 * (`resolveForAccess` / `ensureTaskAccess`): the module of the scope and the table of the record.
 */
export const WRITE_SCOPED_FAMILIES: Readonly<Record<ParticipationScopedAiEntityType, { resource: string; table: string; label: string }>> = {
  applications: { resource: 'applications', table: 'applications', label: 'Application' },
  projects: { resource: 'portfolio_projects', table: 'portfolio_projects', label: 'Project' },
  requests: { resource: 'portfolio_requests', table: 'portfolio_requests', label: 'Request' },
  tasks: { resource: 'tasks', table: 'tasks', label: 'Task' },
};

/**
 * Refuses a write on a project, a request, an application or a task outside the person's
 * participation scope, as the screen refuses it (404, the record reads as missing). The scope is
 * the one of the screen route at `level`: a Business Contributor is limited unless another role
 * gives the module at that level (`resolveBusinessContributorScopeForUser`). Applications keep the
 * reader scope Plaid resolves them in (their screen route checks no scope). Checked at the preview
 * and again when it runs: a scope that changed in between refuses the run.
 */
export async function assertRecordInWriteScope(
  context: AiExecutionContextWithManager,
  family: unknown,
  recordId: string | null | undefined,
  level: PermissionLevel,
): Promise<void> {
  const normalized = String(family ?? '').trim() as ParticipationScopedAiEntityType;
  const scoped = WRITE_SCOPED_FAMILIES[normalized];
  if (!scoped || !recordId) return;
  const scope = await resolveBusinessContributorScopeForUser({
    manager: context.manager,
    userId: context.userId,
    tenantId: context.tenantId,
  }, scoped.resource, normalized === 'applications' ? 'reader' : level);
  if (!scope) return;
  const rows: unknown[] = await context.manager.query(
    `SELECT 1 FROM ${scoped.table} x
      WHERE x.tenant_id = $1 AND x.id = $2
        AND ${participantConditionForAiEntity(normalized, 'x', '$3')}
      LIMIT 1`,
    [context.tenantId, recordId, scope.userId],
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new NotFoundException(`${scoped.label} not found.`);
  }
}
