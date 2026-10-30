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

/** Where the rates the amounts are converted at are read. */
const EXCHANGE_RATES_POINTER = 'The exchange rates themselves are read through query_entities on the family exchange_rates.';

export function isBudgetLineEntity(entityType: AiQueryEntityType): boolean {
  return entityType === 'budget_lines';
}

/** `JPY 2026 (2 lines), USD 2027 (1 line)`. */
function describeFxMissing(pairs: Array<{ currency: string; year: number; lines: number }>): string {
  return pairs.map((pair) => `${pair.currency} ${pair.year} (${pair.lines} ${pair.lines === 1 ? 'line' : 'lines'})`).join(', ');
}

/** `Alpine (XTS, 2026), Kyoto (XTS, 2026)`. */
function describeTurnoverFxMissing(items: Array<{ companyId: string; companyName: string; currency: string; year: number }>): string {
  return items.map((item) => `${item.companyName || item.companyId} (${item.currency}, ${item.year})`).join(', ');
}

/**
 * For the families whose results carry amounts (budget lines, contracts); null for the others.
 * `fxMissing`: the pairs a sum left out for lack of a rate (an aggregate's `amounts_fx_missing`),
 * named in the note so the answer says those amounts are not included.
 */
export async function aiAmountsCurrency(
  context: AiExecutionContextWithManager,
  entityType: AiQueryEntityType,
  surface: 'list' | 'detail' = 'list',
  fxMissing?: Array<{ currency: string; year: number; lines: number }>,
): Promise<AiAmountsCurrency | null> {
  if (isBudgetLineEntity(entityType)) {
    const currency = await readReportingCurrency(context.manager, context.tenantId);
    const where = surface === 'detail'
      ? `The amounts of entity.metadata (y_budget, yearly_totals...) and of versions.*.reporting are in ${currency}. versions.*.totals and financial_versions are in the line's own currency (its currency field).`
      : `Every amount (y_budget, yearly_totals, sums...) is in ${currency}.`;
    return {
      amounts_currency: currency,
      amounts_currency_note: `${where} ${currency} is the reporting currency: each line's amounts are converted from its own currency (its currency field) at the year's rate. A line's amounts_fx_missing_years names the years without a rate for its currency (null when every year has one): their amounts have no value in ${currency} and are left out of every sum. ${EXCHANGE_RATES_POINTER}`
        + (fxMissing?.length
          ? ` These values leave out the amounts of the lines without a ${currency} rate listed in amounts_fx_missing: ${describeFxMissing(fxMissing)}. Tell the user that those amounts are not included in the figures and that they will count once the rate is available. The rates missing in the workspace are in missing_rates of the family exchange_rates.`
          : ''),
    };
  }
  if (entityType === 'chargeback' || entityType === 'chargeback_lines') {
    const currency = await readReportingCurrency(context.manager, context.tenantId);
    return {
      amounts_currency: currency,
      amounts_currency_note: `Every amount of the report (amount, paid, net, turnover, costs per user, sums) is in ${currency}, the reporting currency: each line is converted from its own currency at the rate of its version. A line without a rate is left out of every figure, which chargeback.warnings says.`,
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

/**
 * Company turnover aggregates (sum, avg, min, max). Rows of query_entities keep each company's
 * own value; only the aggregate is in the reporting currency. `fxMissing` names the companies
 * a value left out (`turnover_fx_missing`).
 */
export async function aiCompanyTurnoverCurrency(
  context: AiExecutionContextWithManager,
  fxMissing?: Array<{ companyId: string; companyName: string; currency: string; year: number }>,
): Promise<AiAmountsCurrency> {
  const currency = await readReportingCurrency(context.manager, context.tenantId);
  const leftOut = fxMissing?.length
    ? ` These values leave out the companies without a ${currency} rate listed in turnover_fx_missing: ${describeTurnoverFxMissing(fxMissing)}. Tell the user that those companies are not included in the figures until a rate is entered.`
    : '';
  return {
    amounts_currency: currency,
    amounts_currency_note: `The turnover values are in millions of ${currency}. ${currency} is the reporting currency: each company's turnover is converted from its base currency at the year's rate.${leftOut}`,
  };
}
