import { describe, expect, it } from 'vitest';
import { RECORD_HISTORY_TABLES } from './recordHistoryTables';

// The record tables whose page has a history: the budget line in lot 1C, the account and cost
// center in lot 2, the Knowledge document in lot 2 family E, the first masters of family A, the
// asset and the technology of family D, the supplier and the contact of family B, the site, the
// connection and the interface of family C, the application of the linked records lot.
describe('record history tables', () => {
  it('declares the budget line and the record pages of the families, unique and readable', () => {
    expect(RECORD_HISTORY_TABLES).toEqual([
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
      'portfolio_projects',
      'suppliers',
      'tasks',
      'technologies',
      'working_day_profiles',
    ]);
    expect(new Set(RECORD_HISTORY_TABLES).size).toBe(RECORD_HISTORY_TABLES.length);
    for (const table of RECORD_HISTORY_TABLES) {
      // A physical table name, as the route takes it.
      expect(table).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
