import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  // Counted messages come back as `key:count` and the ignored columns as
  // `key:columns`, so the tests can read what was passed.
  const t = (key: string, options?: { count?: number; columns?: string }) => (
    typeof options?.count === 'number' ? `${key}:${options.count}` : options?.columns ? `${key}:${options.columns}` : key
  );
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../api';
import CsvImportDialog from './CsvImportDialog';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

function renderDialog() {
  const view = render(<CsvImportDialog open onClose={() => undefined} endpoint="/suppliers" />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['a;b'], 'rows.csv', { type: 'text/csv' })] } });
  return view;
}

const report = (over: Record<string, unknown>) => ({ ok: true, dryRun: true, total: 14, inserted: 1, updated: 1, errors: [], ...over });

const DATES_DAY = 'Dates read day first: 01/03/2027 is March 1.';
const DATES_MONTH = 'Dates read month first: 01/03/2027 is January 3.';
const AMOUNTS_COMMA = 'Amounts read with a decimal comma: 12.280 is twelve thousand two hundred eighty.';
const AMOUNTS_DOT = 'Amounts read with a decimal dot: 12,280 is twelve thousand two hundred eighty.';

const lastCall = () => post.mock.calls[post.mock.calls.length - 1];
const lastParams = () => lastCall()?.[2]?.params;

describe('CsvImportDialog', () => {
  beforeEach(() => post.mockReset());

  it('shows the unchanged rows after the preflight check and after the load', async () => {
    post.mockResolvedValueOnce({ data: report({ unchanged: 12 }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    const preflight = await screen.findByRole('alert');
    expect(preflight).toHaveTextContent('csv.preflightOk');
    expect(preflight).toHaveTextContent('csv.rowsUnchanged:12');

    post.mockResolvedValueOnce({ data: report({ dryRun: false, processed: 14, unchanged: 12 }) });
    fireEvent.click(screen.getByRole('button', { name: 'csv.load' }));
    expect(await screen.findByText('csv.loadedSuccessfully')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('csv.rowsUnchanged:12');
  });

  it('heads row errors with validation failed: a frozen column refused on a row', async () => {
    post.mockResolvedValueOnce({
      data: report({ ok: false, errors: [{ row: 3, message: 'Budget for 2026 is frozen for OPEX. Unfreeze it first.' }] }),
    });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^csv\.validationFailed$/);
    expect(screen.getByText('csv.rowError')).toBeInTheDocument();
  });

  it('heads a header mismatch with file not formatted, on row 1 (budget rows) as on row 0 (other importers)', async () => {
    for (const row of [1, 0]) {
      post.mockResolvedValueOnce({
        data: report({ ok: false, total: 0, errors: [{ row, message: 'Header mismatch. Missing: year, Extra: -' }] }),
      });
      const view = renderDialog();
      fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/^csv\.fileNotFormatted$/);
      view.unmount();
    }
  });

  it('heads a header error reported with row errors with file not formatted', async () => {
    post.mockResolvedValueOnce({
      data: report({
        ok: false,
        errors: [
          { row: 0, message: 'Header mismatch. Missing: currency, Extra: -' },
          { row: 2, message: 'product_name is required' },
          { row: 5, message: 'Unknown supplier' },
        ],
      }),
    });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^csv\.fileNotFormatted$/);
    expect(screen.getAllByText('csv.rowError')).toHaveLength(3);
  });

  it('shows the server message when the request fails', async () => {
    post.mockRejectedValueOnce({ response: { status: 413, data: { message: 'File too large' } }, message: 'Request failed with status code 413' });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^File too large$/);
    expect(screen.queryByText('csv.fileNotFormatted')).not.toBeInTheDocument();
    expect(screen.queryByText('csv.rowError')).not.toBeInTheDocument();
  });

  it('falls back to file not formatted when the failed request carries no message', async () => {
    post.mockRejectedValueOnce({});
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^csv\.fileNotFormatted$/);
  });

  it('renders as before when the report has no unchanged count', async () => {
    post.mockResolvedValueOnce({ data: report({}) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    const preflight = await screen.findByRole('alert');
    expect(preflight).toHaveTextContent(/^csv\.preflightOk$/);
    expect(screen.queryByText(/csv\.rowsUnchanged/)).not.toBeInTheDocument();
  });

  it('shows the reading the dry run applied, with the switch that changes it', async () => {
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_COMMA } }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByText('operations.budgetFile.datesDayFirst')).toBeInTheDocument();
    expect(screen.getByText('operations.budgetFile.amountsComma')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.budgetFile.readMonthFirst' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.budgetFile.readDecimalDot' })).toBeInTheDocument();
    expect(lastParams()).toEqual({ language: 'en', dryRun: true });
  });

  it('shows the server sentence without a switch when it is not one the dialog knows', async () => {
    post.mockResolvedValueOnce({ data: report({ notices: { dates: 'Dates read the way the file says.', amounts: null } }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByText('Dates read the way the file says.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'operations.budgetFile.readMonthFirst' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'operations.budgetFile.readDayFirst' })).not.toBeInTheDocument();
  });

  it('checks again with the other date order when the switch is used', async () => {
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_COMMA } }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    await screen.findByText('operations.budgetFile.datesDayFirst');
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_MONTH, amounts: AMOUNTS_COMMA } }) });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.readMonthFirst' }));
    expect(await screen.findByText('operations.budgetFile.datesMonthFirst')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.budgetFile.readDayFirst' })).toBeInTheDocument();
    expect(lastCall()?.[0]).toBe('/suppliers/import');
    expect(lastParams()).toEqual({ language: 'en', dryRun: true, dateOrder: 'month-first', decimalMark: 'comma' });
  });

  it('switches the decimal mark while keeping the date order the dry run applied', async () => {
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_COMMA } }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    await screen.findByText('operations.budgetFile.amountsComma');
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_DOT } }) });
    fireEvent.click(screen.getByRole('button', { name: 'operations.budgetFile.readDecimalDot' }));
    expect(await screen.findByText('operations.budgetFile.amountsDot')).toBeInTheDocument();
    expect(lastParams()).toEqual({ language: 'en', dryRun: true, dateOrder: 'day-first', decimalMark: 'dot' });
  });

  it('imports with the reading the dry run applied when no switch is used', async () => {
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_COMMA } }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    await screen.findByText('operations.budgetFile.datesDayFirst');
    post.mockResolvedValueOnce({ data: report({ dryRun: false, processed: 14 }) });
    fireEvent.click(screen.getByRole('button', { name: 'csv.load' }));
    expect(await screen.findByText('csv.loadedSuccessfully')).toBeInTheDocument();
    expect(lastCall()?.[0]).toBe('/suppliers/import');
    expect(lastParams()).toEqual({ language: 'en', dryRun: false, dateOrder: 'day-first', decimalMark: 'comma' });
  });

  it('names the ignored columns the response lists', async () => {
    post.mockResolvedValueOnce({ data: report({ ignoredColumns: ['legacy_code', 'notes'] }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByText('csv.ignoredColumns:legacy_code, notes')).toBeInTheDocument();
  });

  it('shows no ignored columns line when the response lists none', async () => {
    post.mockResolvedValueOnce({ data: report({ ignoredColumns: [] }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^csv\.preflightOk$/);
    expect(screen.queryByText(/csv\.ignoredColumns/)).not.toBeInTheDocument();
  });
});
