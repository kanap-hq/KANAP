import { useQuery } from '@tanstack/react-query';
import api from '../api';
import type { UserOption } from '../components/fields/userLookup';

/**
 * The people a cost centre proposes first in the IT and business owner pickers of a budget line
 * (`GET /budget-lines/owner-suggestions`). Names only, in the user lookup order; the picker still
 * offers every enabled person, so the group is a suggestion, never a restriction.
 */
export const OWNER_SUGGESTIONS_ENDPOINT = '/budget-lines/owner-suggestions';

/** One key per centre: changing the line's cost centre reads the new group. */
export function ownerSuggestionsKey(costCenterId: string | null | undefined) {
  return ['budget-lines', 'owner-suggestions', costCenterId || null] as const;
}

type OwnerSuggestionsPage = { items?: UserOption[]; has_more?: boolean };

const NO_SUGGESTIONS: UserOption[] = [];

/**
 * The suggested people of this cost centre. Disabled without a centre (the picker is the plain
 * lookup then); `enabled` lets a caller wait for its list to open before reading.
 */
export function useOwnerSuggestions(costCenterId: string | null | undefined, enabled = true): UserOption[] {
  const center = costCenterId || null;
  const query = useQuery({
    queryKey: ownerSuggestionsKey(center),
    queryFn: async ({ signal }) => {
      const res = await api.get<OwnerSuggestionsPage>(OWNER_SUGGESTIONS_ENDPOINT, {
        params: { cost_center_id: center },
        signal,
      });
      return res.data?.items ?? NO_SUGGESTIONS;
    },
    enabled: enabled && !!center,
    staleTime: 30_000,
  });
  return query.data ?? NO_SUGGESTIONS;
}
