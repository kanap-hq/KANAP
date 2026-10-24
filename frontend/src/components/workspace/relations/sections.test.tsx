import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { formatAmount } from '../../../i18n/formatters';
import api from '../../../api';
import { assetsSection, budgetLinesSection, searchRelationItems } from './sections';
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

  it('shows no total when no line has an amount, even with a disabled line', () => {
    expect(totalsOf([line('a', null), line('b', null), line('c', null, 'disabled')])).toEqual([]);
  });

  it('shows a zero total when the only amount is on a disabled line it leaves out', () => {
    const totals = totalsOf([line('a', null), line('b', 40, 'disabled')]);
    expect(totals.map((row) => row.key)).toEqual(['total', 'disabled']);
    expect(totals[0].cells.amount).toBe(formatAmount(0));
  });

  it('adds no note without a disabled line', () => {
    const totals = totalsOf([line('a', 100), line('b', null)]);
    expect(totals.map((row) => row.key)).toEqual(['total']);
    expect(totals[0].cells.amount).toBe(formatAmount(100));
  });
});

describe('relation picker search', () => {
  it('lists the page by business reference, whatever order the server answers in', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { items: [
        { id: 'p-14', item_number: 14, name: 'Fourteen' },
        { id: 'p-3', item_number: 3, name: 'Three' },
        { id: 'p-9', item_number: 9, name: 'Nine' },
        { id: 'p-x', item_number: null, name: 'No reference' },
      ] },
    } as never);
    const options = await searchRelationItems('/portfolio/projects', 'project', (row) => row.name ?? '')('');
    expect(options.map((option) => option.ref)).toEqual(['PRJ-3', 'PRJ-9', 'PRJ-14', null]);
  });
});

describe('asset relation picker', () => {
  it('names a cluster as the server pickers do, and leaves a plain asset as it is', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { items: [
        { id: 'a-1', name: 'QA-CL-A', asset_reference: 'AST-71', is_cluster: true },
        { id: 'a-2', name: 'QA-VM1', asset_reference: 'AST-74', is_cluster: false },
        { id: 'a-3', name: 'QA-VM2', asset_reference: 'AST-75' },
      ] },
    } as never);
    const label = (code?: string | null) => code ?? '';
    const section = assetsSection({ t, rows: [], kindLabel: label, environmentLabel: label, statusLabel: label });
    const options = await section.search!('QA');
    expect(options).toEqual([
      { id: 'a-1', label: 'common:selects.cluster QA-CL-A', ref: 'AST-71' },
      { id: 'a-2', label: 'QA-VM1', ref: 'AST-74' },
      { id: 'a-3', label: 'QA-VM2', ref: 'AST-75' },
    ]);
  });
});
