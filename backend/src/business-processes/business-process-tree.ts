import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** The ISO 9001 types of a process: management (pilotage), core (réalisation), support. */
export const BUSINESS_PROCESS_TYPES = ['management', 'core', 'support'] as const;
export type BusinessProcessType = (typeof BUSINESS_PROCESS_TYPES)[number];

export function isBusinessProcessType(value: unknown): value is BusinessProcessType {
  return typeof value === 'string' && (BUSINESS_PROCESS_TYPES as readonly string[]).includes(value);
}

export const BUSINESS_PROCESS_PATH_SEPARATOR = ' › ';

/** The chain from `bp` up to the top (`hop` 0 is `bp`); the walk stops after 100 steps, so a cycle cannot loop. */
function upChainSql(alias: string): string {
  return `WITH RECURSIVE up AS (
      SELECT p.id, p.parent_id, p.name, 0 AS hop
        FROM business_processes p WHERE p.id = ${alias}.id AND p.tenant_id = ${alias}.tenant_id
      UNION ALL
      SELECT q.id, q.parent_id, q.name, up.hop + 1
        FROM business_processes q JOIN up ON q.id = up.parent_id
       WHERE q.tenant_id = ${alias}.tenant_id AND up.hop < 100)`;
}

/** The path of `bp` from the top of the tree, names joined by ` › ` ("Production › Aging"), for display. */
export function businessProcessPathSql(alias: string): string {
  return `(${upChainSql(alias)}
    SELECT string_agg(up.name, '${BUSINESS_PROCESS_PATH_SEPARATOR}' ORDER BY up.hop DESC) FROM up)`;
}

/** How deep `bp` sits: 0 at the top. */
export function businessProcessDepthSql(alias: string): string {
  return `(${upChainSql(alias)} SELECT max(up.hop) FROM up)`;
}

/**
 * The sort key of the tree order: the names from the top as an array of text sort keys, so each
 * process comes right after its parent whatever its name holds ("Sales - EMEA" after "Sales › Leads").
 */
export function businessProcessTreeSortSql(alias: string, textKey: (expr: string) => string): string {
  return `ARRAY(${upChainSql(alias)} SELECT ${textKey('up.name')} FROM up ORDER BY up.hop DESC)`;
}

/** The name of the parent of `bp`, null at the top. */
export function businessProcessParentNameSql(alias: string): string {
  return `(SELECT par.name FROM business_processes par WHERE par.id = ${alias}.parent_id AND par.tenant_id = ${alias}.tenant_id)`;
}

/** One stored process, as the tree needs it. */
export interface BusinessProcessTreeRow {
  id: string;
  name: string;
  parent_id: string | null;
  process_type: string | null;
  status: string;
  disabled_at: Date | string | null;
}

export interface BusinessProcessTreeNode {
  id: string;
  name: string;
  parent_id: string | null;
  process_type: string | null;
  status: string;
  disabled_at: string | null;
  depth: number;
  path: string;
  path_ids: string[];
}

const nameCollator = new Intl.Collator('en', { usage: 'sort', sensitivity: 'base', numeric: true });

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Orders the processes as a tree (siblings by name) and fills depth and path. A process whose
 * parent is missing is shown as a root, and one caught in a cycle still comes out once, at the end.
 */
export function buildBusinessProcessTree(rows: BusinessProcessTreeRow[]): BusinessProcessTreeNode[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string | null, BusinessProcessTreeRow[]>();
  for (const row of rows) {
    const key = row.parent_id && byId.has(row.parent_id) ? row.parent_id : null;
    children.set(key, [...(children.get(key) ?? []), row]);
  }
  for (const list of children.values()) list.sort((a, b) => nameCollator.compare(a.name, b.name) || a.id.localeCompare(b.id));

  const out: BusinessProcessTreeNode[] = [];
  const visited = new Set<string>();
  const visit = (row: BusinessProcessTreeRow, depth: number, path: string[], pathIds: string[]) => {
    if (visited.has(row.id)) return;
    visited.add(row.id);
    const names = [...path, row.name];
    const ids = [...pathIds, row.id];
    out.push({
      id: row.id,
      name: row.name,
      parent_id: row.parent_id,
      process_type: row.process_type,
      status: row.status,
      disabled_at: toIso(row.disabled_at),
      depth,
      path: names.join(BUSINESS_PROCESS_PATH_SEPARATOR),
      path_ids: ids,
    });
    for (const child of children.get(row.id) ?? []) visit(child, depth + 1, names, ids);
  };
  for (const root of children.get(null) ?? []) visit(root, 0, [], []);
  for (const row of rows) visit(row, 0, [], []);
  return out;
}

/** A refused write on a process, with its code (`errors:<code>`) and the names it quotes. */
export function businessProcessRefusal(code: string, message: string, params?: Record<string, string | number>): BadRequestException {
  return new BadRequestException({ code, message, field: 'parent_id', ...(params ? { params } : {}) });
}

/**
 * Serializes the writes of a tenant's process tree (create, update, delete, import). Without a
 * tenant set, every caller shares one key: the lock still holds, and the reads then see no rows.
 */
export async function lockBusinessProcessTree(manager: EntityManager): Promise<void> {
  await manager.query(
    `SELECT pg_advisory_xact_lock(hashtext('business-process-tree:' || COALESCE(app_current_tenant()::text, ''))::bigint)`,
  );
}

/**
 * Checks that `id` may sit under `parentId` in the stored tree, read after the tree lock: the
 * parent exists, is not the process itself, and is not inside it (its chain up to the top does
 * not pass through the process).
 */
export async function assertBusinessProcessParent(
  manager: EntityManager,
  process: { id: string | null; name: string },
  parentId: string | null,
): Promise<void> {
  if (!parentId) return;
  if (process.id && parentId === process.id) {
    throw businessProcessRefusal('BUSINESS_PROCESS_OWN_PARENT', 'A business process cannot be its own parent.');
  }
  // The chain up from the new parent. The stored tree has no cycle; UNION (not ALL) stops on one anyway.
  const chain: Array<{ id: string; name: string }> = await manager.query(
    `WITH RECURSIVE up AS (
         SELECT p.id, p.parent_id, p.name FROM business_processes p
          WHERE p.tenant_id = app_current_tenant() AND p.id = $1::uuid
         UNION
         SELECT q.id, q.parent_id, q.name FROM business_processes q JOIN up ON q.id = up.parent_id
          WHERE q.tenant_id = app_current_tenant())
     SELECT id::text AS id, name FROM up`,
    [parentId],
  );
  const parent = chain.find((row) => row.id === parentId);
  if (!parent) throw businessProcessRefusal('BUSINESS_PROCESS_PARENT_NOT_FOUND', 'Parent business process not found.');
  if (process.id && chain.some((row) => row.id === process.id)) {
    throw businessProcessRefusal(
      'BUSINESS_PROCESS_PARENT_CYCLE',
      `${process.name} cannot move under ${parent.name}, which is inside it.`,
      { name: process.name, parent: parent.name },
    );
  }
}
