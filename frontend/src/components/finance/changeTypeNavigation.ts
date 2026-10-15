import type { QueryClient } from '@tanstack/react-query';
import type { LineType } from '../../constants/lineTypeUsage';

/** The queries a change of type makes stale: lines, lists, tasks, dashboard and reports of both types. */
const STALE_AFTER_TYPE_CHANGE = /spend|capex|opex|budget|task|dashboard|report|chargeback|change-type/;

/** The queries that show one line, by its id: the route's read of its type and the workspace's detail. */
const LINE_QUERIES = new Set(['budget-line-resolve', 'budget-line']);

/**
 * After a change of type (lot M): every query about budget lines is marked stale without being
 * read again now, then the workspace of the line that carries the new type opens, by its BL
 * reference. A line changed in place keeps its id and reference: the workspace stays mounted on the
 * same route, so the queries that show that line (its type, read by the route, and its detail) are
 * read again at once. A successor opens on its own reference and reads its own.
 */
export function openLineAfterTypeChange(
  queryClient: QueryClient,
  navigate: (to: string) => void,
  line: { id: string; reference: string | null; nature: LineType },
): void {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      return typeof head === 'string' && STALE_AFTER_TYPE_CHANGE.test(head);
    },
    refetchType: 'none',
  });
  void queryClient.refetchQueries({
    type: 'active',
    predicate: (query) => LINE_QUERIES.has(query.queryKey[0] as string)
      && (query.state.data as { id?: string } | undefined)?.id === line.id,
  });
  navigate(budgetLinePath(line));
}

/** The workspace of a line of either type, by its BL reference (its id without one). */
export function budgetLinePath(line: { id: string; reference: string | null; nature: LineType }): string {
  return `/ops/budget/${line.reference ?? line.id}/overview`;
}
