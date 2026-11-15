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

export const BULK_EDIT_PLAN_REFUSAL = 'A change in bulk (bulk_update_budget_lines, bulk_update_applications) changes its rows in one card and cannot be part of a mutation plan: call it on its own.';

/**
 * The waits of a change in bulk in Kad's transaction, as the screen's route (`BULK_WRITE_TIMEOUTS`):
 * a row held by another transaction gives up after `lockTimeoutMs` (55P03: the tool answers busy,
 * the card stays to approve), one statement after `statementTimeoutMs`. Each tool call and each
 * approval runs in its own transaction; no idle limit is set. Mutable for the specs only.
 */
export const AI_BULK_EDIT_DB_TIMEOUTS: { lockTimeoutMs: number; statementTimeoutMs: number } = {
  lockTimeoutMs: BULK_WRITE_TIMEOUTS.lockTimeoutMs!,
  statementTimeoutMs: BULK_WRITE_TIMEOUTS.statementTimeoutMs!,
};

/** Sets the waits for the rest of the transaction (`set_config(…, true)`: a rolled-back savepoint takes them back). */
export async function boundAiBulkEditWaits(manager: EntityManager): Promise<void> {
  await manager.query(
    `SELECT set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)`,
    [`${AI_BULK_EDIT_DB_TIMEOUTS.lockTimeoutMs}ms`, `${AI_BULK_EDIT_DB_TIMEOUTS.statementTimeoutMs}ms`],
  );
}

/** The filter values of `query_entities` (same shapes). */
export const AI_BULK_FILTER_VALUE = z.union([
  z.array(z.union([z.string(), z.null()])),
  z.object({ not: z.array(z.union([z.string(), z.null()])) }).strict(),
  z.string(),
  z.object({ op: z.enum(['eq', 'gt', 'lt', 'gte', 'lte', 'between']), value: z.number(), valueTo: z.number().optional() }),
  z.object({ op: z.enum(['eq', 'before', 'after', 'between']), value: z.string().trim().min(1), valueTo: z.string().trim().min(1).optional() }),
]);
