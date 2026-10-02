import { FxRateService } from '../../../currency/fx-rate.service';
import { CurrencySettingsService } from '../../../currency/currency-settings.service';
import { AllocationCalculatorService } from '../../allocation-calculator.service';
import type { SummaryDeps } from '../../spend-summary.builder';

/**
 * The real FX service and allocation calculator, built without Nest: every
 * read they make goes through the manager the caller passes, so both engines
 * read the same transaction.
 */
export function realSummaryDeps(): SummaryDeps {
  const currencySettings = new CurrencySettingsService(undefined as any, undefined as any);
  return {
    fxRates: new FxRateService(undefined as any, currencySettings),
    allocationCalculator: new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any),
  };
}
