import type { QueryClient } from '@tanstack/react-query';
import { resetSharedPatchBuffers } from '../hooks/patchBuffer';
import { resetListContextCache } from '../lib/listContext';
import { clearStoredBudgetListContext } from '../pages/budget/listContextStorage';

/**
 * Forgets everything this tab holds for the user signed in, when their session ends or another
 * user takes over: the next user starts on their own state, never on the previous user's list
 * filters, cached data or pending edits. Preferences stored per user (grid columns, scopes,
 * recent views) are keyed by user id and stay.
 */
export function clearUserClientState(queryClient: QueryClient): void {
  // Edits a workspace kept for the session (an edit waiting for a choice) end with it.
  resetSharedPatchBuffers();
  // Data fetched with the previous user's rights.
  queryClient.clear();
  // Saved list filters known in this tab, and the budget list state kept for the tab.
  resetListContextCache();
  clearStoredBudgetListContext();
}
