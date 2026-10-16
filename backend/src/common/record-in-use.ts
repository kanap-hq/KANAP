import { ConflictException, HttpStatus } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { readUsages, type UsageQuery, type UsageType } from './record-usages';

/**
 * What still uses or holds a record, counted per kind: the groups of its usages, or what a record
 * holds that forbids its delete (a contract's recorded compliance requirements).
 */
export type RefusalKind = UsageType | 'compliance_requirements';
export type UsageCount = { type: RefusalKind; total: number };

const ENGLISH: Record<RefusalKind, [string, string]> = {
  budget_lines: ['budget line', 'budget lines'],
  allocation_rules: ['default allocation method', 'default allocation methods'],
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
  compliance_requirements: ['recorded compliance requirement', 'recorded compliance requirements'],
};

export function englishList(usages: readonly UsageCount[]): string {
  const parts = usages.map(({ type, total }) => `${total} ${ENGLISH[type][total === 1 ? 0 : 1]}`);
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * A delete refused because other records still use the record, or because of what it holds: a
 * 409 whose `code` the interface translates (`errors:<code>`, with the counts in `usages`), the
 * English sentence in `message` ("it is used by …" unless the caller words it).
 */
export class RecordInUseException extends ConflictException {
  constructor(
    readonly code: string,
    entity: string,
    name: string,
    readonly usages: UsageCount[],
    message = `Cannot delete ${entity} "${name}": it is used by ${englishList(usages)}. Disable it instead.`,
  ) {
    super({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      code,
      message,
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

/** A record a delete would refuse, as a check before the delete lists it (`refusalsOf`). */
export type DeleteRefusal = { id: string; name: string; code: string; usages: UsageCount[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The check before a delete: of the asked records of the tenant (`table`, with a `name`), those
 * `assertNotInUse` would refuse, with the counts per kind, in the order asked. Unknown or
 * malformed ids are left out (the delete answers them). Nothing is written.
 */
export async function refusalsOf(
  manager: EntityManager,
  table: string,
  ids: readonly string[],
  queries: readonly UsageQuery[],
  code: string,
): Promise<{ refused: DeleteRefusal[] }> {
  const wanted = Array.from(new Set((ids || []).map((id) => String(id || '').trim().toLowerCase()).filter((id) => UUID_RE.test(id))));
  if (wanted.length === 0) return { refused: [] };
  const rows: Array<{ id: string; name: string; tenant_id: string }> = await manager.query(
    `SELECT id, name, tenant_id FROM ${table} WHERE tenant_id = app_current_tenant() AND id = ANY($1::uuid[])`,
    [wanted],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const refused: DeleteRefusal[] = [];
  for (const id of wanted) {
    const row = byId.get(id);
    if (!row) continue;
    const { groups } = await readUsages(manager, row.tenant_id, row.id, { isAdmin: true }, queries);
    if (groups.length > 0) refused.push({ id: row.id, name: row.name, code, usages: groups.map((g) => ({ type: g.type, total: g.total })) });
  }
  return { refused };
}

/** The translatable part of a refusal, for a bulk delete's failed item. */
export function refusalDetails(error: unknown): { code?: string; usages?: UsageCount[] } {
  return error instanceof RecordInUseException ? { code: error.code, usages: error.usages } : {};
}
