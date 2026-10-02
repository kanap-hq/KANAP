import type { QueryClient } from '@tanstack/react-query';

/**
 * The Allocations tab's cache of a line's allocation for one year (AllocationsTab). It holds the
 * year's totals next to the shares, so every write to a budget forgets it: the tab then reads the
 * year again instead of showing the amounts from before the write. Kept apart from the tabs so
 * the Budget tab and the operations pages forget it without loading the Allocations tab's code.
 */
export const allocationsSnapshotKey = (itemsApi: string, id: string, year: number) => ['finance-allocations', itemsApi, id, year] as const;

/** After a write to one line's budget for a year (Budget tab: totals, cells, spread, lines, column clear). */
export function forgetAllocationsYear(queryClient: QueryClient, itemsApi: string, id: string, year: number): void {
  queryClient.removeQueries({ queryKey: allocationsSnapshotKey(itemsApi, id, year), exact: true });
}

/** After a write over many lines (column copy or reset, allocation copy, budget rows import). */
export function forgetAllAllocations(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: ['finance-allocations'] });
}
