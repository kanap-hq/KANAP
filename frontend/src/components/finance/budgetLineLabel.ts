import { formatItemRef } from '../../utils/item-ref';

export type BudgetLineLabel = { product_name?: string | null; reference?: string | null; item_number?: number | null };

export function budgetLineLabel(line: BudgetLineLabel): string | null {
  const reference = line.reference || (line.item_number != null ? formatItemRef('budget', line.item_number) : null);
  const title = line.product_name?.trim();
  return [reference, title].filter(Boolean).join(' · ') || null;
}
