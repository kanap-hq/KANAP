import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import type { BudgetScope } from '../../services/budgetOperations';

/** The fields of a summary row (`/spend-items/summary`, `/capex-items/summary`) the dashboard lists read. */
export type BudgetSummaryRow = {
  id: string;
  /** OPEX lines are named by `product_name`, CAPEX lines by `description`. */
  product_name?: string;
  description?: string;
  item_number?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** List endpoint of each item type's summary. */
export const SUMMARY_ENDPOINT: Record<BudgetScope, string> = {
  all: '/budget-lines/summary',
  opex: '/spend-items/summary',
  capex: '/capex-items/summary',
};

/** Display name of a line of the given type. */
export function itemName(scope: BudgetScope, row: Pick<BudgetSummaryRow, 'product_name' | 'description'>): string {
  return (scope === 'capex' ? row.description : row.product_name) ?? '';
}

/** Page of a line of the given type; null when the row is not a line (no id). */
export function itemHref(scope: BudgetScope, id: string | null | undefined, itemNumber?: number | null): string | null {
  return id ? `/ops/budget/${encodeURIComponent(itemNumber != null ? `BL-${itemNumber}` : id)}` : null;
}

/**
 * Item type of a budget report, kept in `?scope=` so links can open a report on CAPEX.
 * A missing, unknown or unreadable type falls back to all budget lines.
 */
export function useReportScope(): [BudgetScope, (next: BudgetScope) => void] {
  const { hasLevel } = useAuth();
  const [params, setParams] = useSearchParams();
  const raw = params.get('scope');
  const scope: BudgetScope = (raw === 'all' || raw === 'opex' || raw === 'capex') && hasLevel('budget', 'reader') ? raw : 'all';
  const setScope = useCallback((next: BudgetScope) => {
    setParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      nextParams.set('scope', next);
      return nextParams;
    }, { replace: true });
  }, [setParams]);
  return [scope, setScope];
}
