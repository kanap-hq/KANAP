import { EntityManager } from 'typeorm';
import { DataAccessLimitedException, isLimitedTransaction } from './line-write-checks';

/**
 * Data-scoped access, lot 4 (planning/data-scoped-access/spec.md §5.4, §6.6): the budget lines
 * linked to a visible object that a limited person cannot read. They are counted by the SQL
 * function `data_access_hidden_count(type, id)`, never named: a link panel shows "and 3 lines
 * outside your access", and the delete of the object is refused, since its cascade would erase
 * links the person does not see.
 *
 * Lot 5 run 5C adds the second noun, contracts: an application, an asset and a technology link
 * contracts too (their link tables have a policy since run 5A), and the same delete refusal counts
 * them (`application_contract`, `asset_contract`, `technology_contract`). The line behaviour is
 * unchanged: `hiddenLineCount`, `hiddenLinesRefusals` and `assertNoHiddenLines` still count lines
 * alone.
 *
 * An unscoped person costs no query (the mode comes from the runner `applyDataAccess` served).
 */

/** The objects whose links to budget lines `data_access_hidden_count` counts, by their type there. */
export type HiddenLineOwner = 'application' | 'asset' | 'technology' | 'project' | 'request';

/** The objects whose links to contracts it counts: their types are `<owner>_contract` (lot 5, run 5A). */
export type HiddenContractOwner = 'application' | 'asset' | 'technology';

/**
 * Per type: the refusal code a delete check and a bulk delete return (`errors:<code>`), and the
 * noun of the English sentence.
 */
const OWNERS: Record<HiddenLineOwner, { code: string; noun: string }> = {
  application: { code: 'APPLICATION_HIDDEN_LINES', noun: 'application' },
  asset: { code: 'ASSET_HIDDEN_LINES', noun: 'asset' },
  technology: { code: 'TECHNOLOGY_HIDDEN_LINES', noun: 'technology' },
  project: { code: 'PROJECT_HIDDEN_LINES', noun: 'project' },
  request: { code: 'REQUEST_HIDDEN_LINES', noun: 'request' },
};

/** The contract refusal codes of the objects that can link contracts (the other two never can). */
const CONTRACT_CODES: Record<HiddenContractOwner, string> = {
  application: 'APPLICATION_HIDDEN_CONTRACTS',
  asset: 'ASSET_HIDDEN_CONTRACTS',
  technology: 'TECHNOLOGY_HIDDEN_CONTRACTS',
};

const isContractOwner = (owner: HiddenLineOwner): owner is HiddenContractOwner => owner in CONTRACT_CODES;

/** "This application is linked to 3 lines and 2 contracts outside your access." */
export function hiddenLinksMessage(owner: HiddenLineOwner, lines: number, contracts: number): string {
  const parts: string[] = [];
  if (lines > 0) parts.push(`${lines} ${lines === 1 ? 'line' : 'lines'}`);
  if (contracts > 0) parts.push(`${contracts} ${contracts === 1 ? 'contract' : 'contracts'}`);
  return `This ${OWNERS[owner].noun} is linked to ${parts.join(' and ')} outside your access.`;
}

/** "This application is linked to 3 lines outside your access." (unchanged) */
export function hiddenLinesMessage(owner: HiddenLineOwner, count: number): string {
  return hiddenLinksMessage(owner, count, 0);
}

/**
 * The delete of an object linked to lines or contracts the person cannot read: 403
 * `DATA_ACCESS_LIMITED` with the sentence, its reason (`hiddenLinks`, with the owner and both
 * counts in the body's `params`), and, for a delete check or a bulk delete, the refusal's own
 * `code` with the count (`params.count`, plus `params.contracts` when contracts are counted too),
 * as a `RecordInUseException` carries them (`common/record-in-use.ts`).
 */
export class DataAccessHiddenLinesException extends DataAccessLimitedException {
  readonly code: string;
  readonly usages: [] = [];
  readonly params: { count: number; contracts?: number };

  constructor(readonly owner: HiddenLineOwner, readonly count: number, readonly contracts = 0) {
    const lines = count;
    const code = lines > 0 || !isContractOwner(owner) ? OWNERS[owner].code : CONTRACT_CODES[owner];
    const params = contracts > 0 ? { count: lines > 0 ? lines : contracts, contracts } : { count };
    super(hiddenLinksMessage(owner, lines, contracts), {
      refusal: code,
      reason: 'hiddenLinks',
      params: { owner, lines, contracts },
    });
    this.code = code;
    this.params = params;
  }
}

/** The lines linked to the object that the person cannot read: 0 for an unscoped person, without a query. */
export async function hiddenLineCount(manager: EntityManager, owner: HiddenLineOwner, ownerId: string): Promise<number> {
  return (await hiddenLineCounts(manager, owner, [ownerId])).get(ownerId.toLowerCase()) ?? 0;
}

/** The same count for several objects of one type, in one query. */
export async function hiddenLineCounts(manager: EntityManager, owner: HiddenLineOwner, ownerIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ownerIds.length === 0 || !(await isLimitedTransaction(manager))) return counts;
  const rows: Array<{ id: string; n: number | null }> = await manager.query(
    `SELECT o.id, data_access_hidden_count($1, o.id) AS n FROM unnest($2::uuid[]) AS o(id)`,
    [owner, Array.from(new Set(ownerIds))],
  );
  // Keyed by the id as PostgreSQL writes it (lower case), whatever case the caller gave.
  for (const row of rows) counts.set(String(row.id).toLowerCase(), Number(row.n ?? 0));
  return counts;
}

/** The contracts linked to an application, an asset or a technology that the person cannot read. */
export async function hiddenContractCounts(
  manager: EntityManager,
  owner: HiddenContractOwner,
  ownerIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ownerIds.length === 0 || !(await isLimitedTransaction(manager))) return counts;
  const rows: Array<{ id: string; n: number | null }> = await manager.query(
    `SELECT o.id, data_access_hidden_count($1, o.id) AS n FROM unnest($2::uuid[]) AS o(id)`,
    [`${owner}_contract`, Array.from(new Set(ownerIds))],
  );
  for (const row of rows) counts.set(String(row.id).toLowerCase(), Number(row.n ?? 0));
  return counts;
}

/** The same count for one object. */
export async function hiddenContractCount(manager: EntityManager, owner: HiddenContractOwner, ownerId: string): Promise<number> {
  return (await hiddenContractCounts(manager, owner, [ownerId])).get(ownerId.toLowerCase()) ?? 0;
}

/**
 * The lines the person cannot read on one dimension value of the budget analytics report: the value
 * ids of that dimension, counted by `data_access_hidden_category_count(axis, values, active_from)`.
 * No query for an unscoped person, and none without a value. A value the function did not answer
 * (no hidden line, or a value of another dimension) is absent from the map.
 *
 * `activeFrom` is the report's lifecycle window (`YYYY-MM-DD`): a line with no end of validity, or
 * one ending on or after that day, is counted; null counts every line. It is the same day the
 * aggregate engine gives `windowScope`, so the count and the visible totals cover one window.
 *
 * `limited` lets a caller that already read the transaction mode skip the extra statement; absent,
 * the mode is read here.
 */
export async function hiddenCategoryLineCounts(
  manager: EntityManager,
  axisId: string,
  categoryIds: readonly string[],
  activeFrom: string | null = null,
  limited?: boolean,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const ids = Array.from(new Set(categoryIds.filter((id) => typeof id === 'string' && id !== '')));
  if (ids.length === 0 || !(limited ?? await isLimitedTransaction(manager))) return counts;
  const rows: Array<{ category_id: string | null; n: number | null }> = await manager.query(
    `SELECT category_id, n FROM data_access_hidden_category_count($1::uuid, $2::uuid[], $3::date)`,
    [axisId, ids, activeFrom],
  );
  for (const row of rows) {
    // Without data_access_apply() the function answers one all-NULL row, as the scalar count
    // answers NULL: no count, never a hidden line invented.
    if (row.category_id == null || row.n == null) continue;
    counts.set(String(row.category_id).toLowerCase(), Number(row.n));
  }
  return counts;
}

/** Both counts of each object, one query per type (no query for an unscoped person). */
async function hiddenCounts(
  manager: EntityManager,
  owner: HiddenLineOwner,
  ownerIds: readonly string[],
): Promise<Map<string, { lines: number; contracts: number }>> {
  const counts = new Map<string, { lines: number; contracts: number }>();
  if (ownerIds.length === 0 || !(await isLimitedTransaction(manager))) return counts;
  const contractType = isContractOwner(owner) ? `${owner}_contract` : null;
  const rows: Array<{ id: string; lines: number | null; contracts: number | null }> = await manager.query(
    `SELECT o.id, data_access_hidden_count($1, o.id) AS lines,
            ${contractType ? 'data_access_hidden_count($3, o.id)' : '0'} AS contracts
       FROM unnest($2::uuid[]) AS o(id)`,
    contractType ? [owner, Array.from(new Set(ownerIds)), contractType] : [owner, Array.from(new Set(ownerIds))],
  );
  for (const row of rows) {
    counts.set(String(row.id).toLowerCase(), { lines: Number(row.lines ?? 0), contracts: Number(row.contracts ?? 0) });
  }
  return counts;
}

/** The refusal of a delete of objects with hidden lines, per object (only those that have some). */
export async function hiddenLinesRefusals(
  manager: EntityManager,
  owner: HiddenLineOwner,
  ownerIds: readonly string[],
): Promise<Map<string, DataAccessHiddenLinesException>> {
  const refusals = new Map<string, DataAccessHiddenLinesException>();
  for (const [id, count] of await hiddenLineCounts(manager, owner, ownerIds)) {
    if (count > 0) refusals.set(id, new DataAccessHiddenLinesException(owner, count));
  }
  return refusals;
}

/** The same for lines and contracts together (an application, an asset or a technology). */
export async function hiddenLinksRefusals(
  manager: EntityManager,
  owner: HiddenLineOwner,
  ownerIds: readonly string[],
): Promise<Map<string, DataAccessHiddenLinesException>> {
  const refusals = new Map<string, DataAccessHiddenLinesException>();
  for (const [id, counts] of await hiddenCounts(manager, owner, ownerIds)) {
    if (counts.lines > 0 || counts.contracts > 0) refusals.set(id, new DataAccessHiddenLinesException(owner, counts.lines, counts.contracts));
  }
  return refusals;
}

/** Refuses the delete of an object linked to lines the person cannot read (spec §5.4). */
export async function assertNoHiddenLines(manager: EntityManager, owner: HiddenLineOwner, ownerId: string): Promise<void> {
  const count = await hiddenLineCount(manager, owner, ownerId);
  if (count > 0) throw new DataAccessHiddenLinesException(owner, count);
}

/** Refuses the delete of an object linked to lines or contracts the person cannot read (spec §5.4). */
export async function assertNoHiddenLinks(manager: EntityManager, owner: HiddenLineOwner, ownerId: string): Promise<void> {
  const counts = (await hiddenCounts(manager, owner, [ownerId])).get(ownerId.toLowerCase());
  if (counts && (counts.lines > 0 || counts.contracts > 0)) throw new DataAccessHiddenLinesException(owner, counts.lines, counts.contracts);
}

/**
 * What the audit row of a link replacement records as its set (before or after): the ids the
 * person replaced, and, when lines they cannot read stayed linked, their number (`hidden_kept`),
 * never their ids (spec §6.6: no other way to look past the access). Unchanged without hidden lines.
 */
export function auditedLinkSet<T>(set: T, hidden: number): T | { ids: unknown; hidden_kept: number } | (T & { hidden_kept: number }) {
  if (!hidden) return set;
  if (Array.isArray(set)) return { ids: set, hidden_kept: hidden };
  return { ...(set as T & object), hidden_kept: hidden } as T & { hidden_kept: number };
}
