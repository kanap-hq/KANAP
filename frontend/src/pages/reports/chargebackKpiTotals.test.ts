import { describe, expect, it } from 'vitest';
import { chargebackKpiTotals } from './chargebackKpiTotals';

describe('chargebackKpiTotals', () => {
  it('divides amounts in the reporting currency, never the raw ones', () => {
    // Paris 70,000 EUR; New York 35,000 USD = 31,500 EUR. A USD line: its raw amount is in USD.
    const totals = chargebackKpiTotals([
      { amount: 600, amountRaw: 600, headcount: 10, itUsers: 5, turnover: 70000, turnoverRaw: 70000 },
      { amount: 600, amountRaw: 666.67, headcount: 10, itUsers: 5, turnover: 31500, turnoverRaw: 35000 },
    ] as any);
    expect(totals.turnoverDisplayTotal).toBe(101500);
    expect(totals.costVsTurnover).toBeCloseTo((1200 / 101500) * 100, 10);
    expect(totals.costPerUser).toBe(60);
    expect(totals.costPerItUser).toBe(120);
  });
});
