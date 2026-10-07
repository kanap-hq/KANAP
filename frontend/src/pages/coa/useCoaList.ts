import { useQuery } from '@tanstack/react-query';
import api from '../../api';

export type CoaListItem = {
  id: string;
  code: string;
  name: string;
  country_iso: string | null;
  scope: 'GLOBAL' | 'COUNTRY';
  /** Default chart of its country (COUNTRY scope only). */
  is_default: boolean;
  /** Default chart for countries without one (GLOBAL scope only). */
  is_global_default?: boolean;
  /** The tenant's consolidation chart (at most one, any scope). */
  is_consolidation?: boolean;
  companies_count?: number;
  accounts_count?: number;
  /** Accounts of this chart without a consolidation account number. */
  accounts_unmapped_count?: number;
  /** Accounts of this chart whose consolidation number is missing from the consolidation chart. */
  accounts_outside_count?: number;
  created_at: string;
  updated_at: string;
};

export const COA_LIST_QUERY_KEY = ['chart-of-accounts-list'] as const;

export function useCoaList() {
  const query = useQuery({
    queryKey: COA_LIST_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get('/chart-of-accounts', {
        params: { page: 1, limit: 1000, sort: 'code:ASC' },
      });
      return (res.data?.items || []) as CoaListItem[];
    },
    staleTime: 30_000,
  });

  return {
    coas: query.data || [],
    isLoading: query.isLoading,
    refetch: query.refetch,
    isError: query.isError,
    error: query.error,
  };
}
