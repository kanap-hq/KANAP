import { EntityManager } from 'typeorm';
import { DataAccessLimitedException, isLimitedTransaction } from './line-write-checks';

/**
 * Data-scoped access, lot 4 (planning/data-scoped-access/spec.md §5.4, §6.6): the budget lines
 * linked to a visible object that a limited person cannot read. They are counted by the SQL
 * function `data_access_hidden_count(type, id)`, never named: a link panel shows "and 3 lines
 * outside your access", and the delete of the object is refused, since its cascade would erase
 * links the person does not see.
 *
 * An unscoped person costs no query (the mode comes from the runner `applyDataAccess` served).
 */

/** The objects whose links to budget lines `data_access_hidden_count` counts, by their type there. */
export type HiddenLineOwner = 'application' | 'asset' | 'technology' | 'project' | 'request';

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

/** "This application is linked to 3 lines outside your access." */
export function hiddenLinesMessage(owner: HiddenLineOwner, count: number): string {
  return `This ${OWNERS[owner].noun} is linked to ${count} ${count === 1 ? 'line' : 'lines'} outside your access.`;
}

/**
 * The delete of an object linked to lines the person cannot read: 403 `DATA_ACCESS_LIMITED` with
 * the sentence, and, for a delete check or a bulk delete, the refusal's own `code` with the count
 * (`params.count`), as a `RecordInUseException` carries them (`common/record-in-use.ts`).
 */
export class DataAccessHiddenLinesException extends DataAccessLimitedException {
  readonly code: string;
  readonly usages: [] = [];
  readonly params: { count: number };

  constructor(readonly owner: HiddenLineOwner, readonly count: number) {
    super(hiddenLinesMessage(owner, count), { refusal: OWNERS[owner].code, params: { count } });
    this.code = OWNERS[owner].code;
    this.params = { count };
  }
}

/** The lines linked to the object that the person cannot read: 0 for an unscoped person, without a query. */
export async function hiddenLineCount(manager: EntityManager, owner: HiddenLineOwner, ownerId: string): Promise<number> {
  return (await hiddenLineCounts(manager, owner, [ownerId])).get(ownerId) ?? 0;
}

/** The same count for several objects of one type, in one query. */
export async function hiddenLineCounts(manager: EntityManager, owner: HiddenLineOwner, ownerIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ownerIds.length === 0 || !(await isLimitedTransaction(manager))) return counts;
  const rows: Array<{ id: string; n: number | null }> = await manager.query(
    `SELECT o.id, data_access_hidden_count($1, o.id) AS n FROM unnest($2::uuid[]) AS o(id)`,
    [owner, Array.from(new Set(ownerIds))],
  );
  for (const row of rows) counts.set(row.id, Number(row.n ?? 0));
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

/** Refuses the delete of an object linked to lines the person cannot read (spec §5.4). */
export async function assertNoHiddenLines(manager: EntityManager, owner: HiddenLineOwner, ownerId: string): Promise<void> {
  const count = await hiddenLineCount(manager, owner, ownerId);
  if (count > 0) throw new DataAccessHiddenLinesException(owner, count);
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
