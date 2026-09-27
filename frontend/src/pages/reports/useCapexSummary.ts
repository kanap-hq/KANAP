import { useQuery } from '@tanstack/react-query';
import api from '../../api';
import type { SummaryRow as OpexSummaryRow } from './useOpexSummary';
export { pickYearSlot } from './useOpexSummary';

/** A CAPEX summary row: the same fields as an OPEX row, named by its description. */
export type SummaryRow = Omit<OpexSummaryRow, 'product_name'> & {
  description: string;
  company_name?: string;
};

export function useCapexSummaryAll(years?: number[], options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['capex-items-summary', 'all', years?.join(',')],
    queryFn: async () => {
      // Fetch all pages; fall back to a single large page if supported
      const limit = 500;
      let page = 1;
      let items: SummaryRow[] = [];
      let total = 0;
      const maxPages = 50;
      const yearsParam = years ? years.join(',') : undefined;
      do {
        const res = await api.get<{ items: SummaryRow[]; total: number; page: number; limit: number }>(
          '/capex-items/summary',
          { params: { page, limit, sort: 'created_at:DESC', years: yearsParam } }
        );
        const data = res.data;
        items = items.concat(data.items || []);
        total = data.total || items.length;
        page += 1;
        if (!data.items || data.items.length === 0) break;
      } while (items.length < total && page <= maxPages);
      return items;
    },
    enabled: options?.enabled !== false,
    // Every line of the type, paged: reports and the dashboard share this entry for a few minutes.
    staleTime: 5 * 60 * 1000,
  });
}
