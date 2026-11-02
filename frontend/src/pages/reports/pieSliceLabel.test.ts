import { describe, expect, it } from 'vitest';
import { drawnSliceTotal, pieSliceLabel } from './pieSliceLabel';

describe('pieSliceLabel', () => {
  it('uses the sum of the slices drawn, including an others slice', () => {
    // 40 is 40% of the pie and would be 4% of a 1 000 total of every line.
    const drawn = drawnSliceTotal([40, 30, 20, 10]);
    expect(drawn).toBe(100);
    expect(pieSliceLabel(40, drawn)).toBe('40%');
    // The last value is the others slice: it counts in the sum, so 30 is 30%, not 30/90.
    expect(pieSliceLabel(30, drawnSliceTotal([40, 30, 20]))).toBe('33%');
    expect(pieSliceLabel(30, drawn)).toBe('30%');
  });

  it('stays blank under 3% and shows a slice at 3%', () => {
    expect(pieSliceLabel(3, drawnSliceTotal([97, 3]))).toBe('3%');
    expect(pieSliceLabel(299, 10_000)).toBe('');
    expect(pieSliceLabel(25, 1_000)).toBe('');
  });

  it('rounds a shown share and ignores a total that cannot be split', () => {
    expect(pieSliceLabel(34, 1_000)).toBe('3%');
    expect(pieSliceLabel(35, 1_000)).toBe('4%');
    expect(pieSliceLabel(10, 0)).toBe('');
    expect(pieSliceLabel(Number.NaN, 100)).toBe('');
    expect(drawnSliceTotal([10, Number.NaN, 5])).toBe(15);
  });
});
