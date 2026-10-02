import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  isListContextId,
  LIST_CONTEXT_RETENTION_DAYS,
  listContextId,
  ListContextState,
  normalizeListContextState,
  normalizeListKey,
} from './list-context';

export type StoredListContext = { id: string; list: string; state: Record<string, unknown> };

/**
 * A context read again is kept another 90 days. Its use date is moved at most
 * once a day, so the page requests of a list (one per scrolled block) do not
 * each write the same row.
 */
const TOUCH_AFTER = `interval '1 day'`;

/**
 * Saves and reads list contexts (`list-context.ts`). Every statement names the
 * tenant besides row-level security, and runs on the caller's manager: the
 * request's tenant transaction, or a spec's.
 */
@Injectable()
export class ListContextsService {
  /** Saves a state and answers its id; saving the same state again keeps the row and refreshes its use date. */
  async save(manager: EntityManager, tenantId: string, rawList: unknown, rawState: unknown): Promise<{ id: string }> {
    const list = normalizeListKey(rawList);
    const state: ListContextState = normalizeListContextState(rawState);
    const id = listContextId(tenantId, list, state);
    await manager.query(
      `INSERT INTO list_contexts (tenant_id, id, list_key, state)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (tenant_id, id) DO UPDATE SET last_used_at = now()
        WHERE list_contexts.last_used_at < now() - ${TOUCH_AFTER}`,
      [tenantId, id, list, JSON.stringify(state)],
    );
    return { id };
  }

  /** The stored context, or null when the tenant has none of that id (never saved, purged, or another tenant's). */
  async find(manager: EntityManager, tenantId: string, id: string): Promise<StoredListContext | null> {
    if (!isListContextId(id)) return null;
    const rows: Array<{ id: string; list_key: string; state: Record<string, unknown>; stale: boolean }> = await manager.query(
      `SELECT id, list_key, state, last_used_at < now() - ${TOUCH_AFTER} AS stale
         FROM list_contexts
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.stale) {
      await manager.query(
        `UPDATE list_contexts SET last_used_at = now()
          WHERE tenant_id = $1 AND id = $2 AND last_used_at < now() - ${TOUCH_AFTER}`,
        [tenantId, id],
      );
    }
    return { id: row.id, list: row.list_key, state: row.state ?? {} };
  }

  /** Like `find`, for a request that names the context: an unknown id is a request error. */
  async require(manager: EntityManager, tenantId: string, id: unknown): Promise<StoredListContext> {
    if (!isListContextId(id)) {
      throw new BadRequestException({ code: 'list_context_invalid', message: 'ctx must be a list context id (22 characters).' });
    }
    const found = await this.find(manager, tenantId, id);
    if (!found) {
      throw new BadRequestException({
        code: 'list_context_not_found',
        message: 'The saved list filters of this link are no longer available. Open the list again and set the filters.',
      });
    }
    return found;
  }

  async get(manager: EntityManager, tenantId: string, id: string): Promise<StoredListContext> {
    const found = await this.find(manager, tenantId, id);
    if (!found) throw new NotFoundException({ code: 'list_context_not_found', message: 'No saved list filters under this id.' });
    return found;
  }
}

/** Deletes the tenant's contexts unused for `days` days (90 by default); answers how many went. */
export async function purgeListContexts(manager: EntityManager, tenantId: string, days = LIST_CONTEXT_RETENTION_DAYS): Promise<number> {
  const rows: Array<{ n: number }> = await manager.query(
    `WITH gone AS (
       DELETE FROM list_contexts
        WHERE tenant_id = $1 AND last_used_at < now() - make_interval(days => $2::int)
       RETURNING 1
     )
     SELECT count(*)::int AS n FROM gone`,
    [tenantId, days],
  );
  return Number(rows[0]?.n ?? 0);
}
