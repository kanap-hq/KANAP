/**
 * The record tables whose page has a history: the budget line's History tab, the account and cost
 * center History buttons of lot 2, the supplier's History tab and the contact's History button.
 * Each table is served by `GET /records/:table/:id/history` and declared in
 * `backend/src/audit/record-history.inventory.ts`; the backend inventory spec keeps both lists equal.
 */
export const RECORD_HISTORY_TABLES = ['spend_items', 'accounts', 'cost_centers', 'suppliers'] as const;

export type RecordHistoryTable = (typeof RECORD_HISTORY_TABLES)[number];
