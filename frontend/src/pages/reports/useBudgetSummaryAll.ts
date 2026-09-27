import { useCallback } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import type { BudgetScope } from '../../services/budgetOperations';
import { useDefaultBudgetScope } from '../operations/ItemScopeTabs';
import { pickYearSlot, useOpexSummaryAll, type SummaryRow as OpexSummaryRow } from './useOpexSummary';
import { useCapexSummaryAll } from './useCapexSummary';

/** A summary row of either item type: OPEX lines are named by `product_name`, CAPEX lines by `description`. */
export type BudgetSummaryRow = Omit<OpexSummaryRow, 'product_name'> & {
  product_name?: string;
  description?: string;
  item_number?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** List endpoint of each item type's summary. */
export const SUMMARY_ENDPOINT: Record<BudgetScope, string> = {
  opex: '/spend-items/summary',
  capex: '/capex-items/summary',
};

/** Display name of a line of the given type. */
export function itemName(scope: BudgetScope, row: Pick<BudgetSummaryRow, 'product_name' | 'description'>): string {
  return (scope === 'capex' ? row.description : row.product_name) ?? '';
}

/** Year slot of a line of either type (the slots do not depend on the name field). */
export function pickSlot(row: BudgetSummaryRow, year: number) {
  return pickYearSlot(row as OpexSummaryRow, year);
}

/** Every line of one item type with its year slots; only the active type is fetched. */
export function useBudgetSummaryAll(
  scope: BudgetScope,
  years?: number[],
  options?: { enabled?: boolean },
): UseQueryResult<BudgetSummaryRow[]> {
  const enabled = options?.enabled !== false;
  const opex = useOpexSummaryAll(years, { enabled: enabled && scope === 'opex' });
  const capex = useCapexSummaryAll(years, { enabled: enabled && scope === 'capex' });
  return (scope === 'capex' ? capex : opex) as UseQueryResult<BudgetSummaryRow[]>;
}

/**
 * Item type of a budget report, kept in `?scope=` so links can open a report on CAPEX.
 * A missing, unknown or unreadable type falls back to the user's default type.
 */
export function useReportScope(): [BudgetScope, (next: BudgetScope) => void] {
  const fallback = useDefaultBudgetScope();
  const { hasLevel } = useAuth();
  const [params, setParams] = useSearchParams();
  const raw = params.get('scope');
  const scope: BudgetScope = (raw === 'opex' || raw === 'capex') && hasLevel(raw, 'reader') ? raw : fallback;
  const setScope = useCallback((next: BudgetScope) => {
    setParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      nextParams.set('scope', next);
      return nextParams;
    }, { replace: true });
  }, [setParams]);
  return [scope, setScope];
}
