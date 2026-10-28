/**
 * The record tables whose page has a history: the budget line, the account and cost center of the
 * first lot 2 runs, and the asset and technology of family D. Each table is served by
 * `GET /records/:table/:id/history` and declared in `backend/src/audit/record-history.inventory.ts`;
 * the backend inventory spec keeps both lists equal.
 */
export const RECORD_HISTORY_TABLES = ['spend_items', 'accounts', 'cost_centers', 'assets', 'technologies'] as const;

export type RecordHistoryTable = (typeof RECORD_HISTORY_TABLES)[number];
