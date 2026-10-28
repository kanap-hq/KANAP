/**
 * The record tables whose page has the History tab. Lot 1C declares the budget line; the next lot
 * adds the other workspaces. Each table is served by `GET /records/:table/:id/history` and
 * declared in `backend/src/audit/record-history.inventory.ts`.
 */
export const RECORD_HISTORY_TABLES = ['spend_items'] as const;

export type RecordHistoryTable = (typeof RECORD_HISTORY_TABLES)[number];
