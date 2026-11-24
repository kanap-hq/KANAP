import { BadRequestException } from '@nestjs/common';

/**
 * A stream belongs to its category, a department to its company (lot I7a of 26.12.1, rules P12 and
 * P13). The one check of every write that sets such a pair: the screens through the API, the imports
 * and Kad. The child gives its parent: a stream written without a category fills the category, a
 * department without a company fills the company. A pair that contradicts itself is refused. A parent
 * changed without its child, or with its child sent back unchanged, drops the child, unless the child
 * belongs to the new parent.
 *
 * Only what the write changes is checked: a value equal to the stored one is no change, so a record
 * whose stored pair already disagrees stays writable as long as neither value of the pair changes.
 */

export type MembershipKind = 'stream' | 'department';

/** A pair of columns of a record: the child and the parent it must belong to. */
export interface MembershipPair {
  kind: MembershipKind;
  /** The record's column holding the child (`stream_id`, `default_stream_id`). */
  child: string;
  /** The record's column holding the parent (`category_id`). */
  parent: string;
}

/** Where each kind of child is stored, and the refusal that names it. */
const KINDS: Record<MembershipKind, { table: string; parentColumn: string; parentTable: string; code: string; noun: string; parentNoun: string }> = {
  stream: {
    table: 'portfolio_streams', parentColumn: 'category_id', parentTable: 'portfolio_categories',
    code: 'STREAM_OUTSIDE_CATEGORY', noun: 'stream', parentNoun: 'category',
  },
  department: {
    table: 'departments', parentColumn: 'company_id', parentTable: 'companies',
    code: 'DEPARTMENT_OUTSIDE_COMPANY', noun: 'department', parentNoun: 'company',
  },
};

export const STREAM_PAIR: MembershipPair = { kind: 'stream', child: 'stream_id', parent: 'category_id' };
export const DEPARTMENT_PAIR: MembershipPair = { kind: 'department', child: 'department_id', parent: 'company_id' };
/** Requests and projects carry both pairs. */
export const PORTFOLIO_PAIRS: readonly MembershipPair[] = [STREAM_PAIR, DEPARTMENT_PAIR];

export type MembershipValues = Record<string, string | null>;

export interface MembershipConflict {
  pair: MembershipPair;
  childId: string;
  /** The parent the write leaves on the record. */
  parentId: string;
  /** The parent the child belongs to. */
  childParentId: string;
}

/** The parent of a child record (`undefined` when the child is unknown: the write's own check refuses it). */
export type ParentOf = (kind: MembershipKind, childId: string) => string | null | undefined;

const valueOf = (value: unknown): string | null => (value == null || value === '' ? null : String(value));
const sameId = (left: unknown, right: unknown) => (valueOf(left)?.toLowerCase() ?? null) === (valueOf(right)?.toLowerCase() ?? null);
const has = (values: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(values, key);

/**
 * The rule, on values already read. `given`: what the write sets, its keys only (`''` reads as null).
 * `stored`: the record as stored, null for a new one (a task of a project passes its project's values
 * where it has none of its own). Returns the values of the pairs to write (the given ones, the parent a
 * child gives, a child its parent's change drops) and the first conflict, if any.
 */
export function settleMembership(
  pairs: readonly MembershipPair[],
  given: Record<string, unknown>,
  storedRecord: object | null | undefined,
  parentOf: ParentOf,
): { values: MembershipValues; conflict: MembershipConflict | null } {
  const stored = storedRecord as Record<string, unknown> | null | undefined;
  const values: MembershipValues = {};
  for (const pair of pairs) {
    const childGiven = has(given, pair.child);
    const parentGiven = has(given, pair.parent);
    if (childGiven) values[pair.child] = valueOf(given[pair.child]);
    if (parentGiven) values[pair.parent] = valueOf(given[pair.parent]);
    const childChanged = childGiven && !sameId(given[pair.child], stored?.[pair.child]);
    const parentChanged = parentGiven && !sameId(given[pair.parent], stored?.[pair.parent]);
    if (!childChanged && !parentChanged) continue;
    const child = childGiven ? valueOf(given[pair.child]) : valueOf(stored?.[pair.child]);
    const parent = parentGiven ? valueOf(given[pair.parent]) : valueOf(stored?.[pair.parent]);
    if (!child) continue;
    const own = parentOf(pair.kind, child);
    if (own == null) continue;
    if (!childChanged) {
      // The parent changed alone, or with its child sent back as stored (the forms send every value):
      // the child stays only if it belongs to the new parent. A new record has nothing stored, so the
      // pair it is given is judged as sent.
      if (!sameId(own, parent)) values[pair.child] = null;
      continue;
    }
    if (!parent) {
      values[pair.parent] = own;
      continue;
    }
    if (!sameId(own, parent)) return { values, conflict: { pair, childId: child, parentId: parent, childParentId: own } };
  }
  return { values, conflict: null };
}

/** The ids of the children a write may need the parent of, by kind. */
function childIds(pairs: readonly MembershipPair[], ...records: Array<object | null | undefined>): Map<MembershipKind, string[]> {
  const ids = new Map<MembershipKind, Set<string>>();
  for (const pair of pairs) {
    for (const record of records) {
      const id = valueOf((record as Record<string, unknown> | null | undefined)?.[pair.child]);
      if (!id) continue;
      if (!ids.has(pair.kind)) ids.set(pair.kind, new Set());
      ids.get(pair.kind)!.add(id.toLowerCase());
    }
  }
  return new Map([...ids].map(([kind, set]) => [kind, [...set]]));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

/** The parents of the children named, read in the tenant (`app.current_tenant` when no tenant is given). */
export async function loadMembershipParents(
  manager: Queryable,
  ids: Map<MembershipKind, string[]>,
  tenantId?: string | null,
): Promise<ParentOf> {
  const parents = new Map<string, string | null>();
  for (const [kind, list] of ids) {
    const uuids = list.filter((id) => UUID_RE.test(id));
    if (uuids.length === 0) continue;
    const { table, parentColumn } = KINDS[kind];
    const rows: Array<{ id: string; parent: string | null }> = await manager.query(
      `SELECT id::text AS id, ${parentColumn}::text AS parent FROM ${table}
        WHERE tenant_id = ${tenantId ? '$2' : 'app_current_tenant()'} AND id = ANY($1::uuid[])`,
      tenantId ? [uuids, tenantId] : [uuids],
    );
    for (const row of rows) parents.set(`${kind}:${row.id.toLowerCase()}`, row.parent);
  }
  return (kind, childId) => parents.get(`${kind}:${childId.toLowerCase()}`);
}

/** The refusal of a conflict, worded with the names of the child and both parents. */
export async function membershipRefusal(
  manager: Queryable,
  conflict: MembershipConflict,
  tenantId?: string | null,
): Promise<{ code: string; message: string; params: Record<string, string> }> {
  const { table, parentTable } = KINDS[conflict.pair.kind];
  const tenant = tenantId ? '$4' : 'app_current_tenant()';
  const rows: Array<{ id: string; name: string }> = await manager.query(
    `SELECT id::text AS id, name FROM ${table} WHERE tenant_id = ${tenant} AND id = $1::uuid
     UNION ALL
     SELECT id::text AS id, name FROM ${parentTable} WHERE tenant_id = ${tenant} AND id = ANY(ARRAY[$2::uuid, $3::uuid])`,
    tenantId ? [conflict.childId, conflict.parentId, conflict.childParentId, tenantId] : [conflict.childId, conflict.parentId, conflict.childParentId],
  );
  const nameOf = (id: string) => rows.find((row) => row.id.toLowerCase() === id.toLowerCase())?.name ?? id;
  return membershipMessage(conflict.pair.kind, { child: nameOf(conflict.childId), childParent: nameOf(conflict.childParentId), parent: nameOf(conflict.parentId) });
}

/** The refusal of a conflict, from the names of the child, its own parent and the record's parent. */
export function membershipMessage(
  kind: MembershipKind,
  params: { child: string; childParent: string; parent: string },
): { code: string; message: string; params: Record<string, string> } {
  const { code, noun, parentNoun } = KINDS[kind];
  return {
    code,
    message: `The ${noun} "${params.child}" belongs to the ${parentNoun} "${params.childParent}". It cannot go with the ${parentNoun} "${params.parent}".`,
    params: { ...params },
  };
}

/**
 * The check of a write through a service: the values of the pairs to write, or a 400 that names the
 * child and both parents (`STREAM_OUTSIDE_CATEGORY`, `DEPARTMENT_OUTSIDE_COMPANY`).
 */
export async function settleRecordMembership(
  manager: Queryable,
  pairs: readonly MembershipPair[],
  given: Record<string, unknown>,
  stored: object | null | undefined,
  tenantId?: string | null,
): Promise<MembershipValues> {
  if (!pairs.some((pair) => has(given, pair.child) || has(given, pair.parent))) return {};
  const parentOf = await loadMembershipParents(manager, childIds(pairs, given, stored), tenantId);
  const { values, conflict } = settleMembership(pairs, given, stored, parentOf);
  if (conflict) throw new BadRequestException({ statusCode: 400, error: 'Bad Request', ...(await membershipRefusal(manager, conflict, tenantId)) });
  return values;
}

/**
 * The lock of the record read before a write that gives a value of a pair: `FOR NO KEY UPDATE`, as the
 * write's own UPDATE takes it, so two writes at the same moment (one changes the category, the other
 * the stream) are checked one after the other and never store a pair that contradicts itself. None
 * outside a transaction (the lock would end with the read) or when the write leaves the pairs alone.
 */
export function membershipReadLock(
  manager: { queryRunner?: { isTransactionActive?: boolean } | null },
  pairs: readonly MembershipPair[],
  body: Record<string, unknown> | null | undefined,
): { lock?: { mode: 'for_no_key_update' } } {
  if (!manager.queryRunner?.isTransactionActive) return {};
  return Object.keys(givenMembership(pairs, body)).length > 0 ? { lock: { mode: 'for_no_key_update' } } : {};
}

/** The keys of `body` among the pairs' columns, with their values: what a write gives. */
export function givenMembership(pairs: readonly MembershipPair[], body: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const given: Record<string, unknown> = {};
  if (!body) return given;
  for (const pair of pairs) {
    for (const key of [pair.child, pair.parent]) if (has(body, key) && body[key] !== undefined) given[key] = body[key];
  }
  return given;
}


/** How many parents a refusal names before it says how many more there are. */
const LISTED_PARENTS = 10;

/**
 * A name several records share (two streams "Ops" of two categories), for Kad (P12 of 26.12.1): the
 * record of that name in `parentId`, the parent the write leaves on the record, looked up in the
 * database (`rows`, a page of candidates, may leave it out). None there, or no parent: a 400 that
 * names the parents that have one (ten, then how many more), for Kad to ask which.
 */
export async function pickMemberByParent<T extends object>(
  manager: Queryable,
  kind: MembershipKind,
  rows: T[],
  name: string,
  parentId: string | null | undefined,
  tenantId?: string | null,
): Promise<T | Record<string, unknown>> {
  if (rows.length === 1) return rows[0];
  const { table, parentColumn, parentTable, noun, parentNoun } = KINDS[kind];
  const tenant = (index: number) => (tenantId ? `$${index}` : 'app_current_tenant()');
  const withTenant = (params: unknown[]) => (tenantId ? [...params, tenantId] : params);
  const parent = valueOf(parentId);
  if (parent && UUID_RE.test(parent)) {
    const inParent: Record<string, unknown>[] = await manager.query(
      `SELECT * FROM ${table} WHERE tenant_id = ${tenant(3)} AND LOWER(name) = LOWER($1::text) AND ${parentColumn} = $2::uuid LIMIT 2`,
      withTenant([name, parent]),
    );
    if (inParent.length === 1) return inParent[0];
  }
  const parents: Array<{ name: string }> = await manager.query(
    `SELECT DISTINCT p.name FROM ${table} c
       JOIN ${parentTable} p ON p.id = c.${parentColumn} AND p.tenant_id = c.tenant_id
      WHERE c.tenant_id = ${tenant(2)} AND LOWER(c.name) = LOWER($1::text)
      ORDER BY p.name`,
    withTenant([name]),
  );
  const more = parents.length - LISTED_PARENTS;
  const listed = parents.slice(0, LISTED_PARENTS).map((row) => `"${row.name}"`).join(', ') + (more > 0 ? ` and ${more} more` : '');
  const plural = kind === 'stream' ? 'categories' : 'companies';
  throw new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: kind === 'stream' ? 'STREAM_NAME_IN_SEVERAL_CATEGORIES' : 'DEPARTMENT_NAME_IN_SEVERAL_COMPANIES',
    message: parentId
      ? `No ${noun} "${name}" belongs to the record's ${parentNoun}. The ${plural} that have one: ${listed}.`
      : `Several ${noun}s are named "${name}", in the ${plural} ${listed}. Ask which ${parentNoun} is meant, or set the ${parentNoun} first.`,
    params: { value: name, parents: parents.slice(0, LISTED_PARENTS).map((row) => row.name).join(', ') + (more > 0 ? ` +${more}` : '') },
  });
}
