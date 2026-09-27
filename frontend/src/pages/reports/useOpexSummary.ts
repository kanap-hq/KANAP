import { useQuery } from '@tanstack/react-query';
import api from '../../api';

export type SummaryRow = {
  id: string;
  product_name: string;
  supplier_name?: string;
  account_display?: string;
  account?: { id?: string | null } | null;
  analytics_category_id?: string | null;
  analytics_category_name?: string | null;
  versions?: {
    yMinus1?: {
      year?: number;
      totals: { budget: number; follow_up: number; landing: number; revision: number };
      reporting?: { budget: number; follow_up: number; landing: number; revision: number };
    };
    y?: {
      year?: number;
      totals: { budget: number; follow_up: number; landing: number; revision: number };
      reporting?: { budget: number; follow_up: number; landing: number; revision: number };
    };
    yPlus1?: {
      year?: number;
      totals: { budget: number; follow_up: number; landing: number; revision: number };
      reporting?: { budget: number; follow_up: number; landing: number; revision: number };
    };
    [key: string]: {
      year?: number;
      totals: { budget: number; follow_up: number; landing: number; revision: number };
      reporting?: { budget: number; follow_up: number; landing: number; revision: number };
    } | undefined;
  };
};

export function useOpexSummaryAll(years?: number[], options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['spend-items-summary', 'all', years?.join(',')],
    queryFn: async () => {
      // Fetch all pages; fall back to a single large page if supported
      const limit = 500;
      let page = 1;
      let items: SummaryRow[] = [];
      let total = 0;
      // Cap on pages to avoid runaway loops
      const maxPages = 50;
      const yearsParam = years ? years.join(',') : undefined;
      do {
        const res = await api.get<{ items: SummaryRow[]; total: number; page: number; limit: number }>(
          '/spend-items/summary',
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
  });
}

export function pickYearSlot<T extends SummaryRow>(row: T, year: number) {
  const y = new Date().getFullYear();
  // Try dynamic year key first (e.g., "y2024", "y2025")
  const dynamicKey = `y${year}`;
  if (row.versions?.[dynamicKey]) {
    return row.versions[dynamicKey];
  }
  // Fallback to legacy keys for backward compatibility
  if (year === y - 2) return row.versions?.yMinus2;
  if (year === y - 1) return row.versions?.yMinus1;
  if (year === y) return row.versions?.y;
  if (year === y + 1) return row.versions?.yPlus1;
  if (year === y + 2) return row.versions?.yPlus2;
  // Return undefined if year not found
  return undefined;
}
