import { describe, expect, it } from 'vitest';
import { formatFte } from '../../components/finance/amountColumns';
import { createTextMeasurer, readGridTextMetrics, valueColumnWidth } from './reportValueWidth';

describe('valueColumnWidth', () => {
  const byLength = (text: string) => text.length;
  const format = (value: unknown) => formatFte(value, 'en');
  const ids = ['m1', 'm2', 'm3', 'm7', 'average', 'peak'];
  const row = (value: number | null) => Object.fromEntries(ids.map((id) => [id, value]));
  const measureOf = (patch: Record<string, unknown>, total: Record<string, unknown> = row(1)) => valueColumnWidth({
    rows: [row(1), { ...row(2), ...patch }],
    total,
    ids,
    format,
    measure: byLength,
    cellPadding: 10,
  });

  it('takes the widest formatted value of any value column, plus the padding on both sides and a margin', () => {
    // `1,234.50`: 8 characters.
    expect(measureOf({ peak: 1234.5 })).toBe(8 + 20 + 6);
    expect(measureOf({ m3: 1234.5, m7: 98765.25 })).toBe('98,765.25'.length + 20 + 6);
  });

  it('reads only the listed value columns', () => {
    expect(measureOf({ other: 98765.25, m2: 12.5 })).toBe('12.50'.length + 20 + 6);
  });

  it('counts the total row', () => {
    expect(measureOf({}, { ...row(1), average: 123456.75 })).toBe('123,456.75'.length + 20 + 6);
  });

  it('never goes narrower than `00.00`, and ignores empty cells', () => {
    expect(measureOf({ m1: null, m2: 0.5 })).toBe(5 + 20 + 6);
    expect(valueColumnWidth({ rows: [], total: row(null), ids, format, measure: byLength, cellPadding: 10 })).toBe(5 + 20 + 6);
  });

  it('rounds up to a whole pixel', () => {
    expect(valueColumnWidth({ rows: [], total: row(1), ids, format, measure: () => 40.2, cellPadding: 10 })).toBe(67);
  });
});

describe('createTextMeasurer', () => {
  it('measures with a canvas in the given font, every digit as a tabular `0`', () => {
    const measured: string[] = [];
    const context = { font: '', measureText: (text: string) => { measured.push(text); return { width: 50 }; } };
    const measure = createTextMeasurer('bold 13px Inter', 13, () => context as unknown as CanvasRenderingContext2D);
    expect(measure('1,234.50')).toBe(50);
    expect(context.font).toBe('bold 13px Inter');
    expect(measured).toEqual(['0,000.00']);
  });

  it('estimates from the character count without a canvas context', () => {
    expect(createTextMeasurer('bold 13px Inter', 13, () => null)('00.00')).toBeCloseTo(5 * 13 * 0.65);
    expect(createTextMeasurer('bold 14px Inter', 14, () => { throw new Error('no canvas'); })('1.00')).toBeCloseTo(4 * 14 * 0.65);
    const noMeasure = { font: '' } as unknown as CanvasRenderingContext2D;
    expect(createTextMeasurer('bold 13px Inter', 13, () => noMeasure)('6.00')).toBeCloseTo(4 * 13 * 0.65);
  });
});

describe('readGridTextMetrics', () => {
  it('reads the dense grid theme variables on a probe it removes', () => {
    const style = document.createElement('style');
    style.textContent = '.ag-theme-quartz.kanap-dense-grid { --ag-font-family: Inter, sans-serif; --ag-font-size: 14px; --ag-cell-horizontal-padding: 8px; }';
    document.head.appendChild(style);
    try {
      expect(readGridTextMetrics()).toEqual({ font: 'bold 14px Inter, sans-serif', fontSize: 14, cellPadding: 8 });
    } finally {
      style.remove();
    }
    expect(document.querySelector('.kanap-dense-grid')).toBeNull();
  });

  it('falls back to 13 px and 10 px padding without the theme', () => {
    const metrics = readGridTextMetrics();
    expect(metrics.fontSize).toBe(13);
    expect(metrics.cellPadding).toBe(10);
    expect(metrics.font).toMatch(/^bold 13px /);
    expect(document.querySelector('.kanap-dense-grid')).toBeNull();
  });
});
