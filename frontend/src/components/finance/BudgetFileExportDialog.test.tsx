import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    if (options && Object.keys(options).length > 0) return `${key}:${JSON.stringify(options)}`;
    return key;
  };
  return { useTranslation: () => ({ t, i18n: { language: 'de', resolvedLanguage: 'de' } }) };
});

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import BudgetFileExportDialog, { BudgetFileColumnChoice } from './BudgetFileExportDialog';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const Y = new Date().getFullYear();

const columns: BudgetFileColumnChoice[] = [
  { key: 'budget', label: 'A0', shown: true },
  { key: 'revision', label: 'A1', shown: true },
  { key: 'forecast', label: 'A2', shown: false },
  { key: 'actual', label: 'Actuals', shown: true },
  { key: 'landing', label: 'Landing', shown: false },
];

function renderDialog(list = { sort: 'item_number:asc', q: 'cloud', filters: '', statusScope: 'enabled' }) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <BudgetFileExportDialog
        open
        onClose={() => undefined}
        scope="capex"
        columns={columns}
        columnsReady
        list={list}
        filteredCount={120}
      />
    </ThemeProvider>,
  );
}

describe('BudgetFileExportDialog', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: new Blob(['x']), headers: { 'content-disposition': 'attachment; filename="capex.csv"' } });
    window.URL.createObjectURL = vi.fn(() => 'blob:x');
    window.URL.revokeObjectURL = vi.fn();
  });

  it('exports the filtered list in the screen language, the shown columns and three years', async () => {
    renderDialog();
    const save = screen.getByRole('button', { name: 'operations.budgetFile.exportFiltered:{"count":120}' });
    expect(screen.getByRole('checkbox', { name: /^A2/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^A0/ })).toBeChecked();
    fireEvent.click(save);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith('/capex-items/budget-file/export', {
      params: {
        language: 'de',
        amountYears: `${Y - 1},${Y},${Y + 1}`,
        columns: 'budget,revision,actual',
        detail: 'yearly',
        sort: 'item_number:asc',
        q: 'cloud',
        status: 'enabled',
      },
      responseType: 'blob',
    });
  });

  it('exports every line with All lines, a hidden column and months', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: /operations.budgetFile.allLines/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^A2/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'operations.budgetFile.months' }));
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.exportAll' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const params = get.mock.calls[0][1].params;
    expect(params).toEqual({
      language: 'de',
      amountYears: `${Y - 1},${Y},${Y + 1}`,
      columns: 'budget,revision,forecast,actual',
      detail: 'months',
      sort: 'item_number:asc',
      all: 'true',
    });
  });

  it('labels an unfiltered list with its line count', () => {
    renderDialog({ sort: '', q: '', filters: '', statusScope: 'enabled' });
    expect(screen.getByRole('button', { name: 'operations.budgetFile.exportCount:{"count":120}' })).toBeInTheDocument();
  });
});
