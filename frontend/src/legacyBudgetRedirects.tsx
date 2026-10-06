import React from 'react';
import { Navigate, Route } from 'react-router-dom';

/**
 * Budget settings and operations that used to live under Master data. The old URLs
 * (bookmarks, links in documents) land on the new pages.
 */
export const LEGACY_BUDGET_REDIRECTS: ReadonlyArray<{ from: string; to: string }> = [
  { from: '/master-data/currency', to: '/ops/operations/currency' },
  { from: '/master-data/operations', to: '/ops/operations' },
  { from: '/master-data/operations/freeze', to: '/ops/operations/master-data-freeze' },
  { from: '/master-data/operations/copy', to: '/ops/operations/metrics-copy' },
];

/**
 * The redirect routes. They sit outside ProtectedRoute: the old paths have no permission
 * entry of their own, so the new route checks access after the redirect.
 */
export function legacyBudgetRedirectRoutes() {
  return LEGACY_BUDGET_REDIRECTS.map(({ from, to }) => (
    <Route key={from} path={from} element={<Navigate to={to} replace />} />
  ));
}
