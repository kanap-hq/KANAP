import { ConflictException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataAccessHiddenLinesException } from '../data-access/hidden-links';
import { mapDatabaseError } from './filters/database-error.mapping';
import { readUsages, type UsageCaller, type UsageQuery, type UsageType } from './record-usages';

/**
 * What still uses or holds a record, counted per kind: the groups of its usages, or what a record
 * holds that forbids its delete (a contract's recorded compliance requirements, a group's nodes).
 * The interface words each kind (`common:delete.usages.<kind>`).
 */
export type RefusalKind =
  | UsageType
  | 'compliance_requirements'
  | 'regulatory_records'
  | 'opex_lines'
  | 'capex_lines'
  | 'app_assignments'
  | 'connections'
  | 'nodes'
  | 'companies'
  | 'values'
  | 'sub_teams'
  | 'contributors'
  | 'interface_bindings'
  | 'server_assignments'
  | 'business_processes'
  | 'documents'
  | 'descriptions'
  | 'sub_folders'
  | 'app_instances'
  | 'incidents'
  | 'subnets'
  | 'technologies';
export type UsageCount = { type: RefusalKind; total: number };
/** Values a refusal's sentence names besides the counts (`errors:<code>` interpolates them): a column, a year. */
export type RefusalParams = Record<string, string | number>;

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
  data_access: ['data access', 'data access'],
  compliance_requirements: ['recorded compliance requirement', 'recorded compliance requirements'],
  regulatory_records: ['regulatory reporting record', 'regulatory reporting records'],
  opex_lines: ['OPEX line', 'OPEX lines'],
  capex_lines: ['CAPEX line', 'CAPEX lines'],
  app_assignments: ['application assignment', 'application assignments'],
  connections: ['connection', 'connections'],
  nodes: ['node', 'nodes'],
  companies: ['company', 'companies'],
  values: ['value', 'values'],
  sub_teams: ['sub-team', 'sub-teams'],
  contributors: ['contributor', 'contributors'],
  interface_bindings: ['interface binding', 'interface bindings'],
  server_assignments: ['server assignment', 'server assignments'],
  business_processes: ['business process', 'business processes'],
  documents: ['document', 'documents'],
  descriptions: ['description', 'descriptions'],
  technologies: ['technology', 'technologies'],
  sub_folders: ['subfolder', 'subfolders'],
  app_instances: ['deployment', 'deployments'],
  incidents: ['incident', 'incidents'],
  subnets: ['subnet', 'subnets'],
};

/** The OPEX and CAPEX line counts of a refusal, each kind only when not zero. */
export function lineUsages(usage: { opex: number; capex: number } | undefined): UsageCount[] {
  const usages: UsageCount[] = [];
  if (usage && usage.opex > 0) usages.push({ type: 'opex_lines', total: usage.opex });
  if (usage && usage.capex > 0) usages.push({ type: 'capex_lines', total: usage.capex });
  return usages;
}

export function englishList(usages: readonly UsageCount[]): string {
  const parts = usages.map(({ type, total }) => type === 'data_access'
    ? `the data access of ${total} ${total === 1 ? 'person' : 'people'}`
    : `${total} ${ENGLISH[type][total === 1 ? 0 : 1]}`);
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
    readonly params?: RefusalParams,
    /** The records the sentence names besides the counts (an asset's applications), for the screen. */
    readonly applications?: string[],
  ) {
    super({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      code,
      message,
      usages,
      ...(params ? { params } : {}),
      ...(applications && applications.length > 0 ? { applications } : {}),
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
export type DeleteRefusal = {
  id: string;
  name: string;
  code: string;
  usages: UsageCount[];
  params?: RefusalParams;
  applications?: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids a check reads: each well-formed uuid once, lower case, in the order asked. */
export function checkIds(ids: readonly unknown[] | null | undefined): string[] {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim().toLowerCase()).filter((id) => UUID_RE.test(id))));
}

/**
 * The check before a delete whose refusal is not a usages list alone: `rows` are the asked records
 * of the tenant (read by the caller), and `refusalOf` answers for each the refusal its delete
 * would throw, or null. The same function guards the delete, so the check and the delete agree.
 * In the order of `ids`; unknown ids are left out. Nothing is written.
 */
export async function refusalsFrom<R extends { id: string }>(
  ids: readonly string[],
  rows: readonly R[],
  nameOf: (row: R) => string,
  refusalOf: (row: R) => Promise<RecordInUseException | DataAccessHiddenLinesException | null>,
): Promise<{ refused: DeleteRefusal[] }> {
  const byId = new Map(rows.map((row) => [String(row.id).toLowerCase(), row]));
  const refused: DeleteRefusal[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const refusal = await refusalOf(row);
    if (refusal) {
      refused.push({
        id: row.id,
        name: nameOf(row),
        code: refusal.code,
        usages: refusal.usages,
        ...(refusal.params ? { params: refusal.params } : {}),
        ...(refusal instanceof RecordInUseException && refusal.applications ? { applications: refusal.applications } : {}),
      });
    }
  }
  return { refused };
}

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
  caller: UsageCaller = { isAdmin: true },
): Promise<{ refused: DeleteRefusal[] }> {
  const wanted = checkIds(ids);
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
    const { groups } = await readUsages(manager, row.tenant_id, row.id, caller, queries);
    if (groups.length > 0) refused.push({ id: row.id, name: row.name, code, usages: groups.map((g) => ({ type: g.type, total: g.total })) });
  }
  return { refused };
}

/**
 * The translatable part of a bulk delete's failed item: a refusal's code, counts and params; a
 * record gone meanwhile (`not_found`); a database refusal's mapped code (`in_use`, `retry`, ...)
 * with its English sentence as `reason`, in place of the driver's. Spread after `reason`.
 */
export function refusalDetails(error: unknown): { code?: string; usages?: UsageCount[]; params?: RefusalParams; applications?: string[]; reason?: string } {
  if (error instanceof RecordInUseException || error instanceof DataAccessHiddenLinesException) {
    return {
      code: error.code,
      usages: error.usages,
      ...(error.params ? { params: error.params } : {}),
      ...(error instanceof RecordInUseException && error.applications ? { applications: error.applications } : {}),
    };
  }
  if (error instanceof NotFoundException) return { code: 'not_found' };
  const mapped = mapDatabaseError(error);
  if (!mapped) return {};
  const message = (mapped.exception.getResponse() as { message?: unknown }).message;
  return { code: mapped.code, ...(typeof message === 'string' ? { reason: message } : {}) };
}
