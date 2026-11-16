import { z } from 'zod';
import type { EntityManager } from 'typeorm';
import { BULK_WRITE_TIMEOUTS } from '../../common/request-db-timeouts';

/**
 * What Kad's changes in bulk share (lot K1 of 26.11.9), whatever the list: the tools, the bounded
 * waits of their transactions and the filter values they take. Each list's operation runs the
 * common contract of the screen (`common/bulk-edit/bulk-edit.ts`) through its service.
 */

/** Kad's tools of a change in bulk: one card for many rows, never a step of `prepare_mutation_plan`. */
export const AI_BULK_EDIT_TOOLS: ReadonlySet<string> = new Set(['bulk_update_budget_lines', 'bulk_update_applications']);

/**
 * What `prepare_mutation_plan` says of the changes in bulk (lot K1): on dev, "do it in bulk" on the category of
 * applications, a field the bulk tools do not take, gave a plan of four cards of one application each, offered
 * without a word that the category is not changed in bulk.
 */
export const MUTATION_PLAN_IS_NOT_BULK = 'A plan of cards that each change one record is not a change in bulk: never present it as one. '
  + 'When the person asks to change budget lines or applications in bulk on a field that bulk_update_budget_lines or bulk_update_applications does not take, '
  + 'first say in the answer that this field is not changed in bulk and which fields are, then prepare the cards.';

export const BULK_EDIT_PLAN_REFUSAL = 'A change in bulk (bulk_update_budget_lines, bulk_update_applications) changes its rows in one card and cannot be part of a mutation plan: call it on its own.';

const WAITS_SAVEPOINT = 'ai_bulk_edit_waits';

/**
 * The waits of a change in bulk in Kad's transaction, as the screen's route (`BULK_WRITE_TIMEOUTS`):
 * a row held by another transaction gives up after `lockTimeoutMs` (55P03: the tool answers busy,
 * the card stays to approve), one statement after `statementTimeoutMs`. They hold for the card's
 * count or write only (`withAiBulkEditWaits`); no idle limit is set. Mutable for the specs only.
 */
export const AI_BULK_EDIT_DB_TIMEOUTS: { lockTimeoutMs: number; statementTimeoutMs: number } = {
  lockTimeoutMs: BULK_WRITE_TIMEOUTS.lockTimeoutMs!,
  statementTimeoutMs: BULK_WRITE_TIMEOUTS.statementTimeoutMs!,
};

/**
 * Runs a card's count or its write under the waits, then puts back the transaction's own: the next
 * cards of "Approve all" run in the same transaction. In a savepoint of its own: on an error, the
 * rollback to it takes the waits back too (`set_config(…, true)`), even in an aborted transaction,
 * and nothing the card ran stays.
 */
export async function withAiBulkEditWaits<T>(manager: EntityManager, run: () => Promise<T>): Promise<T> {
  const [before]: Array<{ lock: string; statement: string }> = await manager.query(
    `SELECT current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement`,
  );
  const set = (lock: string, statement: string) => manager.query(
    `SELECT set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)`,
    [lock, statement],
  );
  await manager.query(`SAVEPOINT ${WAITS_SAVEPOINT}`);
  await set(`${AI_BULK_EDIT_DB_TIMEOUTS.lockTimeoutMs}ms`, `${AI_BULK_EDIT_DB_TIMEOUTS.statementTimeoutMs}ms`);
  let result: T;
  try {
    result = await run();
  } catch (error) {
    try {
      await manager.query(`ROLLBACK TO SAVEPOINT ${WAITS_SAVEPOINT}`);
      await manager.query(`RELEASE SAVEPOINT ${WAITS_SAVEPOINT}`);
    } catch {
      // The connection is gone: the card's own error says more.
    }
    throw error;
  }
  await manager.query(`RELEASE SAVEPOINT ${WAITS_SAVEPOINT}`);
  await set(before.lock, before.statement);
  return result;
}

/**
 * Whether a part of the filter names no value (`[]`, `{ not: [] }`, a blank text): such a part is no
 * criterion, and an empty exclusion would reach the whole list (or open the disabled rows).
 */
export function isEmptyAiBulkFilterValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === 'object' && 'not' in value) {
    const not = (value as { not: unknown }).not;
    return !Array.isArray(not) || not.length === 0;
  }
  return false;
}

/** The filter values of `query_entities` (same shapes). */
export const AI_BULK_FILTER_VALUE = z.union([
  z.array(z.union([z.string(), z.null()])),
  z.object({ not: z.array(z.union([z.string(), z.null()])) }).strict(),
  z.string(),
  z.object({ op: z.enum(['eq', 'gt', 'lt', 'gte', 'lte', 'between']), value: z.number(), valueTo: z.number().optional() }),
  z.object({ op: z.enum(['eq', 'before', 'after', 'between']), value: z.string().trim().min(1), valueTo: z.string().trim().min(1).optional() }),
]);
