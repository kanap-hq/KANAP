import type { EntityManager } from 'typeorm';
import type { AdminNodeView, DataAccessAdminService } from '../../data-access/data-access-admin.service';
import type { DataAccessMissing } from '../../data-access/data-access-availability';
import { compareText, dateMatch, paged, setMatch, textMatch } from './ai-support.query';

/**
 * Admin › Data access as the screen shows it, for the assistant and the MCP server: the family
 * `data_access`, one row per person in limited access and node, read through
 * `DataAccessAdminService.overview` (`GET /data-access`), never a second formula. The service
 * applies the screen's rules: a person holding the Administrator role (primary or additional) sees
 * all data whatever the stored mode and is listed nowhere. A person in limited access without a
 * node gives one row without a node: they see no budget or contract data.
 *
 * The list is small (the limited persons of a tenant): filtered, grouped, sorted and paged in
 * memory, here. The policy reads the family with users at admin level and for people whose access
 * is not limited only (`ai-policy.service.ts`), as the screen. No email is carried.
 */

export type AiDataAccessNodeType = 'all' | 'company' | 'cost_center';
export type AiDataAccessNodeKind = 'group' | 'cost_center';
export type AiDataAccessLevel = 'read' | 'edit';

export const AI_DATA_ACCESS_NODE_TYPES: readonly AiDataAccessNodeType[] = ['all', 'company', 'cost_center'];
export const AI_DATA_ACCESS_NODE_KINDS: readonly AiDataAccessNodeKind[] = ['group', 'cost_center'];
export const AI_DATA_ACCESS_LEVELS: readonly AiDataAccessLevel[] = ['read', 'edit'];

/** A node whose company or cost center no longer exists: the screen shows no name for it. */
export const AI_DATA_ACCESS_DELETED_NODE = 'deleted node';
/** The card of a person in limited access without a node. */
export const AI_DATA_ACCESS_NO_NODE_NOTE = 'No node: sees no budget or contract data.';
/** What the mode limits, and who is never listed. */
export const AI_DATA_ACCESS_COVERAGE_NOTE = 'Data access limits the budget and the contracts only: the other modules (applications, infrastructure, projects, tasks and the others) are not limited by it. People holding the Administrator role see all data and are never listed.';
/** The screen's alert when the function is not ready on the database. */
export const AI_DATA_ACCESS_UNAVAILABLE_NOTE = 'Limiting data access needs a one-time step on the database, done by the person who runs KANAP. Until it is done, a person in limited access is refused everywhere.';

/** What makes the function unavailable, in the screen's words (`admin:dataAccess.missingParts`). */
const MISSING_WORDS: Record<DataAccessMissing, string> = {
  role: 'the limited role',
  membership: 'the permission to use it',
  inheritance: 'the role separation',
  schema_create: 'a database permission',
  policies: 'the access rules',
  grants: 'the permissions on the tables',
};

export function dataAccessMissingWords(missing: readonly DataAccessMissing[]): string[] {
  return missing.map((code) => MISSING_WORDS[code] ?? 'a database setting');
}

export type AiDataAccessRow = {
  /** The person and the node's place in their list: a person with three nodes gives three rows. */
  key: string;
  person_id: string;
  person: string;
  /** Every role of the person, primary first. */
  roles: string[];
  node_type: AiDataAccessNodeType | null;
  /** The company's name, or `CODE name` of a cost center; null for `all` and for no node. */
  node: string | null;
  node_code: string | null;
  node_kind: AiDataAccessNodeKind | null;
  access: AiDataAccessLevel | null;
  changed_at: string | null;
  changed_by: string | null;
};

export type AiDataAccessServices = { dataAccess: Pick<DataAccessAdminService, 'overview'> };

export type AiDataAccessList = {
  items: AiDataAccessRow[];
  total: number;
  page: number;
  limit: number;
  available: boolean;
  missing: string[];
  counters: { limited_persons: number; lines_without_company: number };
  /** The distinct persons among every row the filters keep (a person with two nodes counts once). */
  distinct_total: number;
};

export const DATA_ACCESS_SORTS = new Set(['person', 'node_type', 'node', 'access', 'changed_at']);

function toIsoText(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return String(value);
}

/** The node's name as the screen writes it; a node whose company or center is gone says so. */
function nodeName(node: AdminNodeView): string | null {
  if (node.type === 'all') return null;
  if (node.type === 'company') return node.name ?? AI_DATA_ACCESS_DELETED_NODE;
  const parts = [node.code, node.name].filter((part): part is string => !!part && part.trim().length > 0);
  return parts.length > 0 ? parts.join(' ') : AI_DATA_ACCESS_DELETED_NODE;
}

/** Every row of the screen's overview, in its order: persons by name, nodes all, companies, centers. */
async function readRows(services: AiDataAccessServices, manager: EntityManager) {
  const overview = await services.dataAccess.overview(manager, {});
  const rows: AiDataAccessRow[] = [];
  for (const person of overview.persons) {
    const base = {
      person_id: person.id,
      person: person.name,
      roles: [...person.roles],
      changed_at: toIsoText(person.updated_at),
      changed_by: person.updated_by_name ?? null,
    };
    if (person.nodes.length === 0) {
      rows.push({ ...base, key: `${person.id}:none`, node_type: null, node: null, node_code: null, node_kind: null, access: null });
      continue;
    }
    person.nodes.forEach((node, index) => {
      rows.push({
        ...base,
        key: `${person.id}:${index}`,
        node_type: node.type,
        node: nodeName(node),
        node_code: node.type === 'cost_center' ? node.code ?? null : null,
        node_kind: node.type === 'cost_center' ? node.kind ?? null : null,
        access: node.access,
      });
    });
  }
  return { overview, rows };
}

/** A cost center code compares exactly, without case: `DIV` is not `DIV-BOU`. */
function codeMatch(value: string | null, model: any): boolean {
  if (!model) return true;
  const needle = String(model.filter ?? '').trim().toLowerCase();
  if (!needle) return true;
  return value != null && value.trim().toLowerCase() === needle;
}

function filtered(rows: AiDataAccessRow[], query: Record<string, any>): AiDataAccessRow[] {
  const filters = query.filters;
  const needle = String(query.q ?? '').trim().toLowerCase();
  return rows.filter((row) => textMatch(row.person, filters?.person)
    && textMatch(row.roles.join(', '), filters?.roles)
    && setMatch(row.node_type, filters?.node_type)
    && textMatch(row.node, filters?.node)
    && codeMatch(row.node_code, filters?.node_code)
    && setMatch(row.node_kind, filters?.node_kind)
    && setMatch(row.access, filters?.access)
    && dateMatch(row.changed_at, filters?.changed_at)
    && textMatch(row.changed_by, filters?.changed_by)
    && (!needle || [row.person, row.node, ...row.roles].some((value) => value != null && value.toLowerCase().includes(needle))));
}

function sortValue(row: AiDataAccessRow, field: string): string | number | null {
  switch (field) {
    case 'person': return row.person;
    case 'node_type': return row.node_type ? AI_DATA_ACCESS_NODE_TYPES.indexOf(row.node_type) : null;
    case 'node': return row.node;
    case 'access': return row.access ? AI_DATA_ACCESS_LEVELS.indexOf(row.access) : null;
    case 'changed_at': return row.changed_at;
    default: return null;
  }
}

function sortRows(rows: AiDataAccessRow[], sort: string | undefined): AiDataAccessRow[] {
  const [requested, requestedDirection] = String(sort ?? '').split(':');
  const field = DATA_ACCESS_SORTS.has(requested) ? requested : 'person';
  const descending = String(requestedDirection ?? 'asc').toLowerCase() === 'desc';
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, field) }))
    .sort((a, b) => {
      const order = typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value
        : compareText(a.value == null ? null : String(a.value), b.value == null ? null : String(b.value));
      // Ties keep the screen's order: persons by name, then each person's nodes.
      if (order === 0) return a.index - b.index;
      return descending ? -order : order;
    })
    .map((entry) => entry.row);
}

export async function listAiDataAccess(
  services: AiDataAccessServices,
  manager: EntityManager,
  query: Record<string, any>,
  readAll = false,
): Promise<AiDataAccessList> {
  const { overview, rows } = await readRows(services, manager);
  const kept = filtered(rows, query);
  return {
    ...paged(sortRows(kept, query.sort), query, readAll),
    available: overview.available,
    missing: dataAccessMissingWords(overview.missing),
    counters: {
      limited_persons: overview.counts.limited_persons,
      lines_without_company: overview.counts.lines_without_company,
    },
    distinct_total: new Set(kept.map((row) => row.person_id)).size,
  };
}

/** The group key of a row, for the in-memory aggregate. */
export function dataAccessGroupValue(row: AiDataAccessRow, groupBy: string): string | null {
  switch (groupBy) {
    case 'person': return row.person;
    case 'node_type': return row.node_type;
    case 'node': return row.node;
    case 'node_kind': return row.node_kind;
    case 'access': return row.access;
    default: return null;
  }
}

/** Rows and distinct persons of each group of the filtered rows, most rows first. */
export function aggregateDataAccessRows(
  rows: AiDataAccessRow[],
  groupBy: string,
): Array<{ key: string | null; count: number; distinct_count: number }> {
  const groups = new Map<string | null, { count: number; persons: Set<string> }>();
  for (const row of rows) {
    const key = dataAccessGroupValue(row, groupBy);
    const group = groups.get(key) ?? { count: 0, persons: new Set<string>() };
    group.count += 1;
    group.persons.add(row.person_id);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, count: group.count, distinct_count: group.persons.size }))
    .sort((a, b) => b.count - a.count || compareText(a.key, b.key));
}
