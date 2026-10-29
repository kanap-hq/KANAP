import { useQuery } from '@tanstack/react-query';
import api from '../api';
import type { UserOption } from '../components/fields/userLookup';

/**
 * The people a cost centre proposes first in the IT and business owner pickers of a budget line
 * (`GET /budget-lines/owner-suggestions`). Names only, in the user lookup order; the picker still
 * offers every enabled person, so the group is a suggestion, never a restriction.
 */
export const OWNER_SUGGESTIONS_ENDPOINT = '/budget-lines/owner-suggestions';

/**
 * One key per centre and line: changing the line's cost centre reads the new group, and another
 * line may open a centre outside the person's nodes when it is read as its owner.
 */
export function ownerSuggestionsKey(costCenterId: string | null | undefined, lineRef?: string | null) {
  return ['budget-lines', 'owner-suggestions', costCenterId || null, lineRef || null] as const;
}

type OwnerSuggestionsPage = { items?: UserOption[]; has_more?: boolean };

const NO_SUGGESTIONS: UserOption[] = [];

type OwnerSuggestionsOptions = {
  /**
   * The line shown in edit mode. A limited caller may ask about a centre outside its nodes when it
   * reads this line as its owner; the route resolves the line under RLS.
   */
  lineRef?: string | null;
  /** Read only once the picker's list opens. */
  enabled?: boolean;
};

/**
 * The suggested people of this cost centre. Disabled without a centre (the picker is the plain
 * lookup then); `enabled` lets a caller wait for its list to open before reading.
 */
export function useOwnerSuggestions(
  costCenterId: string | null | undefined,
  options: OwnerSuggestionsOptions = {},
): UserOption[] {
  const center = costCenterId || null;
  const lineRef = options.lineRef || null;
  const enabled = options.enabled ?? true;
  const query = useQuery({
    queryKey: ownerSuggestionsKey(center, lineRef),
    queryFn: async ({ signal }) => {
      const res = await api.get<OwnerSuggestionsPage>(OWNER_SUGGESTIONS_ENDPOINT, {
        params: { cost_center_id: center, ...(lineRef ? { line: lineRef } : {}) },
        signal,
      });
      return res.data?.items ?? NO_SUGGESTIONS;
    },
    enabled: enabled && !!center,
    staleTime: 30_000,
  });
  return query.data ?? NO_SUGGESTIONS;
}
