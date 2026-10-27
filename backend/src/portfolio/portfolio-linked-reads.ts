import type { EntityManager } from 'typeorm';
import {
  applicationParticipantCondition,
  ParticipationAccessScope,
  projectParticipantCondition,
  requestParticipantCondition,
  taskParticipantCondition,
} from '../auth/business-contributor-scope';
import type { LinkedReads } from '../common/relations/linked-reads';

/**
 * What a project or a request detail may name of other records: each module on its read right
 * (`reads`), and a Business Contributor's projects, requests and tasks inside their participation.
 * Without it, the detail names none of them.
 */
export type PortfolioLinkedReads = {
  reads: LinkedReads;
  projectScope?: ParticipationAccessScope;
  requestScope?: ParticipationAccessScope;
  taskScope?: ParticipationAccessScope;
};

const PARTICIPATION: Record<'applications' | 'projects' | 'requests' | 'tasks', { table: string; condition: (alias: string, userRef: string) => string }> = {
  applications: { table: 'applications', condition: applicationParticipantCondition },
  projects: { table: 'portfolio_projects', condition: projectParticipantCondition },
  requests: { table: 'portfolio_requests', condition: requestParticipantCondition },
  tasks: { table: 'tasks', condition: taskParticipantCondition },
};

/**
 * The ids among `ids` that the participation scope lets the person read, in one query. Without a
 * scope (everyone but a Business Contributor), every id.
 */
export async function idsInScope(
  manager: EntityManager,
  family: keyof typeof PARTICIPATION,
  ids: Array<string | null | undefined>,
  scope: ParticipationAccessScope | undefined,
): Promise<Set<string>> {
  const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
  if (!scope || wanted.length === 0) return new Set(wanted);
  const { table, condition } = PARTICIPATION[family];
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT x.id
     FROM ${table} x
     WHERE x.tenant_id = app_current_tenant()
       AND x.id = ANY($1::uuid[])
       AND ${condition('x', '$2')}`,
    [wanted, scope.userId],
  );
  return new Set(rows.map((row) => String(row.id)));
}
