import { describe, expect, it } from 'vitest';
import { csvMessageText } from './csvMessage';

// A `t` that writes the sentence's values after its key, to see what the sentence names.
const t = ((key: string, options: Record<string, unknown>) => `${key} ${options.columns ?? ''}|${options.missing ?? ''}`) as never;
const labels: Record<string, string> = { name: 'Nom', supplier_name: 'Fournisseur', country_iso: 'Pays' };
const label = (column: string) => labels[column] ?? column;

describe('csv import messages', () => {
  it('names the columns a message lists by their labels (lot I6c of 26.12.1)', () => {
    expect(csvMessageText({ row: 3, code: 'CSV_DUPLICATE_KEY', message: 'x', params: { columns: 'name, supplier_name', firstRow: 2 } }, t, label))
      .toBe('errors:CSV_DUPLICATE_KEY Nom, Fournisseur|');
    expect(csvMessageText({ row: 0, code: 'CSV_HEADER_MISSING_COLUMNS', message: 'x', params: { missing: 'name, Ville' } }, t, label))
      .toBe('errors:CSV_HEADER_MISSING_COLUMNS |Nom, Ville');
  });

  it('keeps the keys without a way to name them', () => {
    expect(csvMessageText({ row: 3, code: 'CSV_DUPLICATE_KEY', message: 'x', params: { columns: 'name' } }, t)).toBe('errors:CSV_DUPLICATE_KEY name|');
  });
});
