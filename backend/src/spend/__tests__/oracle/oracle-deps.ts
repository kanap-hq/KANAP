import { FxRateService } from '../../../currency/fx-rate.service';
import { CurrencySettingsService } from '../../../currency/currency-settings.service';
import { AllocationCalculatorService } from '../../allocation-calculator.service';
import type { SummaryDeps, SummaryScopeConfig } from '../../spend-summary.builder';

/**
 * The app's allocation calculator, built without Nest, with the real FX service: it converts the
 * turnovers into the reporting currency. Every read goes through the manager the caller passes.
 */
export function realAllocationCalculator(fxRates?: FxRateService): AllocationCalculatorService {
  const rates = fxRates ?? new FxRateService(undefined as any, new CurrencySettingsService(undefined as any, undefined as any));
  return new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any, rates);
}

/**
 * The real FX service and the list's own allocation calculator, built without Nest: every
 * read they make goes through the manager the caller passes, so both engines read the same
 * transaction.
 */
export function realSummaryDeps(_scope: Pick<SummaryScopeConfig, 'scope'>): SummaryDeps {
  const fxRates = new FxRateService(undefined as any, new CurrencySettingsService(undefined as any, undefined as any));
  return {
    fxRates,
    // The calculator converts the turnovers into the reporting currency with the same rates.
    allocationCalculator: realAllocationCalculator(fxRates),
  };
}
