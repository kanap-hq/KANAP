import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CapexItem } from '../capex/capex-item.entity';
import { deriveStatusFromDisabledAt, resolveEndOfValidityAlias, resolveLifecycleState, StatusState } from '../common/status';
import { splitEditBase } from '../common/edit-conflicts';
import { lockBudgetLine } from './budget-locks';
import { ItemAnalyticsValue, loadItemAnalyticsValues, writeItemAnalyticsValues } from './item-analytics.util';
import { assertNoItemEditConflicts } from './item-edit-conflicts';
import { ItemWriteScope, resolveItemWrite } from './item-write.util';
import { SpendItem } from './spend-item.entity';

/**
 * The update of one OPEX or CAPEX line, under its row lock (plan
 * planning/perf-scale, lot 3B, Annexe A #2, #12): the API PATCH, the AI
 * through the services, both item CSV imports.
 *
 * It used to read the line, merge the body into it and `save()` it: TypeORM
 * reloads the row and writes back every column that differs from that
 * reload, so a column another request committed in between went back to the
 * value read first, and a company changed in between escaped the chart of
 * accounts check. Now:
 * 1. the line is locked FOR NO KEY UPDATE (a concurrent update of the line
 *    waits; inserts that only check its key do not), then read again;
 * 2. `resolveItemWrite` checks the body against that locked row (chart of
 *    accounts, cost center), and the end of validity and status are derived
 *    from it;
 * 2b. when the body carries a `base` (the values the user's edit started
 *    from, lot 3C), each field it changes is compared with the locked row:
 *    a field someone else changed meanwhile refuses the whole request with
 *    409 `edit_conflict`, before anything is written
 *    (`item-edit-conflicts.ts`, contract in `common/edit-conflicts.ts`);
 * 3. one UPDATE sets only the columns the body supplied, plus `updated_at`
 *    and the derived status and end of validity when they change; every other
 *    column stays as stored, whoever wrote it last;
 * 4. the analytics values, then the line is read again for the answer and the
 *    audit row.
 * The caller writes the audit row (before: the locked row) and the side
 * effects (contact sync, notifications).
 */

const ENTITIES = { opex: SpendItem, capex: CapexItem } as const;

type ItemRow = SpendItem | CapexItem;

export type LockedItemUpdate<T extends ItemRow> = {
  /** The line as read under the lock, before the update. */
  before: T;
  after: T;
  analyticsBefore: ItemAnalyticsValue[];
  analyticsAfter: ItemAnalyticsValue[];
  /** The status the stored end of validity gave before the update (the stored status lags until the hourly sync). */
  statusBefore: StatusState;
};

export async function updateItemUnderLock(
  manager: EntityManager,
  scope: 'opex',
  tenantId: string,
  itemId: string,
  body: unknown,
  now?: Date,
): Promise<LockedItemUpdate<SpendItem> | null>;
export async function updateItemUnderLock(
  manager: EntityManager,
  scope: 'capex',
  tenantId: string,
  itemId: string,
  body: unknown,
  now?: Date,
): Promise<LockedItemUpdate<CapexItem> | null>;
/** Null when the line is gone (or never was in this tenant). */
export async function updateItemUnderLock(
  manager: EntityManager,
  scope: ItemWriteScope,
  tenantId: string,
  itemId: string,
  body: unknown,
  now: Date = new Date(),
): Promise<LockedItemUpdate<ItemRow> | null> {
  if (!(await lockBudgetLine(manager, scope, tenantId, itemId))) return null;
  const repo = manager.getRepository<ItemRow>(ENTITIES[scope]);
  const read = () => repo.findOne({ where: { id: itemId, tenant_id: tenantId } as any });
  const before = await read();
  if (!before) return null;
  const analyticsBefore = (await loadItemAnalyticsValues(manager, scope, tenantId, [itemId])).get(itemId) ?? [];

  // `base` (lot 3C) is not a column: compared below, never written.
  const { changes, base } = splitEditBase(body);
  // Writable columns only, every id resolved in this tenant, checked against the locked row; see `item-write.util.ts`.
  const { values, lifecycle: input, analytics } = await resolveItemWrite(manager, scope, changes, before);
  let disabledAt: ReturnType<typeof resolveEndOfValidityAlias>;
  try {
    // `disabled_at`, or the deprecated `effective_end` when no end of validity is given (bare date at 12:00 UTC).
    disabledAt = resolveEndOfValidityAlias(input.disabled_at, input.effective_end);
  } catch (err) {
    throw new BadRequestException((err as Error).message);
  }
  const lifecycle = resolveLifecycleState({
    currentDisabledAt: before.disabled_at,
    nextStatus: input.status,
    nextDisabledAt: disabledAt,
    nowFactory: () => now,
  });
  // Nothing written yet: a conflict refuses the request whole (409 `edit_conflict`).
  await assertNoItemEditConflicts(manager, scope, tenantId, itemId, base, changes, {
    before, analyticsBefore, values, disabledAt: lifecycle.disabled_at, analytics,
  });

  // A plain column (no trigger, no @UpdateDateColumn): "recent updates" read it.
  const set: Record<string, unknown> = { ...values, updated_at: now };
  // The end of validity and the status only when they change: a date read back (to the
  // millisecond) and written again would lose the microseconds a SQL now() stored.
  const time = (value: Date | string | null | undefined) => (value == null ? null : new Date(value).getTime());
  if (time(lifecycle.disabled_at) !== time(before.disabled_at)) set.disabled_at = lifecycle.disabled_at;
  if (lifecycle.status !== before.status) set.status = lifecycle.status;
  await manager
    .createQueryBuilder()
    .update(ENTITIES[scope])
    .set(set as any)
    .where('tenant_id = :tenantId AND id = :itemId', { tenantId, itemId })
    .execute();
  // A change of analytics values alone is an edit too (updated_at above, the audit row of the caller).
  await writeItemAnalyticsValues(manager, scope, tenantId, itemId, analytics);

  const after = (await read()) ?? before;
  const analyticsAfter = analytics.length > 0
    ? (await loadItemAnalyticsValues(manager, scope, tenantId, [itemId])).get(itemId) ?? []
    : analyticsBefore;
  return { before, after, analyticsBefore, analyticsAfter, statusBefore: deriveStatusFromDisabledAt(before.disabled_at, now) };
}
