import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { formatAmount } from '../../../i18n/formatters';
import { budgetLinesSection } from './sections';
import type { BudgetLineRow } from './types';

vi.mock('../../../api', () => ({ default: { get: vi.fn() } }));

const t = ((key: string, opts?: Record<string, unknown>) =>
  (opts?.count != null ? `${key}(count=${opts.count})` : key)) as unknown as TFunction;

const line = (id: string, amount: number | null, status = 'enabled'): BudgetLineRow => ({
  id, item_number: 1, nature: 'opex', product_name: id, supplier_name: null, amount, currency: 'EUR', status,
});

function totalsOf(lines: BudgetLineRow[]) {
  const section = budgetLinesSection({ t, rows: lines, year: 2026, columnLabel: 'Budget', currency: 'EUR' });
  return section.totals!(lines);
}

describe('budget lines total', () => {
  it('adds the enabled lines only and says how many disabled lines it leaves out', () => {
    const totals = totalsOf([line('a', 100), line('b', 50), line('c', 1000, 'disabled')]);
    expect(totals.map((row) => row.key)).toEqual(['total', 'disabled']);
    expect(totals[0].cells.amount).toBe(formatAmount(150));
    render(<>{totals[1].label}</>);
    expect(screen.getByText('workspace.application.relations.disabledNotCounted(count=1)')).toBeInTheDocument();
  });

  it('counts every disabled line in the note, and shows a zero total when all are disabled', () => {
    const totals = totalsOf([line('a', 10, 'disabled'), line('b', 20, 'disabled')]);
    expect(totals[0].cells.amount).toBe(formatAmount(0));
    render(<>{totals[1].label}</>);
    expect(screen.getByText('workspace.application.relations.disabledNotCounted(count=2)')).toBeInTheDocument();
  });

  it('adds no note without a disabled line', () => {
    const totals = totalsOf([line('a', 100), line('b', null)]);
    expect(totals.map((row) => row.key)).toEqual(['total']);
    expect(totals[0].cells.amount).toBe(formatAmount(100));
  });
});
