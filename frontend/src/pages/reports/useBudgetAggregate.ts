import { useRef } from 'react';
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import api from '../../api';
import type { AggregateRequest, AggregateResult, BudgetScope } from './reportAggregates';

/** The aggregate route of each item type. */
export const AGGREGATE_ENDPOINT: Record<BudgetScope, string> = {
  opex: '/spend-items/summary/aggregate',
  capex: '/capex-items/summary/aggregate',
};

/**
 * Query key prefix of each type's summary data: an import, a delete or a budget operation that
 * invalidates `['spend-items-summary']` (or CAPEX's) refreshes every aggregate of that type.
 */
export const SUMMARY_QUERY_KEY: Record<BudgetScope, string> = {
  opex: 'spend-items-summary',
  capex: 'capex-items-summary',
};

export function aggregateQueryKey(scope: BudgetScope, request: AggregateRequest | null) {
  return [SUMMARY_QUERY_KEY[scope], 'aggregate', request] as const;
}

async function fetchAggregate(scope: BudgetScope, request: AggregateRequest, signal?: AbortSignal): Promise<AggregateResult> {
  const res = await api.post<AggregateResult>(AGGREGATE_ENDPOINT[scope], request, { signal });
  return res.data;
}

type Options = {
  enabled?: boolean;
  /**
   * While another state of the same type loads, keep showing the last answer (a filter or a year
   * changed) instead of an empty report. Never across item types.
   */
  keepPrevious?: boolean;
};

function placeholder(scope: BudgetScope, keepPrevious?: boolean) {
  if (!keepPrevious) return undefined;
  return (previous: AggregateResult | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined) => (
    previousQuery?.queryKey[0] === SUMMARY_QUERY_KEY[scope] ? previous : undefined
  );
}

/**
 * One server aggregate of the OPEX or CAPEX lines (`reportAggregates.ts` builds the request and
 * reads the answer). A null request asks nothing (the page waits for what the request needs).
 */
export function useBudgetAggregate(scope: BudgetScope, request: AggregateRequest | null, options: Options = {}): UseQueryResult<AggregateResult> {
  return useQuery({
    queryKey: aggregateQueryKey(scope, request),
    queryFn: ({ signal }) => fetchAggregate(scope, request as AggregateRequest, signal),
    enabled: request != null && options.enabled !== false,
    placeholderData: placeholder(scope, options.keepPrevious) as any,
  });
}

/** Several aggregates of one type, asked together; `data` holds every answer once all are in. */
export function useBudgetAggregates(
  scope: BudgetScope,
  requests: readonly AggregateRequest[] | null,
  options: Options = {},
): { data: AggregateResult[] | undefined; isLoading: boolean; isError: boolean; refetch: () => void } {
  const results = useQueries({
    queries: (requests ?? []).map((request) => ({
      queryKey: aggregateQueryKey(scope, request),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchAggregate(scope, request, signal),
      enabled: options.enabled !== false,
      placeholderData: placeholder(scope, options.keepPrevious) as any,
    })),
  });
  const data = requests != null && results.every((result) => result.data !== undefined) ? results.map((result) => result.data as AggregateResult) : undefined;
  const isLoading = requests != null && options.enabled !== false && results.some((result) => result.isLoading);
  const isError = results.some((result) => result.isError);
  // The same array while the answers do not change, so pages can memoize on it.
  const stable = useRef<AggregateResult[] | undefined>(undefined);
  const previous = stable.current;
  if (!data) stable.current = undefined;
  else if (!previous || previous.length !== data.length || data.some((answer, i) => answer !== previous[i])) stable.current = data;
  return {
    data: stable.current,
    isLoading,
    isError,
    refetch: () => results.forEach((result) => { void result.refetch(); }),
  };
}

/** A collator for option lists, as `String.prototype.localeCompare` orders with the default locale. */
const collator = new Intl.Collator();
export const compareNames = (a: string, b: string): number => collator.compare(a, b);
