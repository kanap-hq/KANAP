import type { QueryClient } from '@tanstack/react-query';
import type { LineType } from '../../constants/lineTypeUsage';

/** The queries a change of type makes stale: lines, lists, tasks, dashboard and reports of both types. */
const STALE_AFTER_TYPE_CHANGE = /spend|capex|opex|budget|task|dashboard|report|chargeback|change-type/;

/**
 * After a change of type (lot M): every query about budget lines is marked stale without being
 * read again now (the line shown here may be gone from its route: an OPEX line that became CAPEX),
 * then the workspace of the line that carries the new type opens, by its BL reference (both routes
 * take it).
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
  navigate(budgetLinePath(line));
}

/** The workspace of a line of either type, by its BL reference (its id without one). */
export function budgetLinePath(line: { id: string; reference: string | null; nature: LineType }): string {
  return `/ops/${line.nature}/${line.reference ?? line.id}/overview`;
}
