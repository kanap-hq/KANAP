import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuditService } from '../audit/audit.service';
import type { BudgetColumn } from './amounts-write.util';
import {
  assertClearNotFrozen,
  assertColumnCopyNotFrozen,
  BudgetOperationDeps,
  CALENDAR_CHANGES_MESSAGE,
  clearBudgetColumn,
  clearColumnParams,
  ColumnCopyLine,
  ColumnCopyRun,
  columnCopyChangesCalendars,
  columnCopyParams,
  currentTenantId,
  loadItems,
  loadItemsValidIn,
  loadVersions,
  operationYear,
  planColumnCopyRun,
  writeColumnCopyRun,
} from './budget-column-operations';
import { AllocationCopyLine, AllocationCopyRun, AllocationOperationDeps, allocationCopyParams, runAllocationCopy } from './budget-allocation-operations';
import { lockBudgetLinesOfBothNatures, lockTenantBudgetOperations } from './budget-locks';
import { BUDGET_NATURES, budgetLineReference, type BudgetNature } from './budget-nature';

/**
 * "Copy the budget" and "Reset a column" of Budget administration, on the lines
 * of one nature or of both (plan planning/budget-tab-redesign, lot OPS).
 *
 * The copy has two parts, either or both: the amounts (one column of a year to
 * a column of a year, with a percentage: `budget-column-operations.ts`) and the
 * allocations (the method of each line and the rows of the manual methods, to
 * another year: `budget-allocation-operations.ts`). One `overwrite` covers both
 * parts. The functions of each part run as they do for the routes of each
 * nature, once per nature, inside the request transaction and under one tenant
 * lock: a real copy first locks the lines of every nature in play in id order
 * (`budget-locks.ts`), decides the amounts of every nature, then writes them,
 * then copies the allocations. All or nothing: an error on any line or nature
 * fails the request, and the request transaction rolls everything back.
 *
 * The routes of each nature (`/spend-items/budget-operations/*`,
 * `/capex-items/budget-operations/*`) stay as they are for the API and the AI.
 */

/** The lines an operation runs on: all budget lines, or those of one nature. */
export type BudgetOperationScope = 'all' | BudgetNature;

export type CopyBudgetOperation = {
  scope: BudgetOperationScope;
  sourceYear: number;
  destinationYear: number;
  /** The amounts part: a column of the source year to a column of the destination year. */
  amounts?: {
    sourceColumn: BudgetColumn;
    destinationColumn: BudgetColumn;
    percentageIncrease?: number | string;
    /** A real copy whose lines change calendar (`fallback`) or cannot be recomputed (`missing`) needs this, after the preview. */
    acceptCalendarChanges?: boolean;
  } | null;
  /** The allocations part, to another year only. */
  allocations?: boolean;
  /** Replace the amounts of a destination column that holds some, and a manual allocation already in the destination year. */
  overwrite?: boolean;
  dryRun?: boolean;
};

export type CopyBudgetDeps = BudgetOperationDeps & Pick<AllocationOperationDeps, 'calculator'>;

/** One line of a copy: its reference and nature, and what each part decided (a dry run) or did. */
export type CopyBudgetLine = {
  itemId: string;
  /** The line's own number: its BL-n reference. */
  itemNumber: number;
  reference: string | null;
  nature: BudgetNature;
  itemName: string;
  amounts?: Omit<ColumnCopyLine, 'itemId' | 'itemName' | 'itemNumber'>;
  allocations?: Omit<AllocationCopyLine, 'itemId' | 'itemName' | 'itemNumber'>;
};

type PartSummary = { totalItems: number; processed: number; skipped: number; errors: number };

/** The natures a scope names, in display order: `all` names both explicitly (`budget-nature.ts`). */
export function operationNatures(scope: unknown): BudgetNature[] {
  if (scope === 'all') return [...BUDGET_NATURES];
  if (scope === 'opex' || scope === 'capex') return [scope];
  throw new BadRequestException('scope must be one of all, opex, capex.');
}

/**
 * Locks the lines of both natures in id order, in one statement, before any of
 * them is decided: the operations of each nature then lock their own lines
 * again (held already) and their versions. Nothing to do for one nature: its
 * operation locks its lines itself.
 */
async function lockLinesOfNatures(
  manager: EntityManager,
  tenantId: string,
  natures: readonly BudgetNature[],
  idsOf: (nature: BudgetNature) => Promise<string[]>,
): Promise<void> {
  if (natures.length < 2) return;
  const ids: string[] = [];
  for (const nature of natures) ids.push(...(await idsOf(nature)));
  await lockBudgetLinesOfBothNatures(manager, tenantId, ids);
}

/**
 * The audit of a copy run: the rows each part writes, as for the routes of
 * each nature, and the copy rows of the line and of its allocation (`operation`
 * `budget_column_copy`, `allocation_copy`) also say which copy wrote them: its
 * scope, the nature and the parts it ran.
 */
function copyAudit(audit: Pick<AuditService, 'log'>, context: { scope: BudgetOperationScope; nature: BudgetNature; parts: string[] }): Pick<AuditService, 'log'> {
  return {
    log: (entry, opts) => {
      const operation = (entry?.after as Record<string, unknown> | null | undefined)?.operation;
      if (operation !== 'budget_column_copy' && operation !== 'allocation_copy') return audit.log(entry, opts);
      return audit.log({ ...entry, after: { ...(entry.after as Record<string, unknown>), budgetCopy: context } }, opts);
    },
  };
}

/**
 * Copy the budget of the lines of `scope` from one year to another: the
 * amounts of a column (`copyBudgetColumn`), the allocations (`copyAllocations`),
 * or both. A dry run decides and writes nothing; it takes no lock.
 *
 * Refused (400): no part asked, the allocations asked within one year (they
 * belong to a year: every column of a year shares them), a percentage of
 * -100 or less, a column copied onto itself. The amounts check the freeze of
 * the destination column of every nature first (403 naming the nature); the
 * allocations have no freeze, as for the routes of each nature.
 */
export async function copyBudget(deps: CopyBudgetDeps, operation: CopyBudgetOperation, userId: string | null) {
  const mg = deps.manager;
  const scope = operation?.scope as BudgetOperationScope;
  const natures = operationNatures(scope);
  const sourceYear = operationYear(operation?.sourceYear, 'sourceYear');
  const destinationYear = operationYear(operation?.destinationYear, 'destinationYear');
  // `amounts`: an object, or left out (`null` and `false` too) for no amounts part.
  const rawAmounts = operation?.amounts as unknown;
  const wantsAmounts = rawAmounts != null && rawAmounts !== false;
  if (wantsAmounts && (typeof rawAmounts !== 'object' || Array.isArray(rawAmounts))) {
    throw new BadRequestException('amounts must give the source and destination columns.');
  }
  const amountsBody = rawAmounts as NonNullable<CopyBudgetOperation['amounts']>;
  const wantsAllocations = operation?.allocations === true;
  if (!wantsAmounts && !wantsAllocations) {
    throw new BadRequestException('Choose what to copy: the amounts, the allocations or both.');
  }
  if (wantsAllocations && sourceYear === destinationYear) {
    throw new BadRequestException('Allocations belong to a year: copy them to another year, or copy the amounts only.');
  }
  const overwrite = Boolean(operation?.overwrite);
  const dryRun = Boolean(operation?.dryRun);
  const amounts = wantsAmounts
    ? columnCopyParams({
      sourceYear,
      destinationYear,
      sourceColumn: amountsBody.sourceColumn,
      destinationColumn: amountsBody.destinationColumn,
      percentageIncrease: amountsBody.percentageIncrease ?? 0,
      overwrite,
      dryRun,
      acceptCalendarChanges: amountsBody.acceptCalendarChanges,
    })
    : null;
  const allocations = wantsAllocations ? allocationCopyParams({ sourceYear, destinationYear, overwrite, dryRun }) : null;
  const parts = [...(amounts ? ['amounts'] : []), ...(allocations ? ['allocations'] : [])];

  // Every nature's freeze first: a frozen destination column of either refuses the whole copy.
  if (amounts) for (const nature of natures) await assertColumnCopyNotFrozen(deps, nature, amounts);

  const tenantId = await currentTenantId(mg);
  if (!dryRun) {
    // One bulk budget operation at a time per tenant: a second one gets a 409 (`budget-locks.ts`).
    await lockTenantBudgetOperations(mg, tenantId);
    // The lines both parts write: valid in the destination year, with a source version.
    await lockLinesOfNatures(mg, tenantId, natures, async (nature) => {
      const items = await loadItemsValidIn(mg, nature, tenantId, destinationYear);
      const sources = await loadVersions(mg, nature, tenantId, items.map((i) => i.id), [sourceYear]);
      return items.filter((i) => sources.has(`${i.id}:${sourceYear}`)).map((i) => i.id);
    });
  }
  const depsOf = (nature: BudgetNature) => ({ ...deps, audit: copyAudit(deps.audit, { scope, nature, parts }) });

  // The amounts: every nature decided before any is written, so a refusal writes nothing.
  const columnRuns: Array<{ nature: BudgetNature; run: ColumnCopyRun }> = [];
  const amountsSummary: PartSummary = { totalItems: 0, processed: 0, skipped: 0, errors: 0 };
  if (amounts) {
    for (const nature of natures) columnRuns.push({ nature, run: await planColumnCopyRun(depsOf(nature), nature, amounts, tenantId) });
    if (!dryRun && !amounts.acceptCalendarChanges && columnRuns.some(({ run }) => columnCopyChangesCalendars(run))) {
      throw new BadRequestException(CALENDAR_CHANGES_MESSAGE(destinationYear));
    }
    for (const { nature, run } of columnRuns) {
      amountsSummary.totalItems += run.totalItems;
      amountsSummary.skipped += run.skipped;
      if (dryRun) {
        amountsSummary.processed += run.plans.length;
        continue;
      }
      const written = await writeColumnCopyRun(depsOf(nature), run, userId);
      amountsSummary.processed += written.processed;
      amountsSummary.skipped += written.skipped;
    }
  }

  // The allocations, once the amounts are written (a version the amounts created takes the source's method here).
  const allocationRuns: Array<{ nature: BudgetNature; run: AllocationCopyRun }> = [];
  const allocationsSummary: PartSummary = { totalItems: 0, processed: 0, skipped: 0, errors: 0 };
  if (allocations) {
    for (const nature of natures) {
      const run = await runAllocationCopy(depsOf(nature), nature, allocations, tenantId, userId);
      allocationRuns.push({ nature, run });
      allocationsSummary.totalItems += run.totalItems;
      allocationsSummary.processed += run.processed;
      allocationsSummary.skipped += run.skipped;
      allocationsSummary.errors += run.errors;
    }
  }

  // One entry per line, the parts side by side: the amounts' order, then the lines only the allocations list.
  const byLine = new Map<string, CopyBudgetLine>();
  const entry = (nature: BudgetNature, line: { itemId: string; itemName: string; itemNumber: number }) => {
    let found = byLine.get(line.itemId);
    if (!found) {
      found = { itemId: line.itemId, itemNumber: line.itemNumber, reference: budgetLineReference(line.itemNumber), nature, itemName: line.itemName };
      byLine.set(line.itemId, found);
    }
    return found;
  };
  for (const { nature, run } of columnRuns) {
    for (const { itemId, itemName, itemNumber, ...part } of run.lines) entry(nature, { itemId, itemName, itemNumber }).amounts = part;
  }
  for (const { nature, run } of allocationRuns) {
    for (const { itemId, itemName, itemNumber, ...part } of run.lines) entry(nature, { itemId, itemName, itemNumber }).allocations = part;
  }

  return {
    success: allocationsSummary.errors === 0,
    dryRun,
    scope,
    summary: {
      lines: byLine.size,
      ...(amounts ? { amounts: amountsSummary } : {}),
      ...(allocations ? { allocations: allocationsSummary } : {}),
    },
    results: Array.from(byLine.values()),
  };
}

/**
 * Reset one column of a year on the lines of `scope` (`clearBudgetColumn`, once
 * per nature, under one tenant lock): the freeze of every nature is checked
 * first, then the lines of every nature in play are locked in id order. The
 * summary adds the natures up.
 */
export async function clearBudgetColumns(
  deps: BudgetOperationDeps,
  operation: { scope: BudgetOperationScope; year: number; column: BudgetColumn },
  userId: string | null,
) {
  const mg = deps.manager;
  const scope = operation?.scope as BudgetOperationScope;
  const natures = operationNatures(scope);
  const params = clearColumnParams(operation);
  for (const nature of natures) await assertClearNotFrozen(deps, nature, params);

  const tenantId = await currentTenantId(mg);
  // One bulk budget operation at a time per tenant: a second one gets a 409 (`budget-locks.ts`).
  await lockTenantBudgetOperations(mg, tenantId);
  // The lines the clear writes: every line, ended or not, with a version of the year.
  await lockLinesOfNatures(mg, tenantId, natures, async (nature) => {
    const items = await loadItems(mg, nature, tenantId);
    const versions = await loadVersions(mg, nature, tenantId, items.map((i) => i.id), [params.year]);
    return items.filter((i) => versions.has(`${i.id}:${params.year}`)).map((i) => i.id);
  });

  const summary = { totalItems: 0, cleared: 0, skipped: 0, errors: 0 };
  for (const nature of natures) {
    const done = await clearBudgetColumn(deps, nature, params, userId, { tenantLocked: true });
    summary.totalItems += done.summary.totalItems;
    summary.cleared += done.summary.cleared;
    summary.skipped += done.summary.skipped;
    summary.errors += done.summary.errors;
  }
  return { success: true, scope, summary };
}
