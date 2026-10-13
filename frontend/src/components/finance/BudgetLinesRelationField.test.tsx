import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import api from '../../api';
import BudgetLinesRelationField, {
  budgetLineIdsOf,
  mergeLinkedBudgetLines,
  sameBudgetLineIds,
  type LinkedBudgetLine,
} from './BudgetLinesRelationField';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
const mocked = vi.mocked(api);
beforeEach(() => mocked.get.mockReset());

const maintenance: LinkedBudgetLine = { id: 'opex-2', nature: 'opex', item_number: 2, product_name: 'SAP S/4HANA Maintenance' };

function renderField(value: LinkedBudgetLine[], onChange = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <BudgetLinesRelationField value={value} onChange={onChange} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return onChange;
}

describe('linked budget lines', () => {
  it('merges the OPEX and CAPEX lists into one list sorted by title', () => {
    const lines = mergeLinkedBudgetLines(
      [{ id: 'opex-2', item_number: 2, product_name: 'SAP S/4HANA Maintenance' }],
      [{ id: 'capex-125', item_number: 125, description: 'Migration S/4HANA' }],
    );
    expect(lines).toEqual([
      { id: 'capex-125', nature: 'capex', item_number: 125, product_name: 'Migration S/4HANA' },
      maintenance,
    ]);
    expect(budgetLineIdsOf(lines, 'opex')).toEqual(['opex-2']);
    expect(budgetLineIdsOf(lines, 'capex')).toEqual(['capex-125']);
    expect(sameBudgetLineIds(lines, [...lines].reverse())).toBe(true);
    expect(sameBudgetLineIds(lines, [maintenance])).toBe(false);
  });
});

describe('BudgetLinesRelationField', () => {
  it('shows the linked lines with their reference and searches both natures', async () => {
    mocked.get.mockResolvedValue({
      data: {
        items: [
          { id: 'opex-2', nature: 'opex', item_number: 2, product_name: 'SAP S/4HANA Maintenance' },
          { id: 'capex-125', nature: 'capex', item_number: 125, product_name: 'Migration S/4HANA' },
        ],
      },
    } as never);
    const onChange = renderField([maintenance]);

    expect(screen.getByText('BL-2 · SAP S/4HANA Maintenance')).toBeTruthy();
    expect(mocked.get).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole('combobox'));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/budget-lines/summary', expect.objectContaining({
      params: { page: 1, limit: 50, status: 'enabled', sort: 'product_name:ASC', q: undefined },
    })));
    const option = await screen.findByRole('option', { name: /BL-125 · Migration S\/4HANA/ });
    expect(within(option).getByText('ops:budget.capex')).toBeTruthy();
    // The linked line is not offered twice.
    expect(screen.queryByRole('option', { name: /BL-2 · / })).toBeNull();

    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith([
      maintenance,
      { id: 'capex-125', nature: 'capex', item_number: 125, product_name: 'Migration S/4HANA' },
    ]);
  });

  it('sends the typed text to the server search', async () => {
    mocked.get.mockResolvedValue({ data: { items: [] } } as never);
    renderField([]);
    const input = screen.getByRole('combobox');
    input.focus();
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'BL-125' } });
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/budget-lines/summary', expect.objectContaining({
      params: expect.objectContaining({ q: 'BL-125' }),
    })));
  });
});
