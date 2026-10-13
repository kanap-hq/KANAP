import type { QueryFunctionContext } from '@tanstack/react-query';
import api from '../api';

/** Native detail shared by the workspace and its neighbours' prefetch, for either nature. */
export function budgetLineDetailQuery(ref: string) {
  return {
    queryKey: ['budget-line', ref] as unknown[],
    queryFn: async ({ signal }: QueryFunctionContext) => (await api.get(`/budget-lines/${ref}`, { signal })).data,
  };
}
