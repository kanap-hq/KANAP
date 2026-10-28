import { describe, expect, it } from 'vitest';
import { RECORD_HISTORY_TABLES } from './recordHistoryTables';

// The record tables whose page has a history: the budget line in lot 1C, the account and cost
// center in lot 2, the site, connection and interface in lot 2 family C.
describe('record history tables', () => {
  it('declares the six record tables, unique and readable', () => {
    expect(RECORD_HISTORY_TABLES).toEqual([
      'spend_items', 'accounts', 'cost_centers', 'locations', 'connections', 'interfaces',
    ]);
    expect(new Set(RECORD_HISTORY_TABLES).size).toBe(RECORD_HISTORY_TABLES.length);
    for (const table of RECORD_HISTORY_TABLES) {
      // A physical table name, as the route takes it.
      expect(table).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
