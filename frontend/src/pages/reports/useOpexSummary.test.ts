import { describe, expect, it } from 'vitest';
import { pickYearSlot, SummaryRow } from './useOpexSummary';

const slot = (budget: number) => ({ totals: { budget, follow_up: 0, landing: 0, revision: 0 } });

describe('pickYearSlot', () => {
  it('prefers the dynamic key, then falls back to the fixed keys from Y-2 to Y+2', () => {
    const y = new Date().getFullYear();
    const row: SummaryRow = {
      id: 'i-1',
      product_name: 'Licences',
      versions: { yMinus2: slot(1), yMinus1: slot(2), y: slot(3), yPlus1: slot(4), yPlus2: slot(5), [`y${y}`]: slot(30) },
    };
    expect(pickYearSlot(row, y)?.totals.budget).toBe(30);
    expect(pickYearSlot(row, y - 2)?.totals.budget).toBe(1);
    expect(pickYearSlot(row, y - 1)?.totals.budget).toBe(2);
    expect(pickYearSlot(row, y + 1)?.totals.budget).toBe(4);
    expect(pickYearSlot(row, y + 2)?.totals.budget).toBe(5);
    expect(pickYearSlot(row, y + 3)).toBeUndefined();
  });
});
