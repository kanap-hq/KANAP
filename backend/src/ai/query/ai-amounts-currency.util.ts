import { readReportingCurrency } from '../../currency/currency-settings.service';
import { AiExecutionContextWithManager, AiQueryEntityType } from '../ai.types';

/**
 * The currency of the amounts a result carries, stated next to them: an item's `currency` is its
 * own (the one its amounts are entered in), which a model otherwise reads as the currency of
 * the amounts returned.
 */
export type AiAmountsCurrency = {
  /** The currency of every amount in the result; null when it is each item's own (contracts). */
  amounts_currency: string | null;
  amounts_currency_note: string;
};

export function isBudgetLineEntity(entityType: AiQueryEntityType): boolean {
  return entityType === 'spend_items' || entityType === 'capex_items';
}

/** For the families whose results carry amounts (budget lines, contracts); null for the others. */
export async function aiAmountsCurrency(
  context: AiExecutionContextWithManager,
  entityType: AiQueryEntityType,
  surface: 'list' | 'detail' = 'list',
): Promise<AiAmountsCurrency | null> {
  if (isBudgetLineEntity(entityType)) {
    const currency = await readReportingCurrency(context.manager, context.tenantId);
    const where = surface === 'detail'
      ? `The amounts of entity.metadata (y_budget, yearly_totals...) and of versions.*.reporting are in ${currency}. versions.*.totals and financial_versions are in the line's own currency (its currency field).`
      : `Every amount (y_budget, yearly_totals, sums...) is in ${currency}.`;
    return {
      amounts_currency: currency,
      amounts_currency_note: `${where} ${currency} is the reporting currency: each line's amounts are converted from its own currency (its currency field) at the year's rate. A line's amounts_fx_missing_years names the years without a rate for its currency (null when every year has one): their amounts have no value in ${currency} and are left out of every sum.`,
    };
  }
  if (entityType === 'contracts') {
    return {
      amounts_currency: null,
      amounts_currency_note: 'yearly_amount is in each contract\'s own currency (its currency field). Amounts of contracts in different currencies do not add up: filter or group by currency before summing.',
    };
  }
  return null;
}
