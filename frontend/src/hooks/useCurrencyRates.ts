import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  fetchCurrencyRates,
  fetchMissingRates,
  removeManualRate,
  setManualRate,
  type CurrencyRateMatrix,
  type CurrencyRateRow,
  type ManualRateInput,
} from '../services/currency';

export type { CurrencyRateMatrix, CurrencyRateRow };

export const CURRENCY_RATES_KEY = ['currency-rates'] as const;
export const MISSING_RATES_KEY = ['currency-rates-missing'] as const;

export function invalidateCurrencyRateQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: CURRENCY_RATES_KEY });
  void queryClient.invalidateQueries({ queryKey: MISSING_RATES_KEY });
}

export default function useCurrencyRates() {
  return useQuery({
    queryKey: CURRENCY_RATES_KEY,
    queryFn: fetchCurrencyRates,
  });
}

/** Pairs in use that have no rate yet. */
export function useMissingRates() {
  return useQuery({
    queryKey: MISSING_RATES_KEY,
    queryFn: fetchMissingRates,
  });
}

export function useSetManualRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ManualRateInput) => setManualRate(payload),
    onSuccess: () => invalidateCurrencyRateQueries(queryClient),
  });
}

export function useRemoveManualRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ year, currency }: { year: number; currency: string }) => removeManualRate(year, currency),
    onSuccess: () => invalidateCurrencyRateQueries(queryClient),
  });
}
