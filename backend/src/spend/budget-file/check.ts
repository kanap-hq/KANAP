import { EntityManager } from 'typeorm';
import { loadFileAccess, planWithAccess } from './access';
import { interpretBudgetFile, ItemNumberCell } from './interpret';
import { loadCatalog, loadColumnLabels, loadLinesByNumber, loadNames } from './load';
import { lookalikeTargets, PreflightInput } from './preflight';
import { BudgetFileLinePlan, BudgetFileReport, lineRef, StoredLine } from './types';

/** What a check reads for itself: everything but the workspace's data. */
export type BudgetFileCheckInput = Omit<PreflightInput, 'catalog' | 'stored' | 'names' | 'labels' | 'access'> & {
  allowedCurrencies: string[] | null;
};

export interface CheckedBudgetFile {
  report: BudgetFileReport;
  plans: BudgetFileLinePlan[];
  stored: StoredLine[];
  /** The person's access is limited: the plan followed it. */
  limited: boolean;
}

/**
 * The check of a budget file, the screen's and Kad's, and the load's own check: the catalog, the lines
 * the person reads (with their yearly totals when the file has rows to create, for the lookalikes of
 * lot I2 of 26.11.9), the lines the file names and the lines the person's choices update, read whole,
 * the person's access to all of them, then the plan. Every read runs in the person's transaction:
 * their access applies through the policies.
 */
export async function checkBudgetFile(manager: EntityManager, tenantId: string, input: BudgetFileCheckInput): Promise<CheckedBudgetFile> {
  const rows = interpretBudgetFile(input.read, input.scope);
  const creates = rows.some((row) => row.itemNumber.kind === 'blank');
  const catalog = await loadCatalog(manager, tenantId, input.allowedCurrencies);
  const names = await loadNames(manager, tenantId, { years: creates });
  const labels = await loadColumnLabels(manager, tenantId);
  const base: PreflightInput = { ...input, catalog, names, labels, stored: [] };
  const targets = creates ? lookalikeTargets(base) : { ids: [], updates: [] };
  const numbers: ItemNumberCell[] = [
    ...rows.map((row) => row.itemNumber),
    ...targets.updates.map((n): ItemNumberCell => ({ kind: 'number', prefix: 'BL', n, raw: lineRef(n), ref: lineRef(n) })),
  ];
  // Read under the person's policies: a line out of their read access is not there at all.
  const stored = await loadLinesByNumber(manager, tenantId, numbers);
  const access = await loadFileAccess(manager, [...stored.map((line) => line.id), ...targets.ids]);
  const planned = await planWithAccess(manager, { ...base, stored, access });
  return { report: planned.report, plans: planned.plans, stored, limited: !!access };
}
