import { useCallback } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * The query keys other pages read these lists under. A write on the settings page marks them
 * stale, so those pages show the lists as they now are.
 */
export const SHARED_LIST_KEYS = {
  criteria: [['portfolio-criteria']],
  settings: [['portfolio-settings']],
  skills: [['portfolio-skills']],
  classification: [['portfolio-classification'], ['portfolio-sources'], ['portfolio-categories'], ['portfolio-streams']],
  teams: [['portfolio-teams']],
  employmentTypes: [['portfolio-employment-types']],
} satisfies Record<string, QueryKey[]>;

export type SharedList = keyof typeof SHARED_LIST_KEYS;

/** Marks the queries of a list stale after a write. */
export function useInvalidateSharedLists(): (list: SharedList) => void {
  const queryClient = useQueryClient();
  return useCallback((list: SharedList) => {
    for (const queryKey of SHARED_LIST_KEYS[list]) void queryClient.invalidateQueries({ queryKey });
  }, [queryClient]);
}
