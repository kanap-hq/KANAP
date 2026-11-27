import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { withFullDataAccess } from '../data-access/full-data-access';
import { englishList, lineUsages, type UsageCount } from './record-in-use';
import type { MembershipKind } from './record-membership';

/**
 * A department that records carry stays in its company, a stream that records carry stays in its
 * category (lot I7a of 26.12.1, decision of 2026-11-25): moving it would leave each of them with a
 * pair that contradicts itself (`record-membership.ts`). The move is refused (400), the records
 * counted per family, as the refusal of a delete counts them. An unused one moves.
 *
 * Only what the move would make contradictory counts: a record whose parent is not the new one. A
 * department: people, requests and projects with another company, and the OPEX and CAPEX lines whose
 * allocations put it with another company. A stream: requests, projects, tasks (their own stream,
 * with the category they show), contributors' defaults and documents with another category.
 *
 * The count reads every record of the tenant, those a person with limited data access cannot read
 * included (`withFullDataAccess`): the refusal is the same for everyone, and only counts leave it.
 */

const MOVES: Record<MembershipKind, { table: string; code: string; noun: string; parentNoun: string }> = {
  department: { table: 'departments', code: 'DEPARTMENT_MOVE_IN_USE', noun: 'department', parentNoun: 'company' },
  stream: { table: 'portfolio_streams', code: 'STREAM_MOVE_IN_USE', noun: 'stream', parentNoun: 'category' },
};

/** The counts of each move, over `m(id, parent)`: one query for every move asked. */
const COUNTS: Record<MembershipKind, (tenant: string) => string> = {
  department: (tenant) => `
    SELECT m.id::text AS id,
           (SELECT count(*)::int FROM users u
             WHERE u.tenant_id = ${tenant} AND u.department_id = m.id AND u.company_id <> m.parent) AS users,
           (SELECT count(*)::int FROM portfolio_requests r
             WHERE r.tenant_id = ${tenant} AND r.department_id = m.id AND r.company_id <> m.parent) AS requests,
           (SELECT count(*)::int FROM portfolio_projects p
             WHERE p.tenant_id = ${tenant} AND p.department_id = m.id AND p.company_id <> m.parent) AS projects,
           lines.opex, lines.capex
      FROM unnest($1::uuid[], $2::uuid[]) AS m(id, parent)
      CROSS JOIN LATERAL (
        SELECT count(DISTINCT si.id) FILTER (WHERE si.nature = 'opex')::int AS opex,
               count(DISTINCT si.id) FILTER (WHERE si.nature = 'capex')::int AS capex
          FROM spend_allocations a
          JOIN spend_versions v ON v.tenant_id = a.tenant_id AND v.id = a.version_id
          JOIN spend_items si ON si.tenant_id = v.tenant_id AND si.id = v.spend_item_id AND si.nature IN ('opex', 'capex')
         WHERE a.tenant_id = ${tenant} AND a.department_id = m.id AND a.company_id <> m.parent
      ) lines`,
  stream: (tenant) => `
    SELECT m.id::text AS id,
           (SELECT count(*)::int FROM portfolio_requests r
             WHERE r.tenant_id = ${tenant} AND r.stream_id = m.id AND r.category_id <> m.parent) AS requests,
           (SELECT count(*)::int FROM portfolio_projects p
             WHERE p.tenant_id = ${tenant} AND p.stream_id = m.id AND p.category_id <> m.parent) AS projects,
           (SELECT count(*)::int FROM tasks t
              LEFT JOIN portfolio_projects pp
                ON t.related_object_type = 'project' AND pp.tenant_id = t.tenant_id AND pp.id = t.related_object_id
             WHERE t.tenant_id = ${tenant} AND t.stream_id = m.id AND COALESCE(t.category_id, pp.category_id) <> m.parent) AS tasks,
           (SELECT count(*)::int FROM portfolio_team_member_configs c
             WHERE c.tenant_id = ${tenant} AND c.default_stream_id = m.id AND c.default_category_id <> m.parent) AS contributors,
           (SELECT count(DISTINCT d.document_id)::int FROM document_classifications d
             WHERE d.tenant_id = ${tenant} AND d.stream_id = m.id AND d.category_id <> m.parent) AS documents
      FROM unnest($1::uuid[], $2::uuid[]) AS m(id, parent)`,
};

/** The families of a count row, in the order the refusal lists them, each only when not zero. */
const FAMILIES: Record<MembershipKind, Array<'users' | 'requests' | 'projects' | 'tasks' | 'contributors' | 'documents'>> = {
  department: ['users', 'requests', 'projects'],
  stream: ['requests', 'projects', 'tasks', 'contributors', 'documents'],
};

/** Reads every row of the tenant: in a request's transaction, outside the person's limited access. */
function readEveryRow<T>(manager: EntityManager, read: (mg: EntityManager) => Promise<T>): Promise<T> {
  return manager.queryRunner?.isTransactionActive ? withFullDataAccess(manager, read) : read(manager);
}

/**
 * What each move would leave contradictory, by the id of the department or stream moved: the records
 * counted per family, none for a move that leaves nothing. `moves`: the record and its new parent.
 */
export async function memberMoveUsages(
  manager: EntityManager,
  kind: MembershipKind,
  moves: ReadonlyArray<{ id: string; parentId: string }>,
  tenantId?: string | null,
): Promise<Map<string, UsageCount[]>> {
  const usages = new Map<string, UsageCount[]>();
  if (moves.length === 0) return usages;
  const tenant = tenantId ? '$3' : 'app_current_tenant()';
  const params: unknown[] = [moves.map((move) => move.id), moves.map((move) => move.parentId), ...(tenantId ? [tenantId] : [])];
  const rows: Array<Record<string, number | string>> = await readEveryRow(manager, (mg) => mg.query(COUNTS[kind](tenant), params));
  for (const row of rows) {
    const counted: UsageCount[] = FAMILIES[kind]
      .filter((family) => Number(row[family] ?? 0) > 0)
      .map((family) => ({ type: family, total: Number(row[family]) }));
    if (kind === 'department') counted.push(...lineUsages({ opex: Number(row.opex ?? 0), capex: Number(row.capex ?? 0) }));
    if (counted.length > 0) usages.set(String(row.id).toLowerCase(), counted);
  }
  return usages;
}

/** The refusal of a move: its code, the English sentence with the counts, the counts and the name. */
export function memberMoveRefusal(
  kind: MembershipKind,
  name: string,
  usages: UsageCount[],
): { code: string; message: string; usages: UsageCount[]; params: { name: string } } {
  const { code, noun, parentNoun } = MOVES[kind];
  return {
    code,
    message: `The ${noun} "${name}" is used by ${englishList(usages)}. It cannot change ${parentNoun}.`,
    usages,
    params: { name },
  };
}

/**
 * Refuses (400) to move the department or stream `id` to `parentId` while records carry it. `lock`
 * (a write, in its transaction): the row is first locked `FOR UPDATE`, so a record that takes it at
 * the same moment (its foreign key takes `FOR KEY SHARE`) is either counted, or waits for the move.
 * A preview that writes nothing yet leaves it out.
 */
export async function assertMemberMoveAllowed(
  manager: EntityManager,
  kind: MembershipKind,
  id: string,
  parentId: string,
  opts: { tenantId?: string | null; lock: boolean },
): Promise<void> {
  const { table } = MOVES[kind];
  const tenant = opts.tenantId ? '$2' : 'app_current_tenant()';
  const params = opts.tenantId ? [id, opts.tenantId] : [id];
  const lock = opts.lock && manager.queryRunner?.isTransactionActive ? ' FOR UPDATE' : '';
  const [row]: Array<{ name: string }> = await manager.query(`SELECT name FROM ${table} WHERE tenant_id = ${tenant} AND id = $1${lock}`, params);
  if (!row) return;
  const usages = (await memberMoveUsages(manager, kind, [{ id, parentId }], opts.tenantId)).get(id.toLowerCase());
  if (!usages) return;
  throw new BadRequestException({ statusCode: 400, error: 'Bad Request', ...memberMoveRefusal(kind, row.name, usages) });
}
