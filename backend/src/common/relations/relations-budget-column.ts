import type { EntityManager } from 'typeorm';
import { budgetColumnName, readBudgetColumns } from '../../budget-columns/budget-columns.util';

/**
 * The current UTC year and the tenant's default budget column, as a Relations tab shows them:
 * `{ year, measure, budget_column: { key, label } }`.
 */
export async function readRelationsBudgetColumn(mg: EntityManager, tenantId: string): Promise<{
  year: number;
  measure: string;
  budget_column: { key: string; label: string };
}> {
  const year = new Date().getUTCFullYear();
  const columns = await readBudgetColumns(mg, tenantId);
  const measure = columns.default_column;
  return { year, measure, budget_column: { key: measure, label: budgetColumnName(columns, measure) } };
}
