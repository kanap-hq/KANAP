import { describe, expect, it } from 'vitest';
import { budgetLineLabel } from './budgetLineLabel';

describe('budget line task labels', () => {
  it('uses the native BL number for a line with a different legacy CAPEX number', () => {
    expect(budgetLineLabel({ item_number: 127, product_name: 'Investment' })).toBe('BL-127 · Investment');
  });
  it('uses the explicit reference and never falls back to a technical id', () => {
    expect(budgetLineLabel({ reference: 'BL-4', product_name: ' Software ' })).toBe('BL-4 · Software');
    expect(budgetLineLabel({ product_name: 'Software' })).toBe('Software');
    expect(budgetLineLabel({})).toBeNull();
  });
});
