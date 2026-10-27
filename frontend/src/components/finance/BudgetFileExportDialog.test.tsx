import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { EXPORT_FORMAT_STORAGE_KEY } from '../csv/exportFormat';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const Y = new Date().getFullYear();

const columns: BudgetFileColumnChoice[] = [
  { key: 'budget', label: 'A0', shown: true },
  { key: 'revision', label: 'A1', shown: true },
  { key: 'forecast', label: 'A2', shown: false },
  { key: 'actual', label: 'Actuals', shown: true },
  { key: 'landing', label: 'Landing', shown: false },
];

function dialog(open: boolean, list = { sort: 'item_number:asc', q: 'cloud', filters: '', statusScope: 'enabled' }, scope: 'all' | 'capex' = 'capex') {
  return (
    <ThemeProvider theme={createAppTheme('light')}>
      <BudgetFileExportDialog
        open={open}
        onClose={() => undefined}
        scope={scope}
        columns={columns}
        columnsReady
        list={list}
        filteredCount={120}
      />
    </ThemeProvider>
  );
}

function renderDialog(list = { sort: 'item_number:asc', q: 'cloud', filters: '', statusScope: 'enabled' }, scope: 'all' | 'capex' = 'capex') {
  return render(dialog(true, list, scope));
}

/** jsdom has no localStorage here: an in-memory one, or one that throws. */
function stubStorage(storage: unknown) {
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true, writable: true });
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

describe('BudgetFileExportDialog', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: new Blob(['x']), headers: { 'content-disposition': 'attachment; filename="budget.csv"' } });
    window.URL.createObjectURL = vi.fn(() => 'blob:x');
    window.URL.revokeObjectURL = vi.fn();
    stubStorage(memoryStorage());
  });

  afterEach(() => {
    if (original) Object.defineProperty(window, 'localStorage', original);
    else delete (window as { localStorage?: unknown }).localStorage;
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
        format: 'csv',
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
      format: 'csv',
      sort: 'item_number:asc',
      all: 'true',
    });
  });

  it('saves budget.csv, the one file name of both lists, when the answer names none', async () => {
    get.mockResolvedValueOnce({ data: new Blob(['x']), headers: {} });
    const saved: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.exportFiltered:{"count":120}' }));
    await waitFor(() => expect(saved).toEqual(['budget.csv']));
    click.mockRestore();
  });

  it('exports the current year alone in one click, and gives the range back when unticked', async () => {
    renderDialog();
    const current = screen.getByRole('checkbox', { name: new RegExp(`operations.budgetFile.currentYearOnly:\\{"year":${Y}\\}`) });
    fireEvent.click(current);
    expect(screen.getByRole('combobox', { name: 'operations.budgetFile.fromYear' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('combobox', { name: 'operations.budgetFile.fromYear' })).toHaveTextContent(String(Y));
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.exportFiltered:{"count":120}' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get.mock.calls[0][1].params.amountYears).toBe(String(Y));
    fireEvent.click(current);
    expect(screen.getByRole('combobox', { name: 'operations.budgetFile.fromYear' })).toHaveTextContent(String(Y - 1));
    expect(screen.getByRole('combobox', { name: 'operations.budgetFile.toYearLabel' })).toHaveTextContent(String(Y + 1));
  });

  it('labels an unfiltered list with its line count', () => {
    renderDialog({ sort: '', q: '', filters: '', statusScope: 'enabled' });
    expect(screen.getByRole('button', { name: 'operations.budgetFile.exportCount:{"count":120}' })).toBeInTheDocument();
  });
  it('exports the unified list on budget-lines with the exact nature filter', async () => {
    const filters = JSON.stringify({ nature: { filterType: 'set', values: ['capex'] }, supplier_name: { filterType: 'set', values: ['Acme'] } });
    renderDialog({ sort: 'product_name:ASC', q: '', filters, statusScope: 'all' }, 'all');
    expect(screen.getByText('budget.exportTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.exportFiltered:{"count":120}' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get.mock.calls[0][0]).toBe('/budget-lines/budget-file/export');
    expect(get.mock.calls[0][1].params).toMatchObject({ filters, sort: 'product_name:ASC', includeDisabled: '1' });
  });

  it('exports in Excel when chosen, saves budget.xlsx and hides the CSV hint', async () => {
    get.mockResolvedValueOnce({ data: new Blob(['x']), headers: {} });
    const saved: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    renderDialog();
    expect(screen.getByRole('radio', { name: 'operations.budgetFile.formatCsv' })).toBeChecked();
    expect(screen.getByText('operations.budgetFile.formatHint')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'operations.budgetFile.formatXlsx' }));
    expect(screen.queryByText('operations.budgetFile.formatHint')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.exportFiltered:{"count":120}' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get.mock.calls[0][1].params.format).toBe('xlsx');
    await waitFor(() => expect(saved).toEqual(['budget.xlsx']));
    click.mockRestore();
  });

  it('remembers the format in this browser and gives it back on reopen', () => {
    const storage = memoryStorage();
    stubStorage(storage);
    const view = render(dialog(true));
    fireEvent.click(screen.getByRole('radio', { name: 'operations.budgetFile.formatXlsx' }));
    expect(storage.values.get(EXPORT_FORMAT_STORAGE_KEY)).toBe('xlsx');
    view.rerender(dialog(false));
    view.rerender(dialog(true));
    expect(screen.getByRole('radio', { name: 'operations.budgetFile.formatXlsx' })).toBeChecked();
    view.unmount();
    // A new dialog, as another list would open it: the same choice.
    render(dialog(true));
    expect(screen.getByRole('radio', { name: 'operations.budgetFile.formatXlsx' })).toBeChecked();
  });

  it('works with a storage that throws: CSV, and the choice still applies to this export', async () => {
    const refusing = () => { throw new Error('storage disabled'); };
    stubStorage({ getItem: refusing, setItem: refusing, removeItem: refusing });
    renderDialog();
    expect(screen.getByRole('radio', { name: 'operations.budgetFile.formatCsv' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'operations.budgetFile.formatXlsx' }));
    expect(screen.getByRole('radio', { name: 'operations.budgetFile.formatXlsx' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.exportFiltered:{"count":120}' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get.mock.calls[0][1].params.format).toBe('xlsx');
  });
});
