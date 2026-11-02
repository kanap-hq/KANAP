import type { EntityManager } from 'typeorm';
import type { CostCenterListRow, CostCentersService } from '../../cost-centers/cost-centers.service';
import { AI_PERSON_WITHOUT_NAME, compareText, dateMatch, numberMatch, paged, setMatch, textMatch } from './ai-support.query';

/**
 * Master data › Cost centers as the screen shows it, for the assistant and the MCP server: the
 * family `cost_centers`, one row per node of the tree (a group or a cost center), read through
 * `CostCentersService.listAll` and `get` (`GET /cost-centers`, `GET /cost-centers/:id`), never a
 * second formula: the tree order, the paths and the quick search are the service's.
 *
 * The tree is small (tens of nodes): filtered, grouped, sorted and paged in memory, here. Every
 * node is read, the disabled ones included (`status` is on every row): the screen opens on the
 * enabled ones only. A node's reference is its code, unique in the workspace; its name may repeat
 * under two groups, the path tells them apart. The budget holder is a name only, never an email:
 * a person without a name gives `AI_PERSON_WITHOUT_NAME`, and null is a node without one. A person in limited access reads the whole tree, as the
 * screen; only the line counts of the detail are narrowed to their access.
 */

export type AiCostCenterKind = 'group' | 'cost_center';
export type AiCostCenterStatus = 'enabled' | 'disabled';
/** Where the quick search found the node: its code, its name, or only its path (a group above it). */
export type AiCostCenterMatch = 'code' | 'name' | 'path';

export const AI_COST_CENTER_KINDS: readonly AiCostCenterKind[] = ['group', 'cost_center'];
export const AI_COST_CENTER_STATUSES: readonly AiCostCenterStatus[] = ['enabled', 'disabled'];

export type AiCostCenterRow = {
  id: string;
  code: string;
  name: string;
  kind: AiCostCenterKind;
  /** The parent group's name and code; null for a node at the top. */
  parent: string | null;
  parent_code: string | null;
  company: string | null;
  /** The budget holder's name; `AI_PERSON_WITHOUT_NAME` for a person with no name (never an email); null without one. */
  budget_holder: string | null;
  status: AiCostCenterStatus;
  depth: number;
  path: string;
  /** How many nodes sit directly under it. */
  children: number;
  disabled_at: string | null;
  /** Set when the query has a quick search. */
  matched_on?: AiCostCenterMatch;
};

export type AiCostCentersServices = { costCenters: Pick<CostCentersService, 'listAll' | 'get'> };
export type AiCostCentersOpts = { manager: EntityManager; tenantId: string };

export type AiCostCentersList = {
  items: AiCostCenterRow[];
  total: number;
  page: number;
  limit: number;
  /** The `under` and `parent` values that name no node of the tree, said in words. */
  unmatched_note: string | null;
};

export const COST_CENTER_SORTS = new Set([
  'path', 'code', 'name', 'kind', 'parent', 'company', 'budget_holder', 'status', 'depth', 'disabled_at',
]);

/** The service's own query for every node, disabled ones included. */
const EVERY_NODE = { includeDisabled: 'true' };

/**
 * The budget holders' names, without the email the tree falls back to (`loadCostCenterTree`): one
 * query on the owners of the tree, a person with no name giving `AI_PERSON_WITHOUT_NAME`.
 */
async function holderNames(opts: AiCostCentersOpts, ownerIds: Array<string | null>): Promise<Map<string, string | null>> {
  const ids = Array.from(new Set(ownerIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return new Map();
  const rows: Array<{ id: string; name: string | null }> = await opts.manager.query(
    `SELECT id, NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), '') AS name
       FROM users
      WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [opts.tenantId, ids],
  );
  return new Map(rows.map((row) => [String(row.id), row.name ?? AI_PERSON_WITHOUT_NAME]));
}

function toRow(node: CostCenterListRow, children: Map<string, number>, names: Map<string, string | null>): AiCostCenterRow {
  return {
    id: node.id,
    code: node.code,
    name: node.name,
    kind: node.kind,
    parent: node.parent_name ?? null,
    parent_code: node.parent_code ?? null,
    company: node.company_name ?? null,
    budget_holder: node.owner_user_id ? names.get(node.owner_user_id) ?? null : null,
    status: node.status,
    depth: node.depth,
    path: node.path,
    children: children.get(node.id) ?? 0,
    disabled_at: node.disabled_at ?? null,
  };
}

/** Every node of the tree in its order, with the ids above each one (`path_ids`). */
export async function readAiCostCenterTree(services: AiCostCentersServices, opts: AiCostCentersOpts): Promise<{
  rows: AiCostCenterRow[];
  pathIds: Map<string, string[]>;
}> {
  const nodes = await services.costCenters.listAll(EVERY_NODE, { manager: opts.manager, tenantId: opts.tenantId });
  const children = new Map<string, number>();
  for (const node of nodes) {
    if (node.parent_id) children.set(node.parent_id, (children.get(node.parent_id) ?? 0) + 1);
  }
  const names = await holderNames(opts, nodes.map((node) => node.owner_user_id));
  return {
    rows: nodes.map((node) => toRow(node, children, names)),
    pathIds: new Map(nodes.map((node) => [node.id, node.path_ids])),
  };
}

/** A node named by its code or its name, exactly and without case: `DIV` is not `DIV-BOU`. */
function namedNodes(rows: AiCostCenterRow[], model: any): { needle: string; ids: Set<string> } | null {
  if (!model) return null;
  const needle = String(model.filter ?? '').trim();
  if (!needle) return null;
  const lower = needle.toLowerCase();
  return { needle, ids: new Set(rows.filter((row) => row.code.toLowerCase() === lower || row.name.toLowerCase() === lower).map((row) => row.id)) };
}

function matchedOn(row: AiCostCenterRow, needle: string): AiCostCenterMatch {
  if (row.code.toLowerCase().includes(needle)) return 'code';
  if (row.name.toLowerCase().includes(needle)) return 'name';
  return 'path';
}

function sortValue(row: AiCostCenterRow, field: string): string | number | null {
  switch (field) {
    case 'code': return row.code;
    case 'name': return row.name;
    case 'kind': return AI_COST_CENTER_KINDS.indexOf(row.kind);
    case 'parent': return row.parent;
    case 'company': return row.company;
    case 'budget_holder': return row.budget_holder;
    case 'status': return AI_COST_CENTER_STATUSES.indexOf(row.status);
    case 'depth': return row.depth;
    case 'disabled_at': return row.disabled_at;
    default: return null;
  }
}

/**
 * The requested order, the tree's by default (`path`), as the screen; ties and blanks keep the
 * tree's order, blanks last. With a quick search, a node whose code or name equals it comes first.
 */
function sortRows(rows: AiCostCenterRow[], sort: string | undefined, exact: (row: AiCostCenterRow) => boolean): AiCostCenterRow[] {
  const [requested, requestedDirection] = String(sort ?? '').split(':');
  const field = COST_CENTER_SORTS.has(requested) ? requested : 'path';
  const descending = String(requestedDirection ?? 'asc').toLowerCase() === 'desc';
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, field), exact: exact(row) }))
    .sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      if (field === 'path') return descending ? b.index - a.index : a.index - b.index;
      if (a.value == null || b.value == null) {
        if (a.value == null && b.value == null) return a.index - b.index;
        return a.value == null ? 1 : -1;
      }
      const order = typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value
        : compareText(String(a.value), String(b.value));
      if (order === 0) return a.index - b.index;
      return descending ? -order : order;
    })
    .map((entry) => entry.row);
}

/**
 * The nodes the query keeps, in its order: the filters, then the screen's quick search (code,
 * name or path contain it, `CostCentersService`), each kept node saying where it matched.
 */
export async function filterAiCostCenters(
  services: AiCostCentersServices,
  opts: AiCostCentersOpts,
  query: Record<string, any>,
): Promise<{ rows: AiCostCenterRow[]; unmatched_note: string | null }> {
  const { rows, pathIds } = await readAiCostCenterTree(services, opts);
  const filters = query.filters ?? {};
  const unmatched: string[] = [];

  // `under`: every node below the named groups, at every level, the groups themselves left out.
  const under = namedNodes(rows, filters.under);
  if (under && under.ids.size === 0) unmatched.push(`under "${under.needle}"`);
  // `parent`: the nodes directly under the named groups.
  const parent = namedNodes(rows, filters.parent);
  if (parent && parent.ids.size === 0) unmatched.push(`parent "${parent.needle}"`);
  const parentOf = new Map(rows.map((row) => [row.id, (pathIds.get(row.id) ?? []).slice(-2, -1)[0] ?? null]));

  const q = String(query.q ?? '').trim();
  const searched = q
    ? new Set((await services.costCenters.listAll({ ...EVERY_NODE, q }, { manager: opts.manager, tenantId: opts.tenantId })).map((node) => node.id))
    : null;
  const needle = q.toLowerCase();

  const kept = rows
    .filter((row) => textMatch(row.code, filters.code)
      && textMatch(row.name, filters.name)
      && setMatch(row.kind, filters.kind)
      && setMatch(row.company, filters.company)
      && setMatch(row.budget_holder, filters.budget_holder)
      && setMatch(row.status, filters.status)
      && numberMatch(row.depth, filters.depth)
      && textMatch(row.path, filters.path)
      && dateMatch(row.disabled_at, filters.disabled_at)
      && (!under || (pathIds.get(row.id) ?? []).slice(0, -1).some((id) => under.ids.has(id)))
      && (!parent || parent.ids.has(parentOf.get(row.id) ?? ''))
      && (!searched || searched.has(row.id)))
    .map((row) => (searched ? { ...row, matched_on: matchedOn(row, needle) } : row));

  const exact = (row: AiCostCenterRow) => !!needle && (row.code.toLowerCase() === needle || row.name.toLowerCase() === needle);
  return {
    rows: sortRows(kept, query.sort, exact),
    unmatched_note: unmatched.length
      ? `No cost center or group has the code or name given in ${unmatched.join(' and ')} (compared exactly, without case): the filter keeps no node. A part of a name is searched with q.`
      : null,
  };
}

export async function listAiCostCenters(
  services: AiCostCentersServices,
  opts: AiCostCentersOpts,
  query: Record<string, any>,
  readAll = false,
): Promise<AiCostCentersList> {
  const { rows, unmatched_note } = await filterAiCostCenters(services, opts, query);
  return { ...paged(rows, query, readAll), unmatched_note };
}

/** The group key of a row, for the in-memory aggregate. */
export function costCenterGroupValue(row: AiCostCenterRow, groupBy: string): string | null {
  switch (groupBy) {
    case 'kind': return row.kind;
    case 'company': return row.company;
    case 'parent': return row.parent_code ? `${row.parent_code} · ${row.parent}` : null;
    case 'status': return row.status;
    case 'budget_holder': return row.budget_holder;
    default: return null;
  }
}

/** The nodes of each group of the filtered rows, most nodes first. */
export function aggregateCostCenterRows(rows: AiCostCenterRow[], groupBy: string): Array<{ key: string | null; count: number }> {
  const groups = new Map<string | null, number>();
  for (const row of rows) {
    const key = costCenterGroupValue(row, groupBy);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || compareText(a.key, b.key));
}

/** The distinct values of a set field, for get_filter_values: the names the rows carry, null when one has none. */
export function costCenterFilterValues(rows: AiCostCenterRow[], field: 'company' | 'budget_holder'): Array<string | null> {
  const values = Array.from(new Set(rows.map((row) => row[field])));
  return values.sort((a, b) => compareText(a, b));
}

/**
 * One node as its page shows it (`CostCentersService.get`): the row, its description, the budget
 * lines that use it (`opex_count`, `capex_count`, counted through the lines' access rules) and the
 * nodes directly under it, in the tree's order.
 */
export async function aiCostCenterDetail(
  services: AiCostCentersServices,
  opts: AiCostCentersOpts,
  id: string,
): Promise<{ row: AiCostCenterRow; data: Record<string, unknown> }> {
  const { rows } = await readAiCostCenterTree(services, opts);
  const detail = await services.costCenters.get(id, { manager: opts.manager, tenantId: opts.tenantId });
  const row = rows.find((entry) => entry.id === detail.id);
  if (!row) throw new Error(`Cost center ${id} is not in the tree.`);
  const children = rows
    .filter((entry) => entry.parent_code === row.code)
    .map((entry) => ({ code: entry.code, name: entry.name, kind: entry.kind, status: entry.status, budget_holder: entry.budget_holder }));
  return {
    row,
    data: {
      code: row.code,
      name: row.name,
      kind: row.kind,
      parent: row.parent,
      parent_code: row.parent_code,
      company: row.company,
      budget_holder: row.budget_holder,
      status: row.status,
      disabled_at: row.disabled_at,
      depth: row.depth,
      path: row.path,
      description: detail.description ?? null,
      opex_count: detail.opex_count,
      capex_count: detail.capex_count,
      children,
    },
  };
}
