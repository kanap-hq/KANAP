import React from 'react';
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

/** How long to wait before the single refetch that follows a sync still running in the background. */
export const RATE_SYNC_FOLLOW_UP_MS = 20_000;

/**
 * A finished sync refetches the matrix and the missing list at once.
 * A sync that is still running refetches them once, 20 seconds later. A newer sync cancels that wait.
 */
export function useRateSyncFollowUp() {
  const queryClient = useQueryClient();
  const timer = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current);
  }, []);

  return React.useCallback((completed: boolean) => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (completed) {
      invalidateCurrencyRateQueries(queryClient);
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      invalidateCurrencyRateQueries(queryClient);
    }, RATE_SYNC_FOLLOW_UP_MS);
  }, [queryClient]);
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
