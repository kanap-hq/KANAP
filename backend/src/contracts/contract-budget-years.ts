import type { EntityManager } from 'typeorm';
import { BUDGET_NATURES, naturesAnd } from '../spend/budget-nature';

/**
 * The years the contract budget figures offer: the year before the current one when the budget
 * holds lines for it, the current year and the two after, and `extra` (the year asked for).
 * Shared by the contract pages and the currency universe, so both agree on the years a contract
 * currency needs a rate for.
 */
export async function contractBudgetYears(manager: EntityManager, tenantId: string, currentYear: number, extra?: number): Promise<number[]> {
  const [row]: Array<{ previous: boolean }> = await manager.query(
    `SELECT EXISTS (
       SELECT 1 FROM spend_versions v
         JOIN spend_items i ON i.tenant_id = v.tenant_id AND i.id = v.spend_item_id${naturesAnd('i', BUDGET_NATURES)}
        WHERE v.tenant_id = $1 AND v.budget_year = $2
     ) AS previous`,
    [tenantId, currentYear - 1],
  );
  const years = new Set([...(row?.previous ? [currentYear - 1] : []), currentYear, currentYear + 1, currentYear + 2]);
  if (extra != null) years.add(extra);
  return Array.from(years).sort((a, b) => a - b);
}
