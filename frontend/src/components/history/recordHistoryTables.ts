/**
 * The record tables whose page has a history: the budget line's History tab, the account and cost
 * center History buttons of lot 2, the Knowledge document's History tab of lot 2 family E, the masters of
 * family A, the asset and technology of family D, the application of the linked records lot, the supplier and contact of family B, and the site,
 * connection and interface of family C, and the task's History button. Each table is served by `GET /records/:table/:id/history` and
 * declared in `backend/src/audit/record-history.inventory.ts`; the backend inventory spec keeps both
 * lists equal.
 */
export const RECORD_HISTORY_TABLES = [
  'spend_items',
  'accounts',
  'analytics_axes',
  'analytics_categories',
  'applications',
  'assets',
  'business_processes',
  'companies',
  'connections',
  'contacts',
  'contracts',
  'cost_centers',
  'departments',
  'documents',
  'incidents',
  'interfaces',
  'locations',
  'suppliers',
  'tasks',
  'technologies',
  'working_day_profiles',
] as const;

export type RecordHistoryTable = (typeof RECORD_HISTORY_TABLES)[number];
