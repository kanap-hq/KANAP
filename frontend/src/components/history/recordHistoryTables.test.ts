import { describe, expect, it } from 'vitest';
import { RECORD_HISTORY_TABLES } from './recordHistoryTables';

// The record tables whose page has the History tab: `spend_items` in lot 1C, extended by lot 2.
describe('record history tables', () => {
  it('declares the budget line and keeps the list unique and readable', () => {
    expect(RECORD_HISTORY_TABLES).toContain('spend_items');
    expect(new Set(RECORD_HISTORY_TABLES).size).toBe(RECORD_HISTORY_TABLES.length);
    for (const table of RECORD_HISTORY_TABLES) {
      // A physical table name, as the route takes it.
      expect(table).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
