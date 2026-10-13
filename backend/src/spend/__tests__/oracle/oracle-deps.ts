import { FxRateService } from '../../../currency/fx-rate.service';
import { CurrencySettingsService } from '../../../currency/currency-settings.service';
import { AllocationCalculatorService } from '../../allocation-calculator.service';
import type { SummaryDeps, SummaryScopeConfig } from '../../spend-summary.builder';

/**
 * The real FX service and the list's own allocation calculator (OPEX reads
 * `spend_allocations`, CAPEX `capex_allocations`), built without Nest: every
 * read they make goes through the manager the caller passes, so both engines
 * read the same transaction.
 */
export function realSummaryDeps(scope: Pick<SummaryScopeConfig, 'scope'>): SummaryDeps {
  const currencySettings = new CurrencySettingsService(undefined as any, undefined as any);
  const allocationCalculator = scope.scope === 'capex'
    ? new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any)
    : new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any);
  return {
    fxRates: new FxRateService(undefined as any, currencySettings),
    allocationCalculator,
  };
}
