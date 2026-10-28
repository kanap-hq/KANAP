import { describe, expect, it } from 'vitest';
import { RECORD_HISTORY_TABLES } from './recordHistoryTables';

// The record tables whose page has a history: the budget line in lot 1C, the account and cost
// center in lot 2, the first masters of family A.
describe('record history tables', () => {
  it('declares the budget line, the account and the cost center, unique and readable', () => {
    expect(RECORD_HISTORY_TABLES).toEqual(['spend_items', 'accounts', 'companies', 'cost_centers', 'departments']);
    expect(new Set(RECORD_HISTORY_TABLES).size).toBe(RECORD_HISTORY_TABLES.length);
    for (const table of RECORD_HISTORY_TABLES) {
      // A physical table name, as the route takes it.
      expect(table).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
