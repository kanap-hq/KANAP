import { ConflictException, HttpStatus } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { readUsages, type UsageQuery, type UsageType } from './record-usages';

/** What still uses a record, counted per kind (the groups of its usages). */
export type UsageCount = { type: UsageType; total: number };

const ENGLISH: Record<UsageType, [string, string]> = {
  budget_lines: ['budget line', 'budget lines'],
  contracts: ['contract', 'contracts'],
  applications: ['application', 'applications'],
  assets: ['asset', 'assets'],
  cost_centers: ['cost center', 'cost centers'],
  departments: ['department', 'departments'],
  users: ['user', 'users'],
  locations: ['location', 'locations'],
  tasks: ['task', 'tasks'],
  interfaces: ['interface', 'interfaces'],
  projects: ['project', 'projects'],
  requests: ['request', 'requests'],
  team_members: ['team member', 'team members'],
  suppliers: ['supplier', 'suppliers'],
};

function englishList(usages: readonly UsageCount[]): string {
  const parts = usages.map(({ type, total }) => `${total} ${ENGLISH[type][total === 1 ? 0 : 1]}`);
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * A delete refused because other records still use the record: a 409 whose `code` the interface
 * translates (`errors:<code>`, with the counts in `usages`), the English sentence in `message`.
 */
export class RecordInUseException extends ConflictException {
  constructor(
    readonly code: string,
    entity: string,
    name: string,
    readonly usages: UsageCount[],
  ) {
    super({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      code,
      message: `Cannot delete ${entity} "${name}": it is used by ${englishList(usages)}. Disable it instead.`,
      usages,
    });
  }
}

/**
 * Refuses the delete of a record that any of `queries` still finds, with every kind counted.
 * The caller's permissions play no part: a record used where the caller cannot look is still used.
 */
export async function assertNotInUse(
  manager: EntityManager,
  tenantId: string,
  recordId: string,
  queries: readonly UsageQuery[],
  refusal: { code: string; entity: string; name: string },
): Promise<void> {
  const { groups } = await readUsages(manager, tenantId, recordId, { isAdmin: true }, queries);
  if (groups.length === 0) return;
  throw new RecordInUseException(
    refusal.code,
    refusal.entity,
    refusal.name,
    groups.map((group) => ({ type: group.type, total: group.total })),
  );
}

/** The translatable part of a refusal, for a bulk delete's failed item. */
export function refusalDetails(error: unknown): { code?: string; usages?: UsageCount[] } {
  return error instanceof RecordInUseException ? { code: error.code, usages: error.usages } : {};
}
