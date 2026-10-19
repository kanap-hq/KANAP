import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  // Counted messages come back as `key:count`, the ignored columns as
  // `key:columns`, a row error about a column as `key:column:message` and a
  // message with a value and what is stored as `key:value:stored`, so the
  // tests can read what was passed.
  const t = (key: string, options?: { count?: number; columns?: string; column?: string; message?: string; value?: string; stored?: number }) => (
    typeof options?.count === 'number' ? `${key}:${options.count}`
      : options?.columns ? `${key}:${options.columns}`
        : options?.column ? `${key}:${options.column}:${options.message}`
          : options?.stored != null ? `${key}:${options.value}:${options.stored}`
            : key
  );
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../api';
import en from '../../locales/en/it.json';
import fr from '../../locales/fr/it.json';
import de from '../../locales/de/it.json';
import es from '../../locales/es/it.json';
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

  it('shows the unchanged rows after the preflight check, and the load counts after the load', async () => {
    post.mockResolvedValueOnce({ data: report({ unchanged: 12 }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    const preflight = await screen.findByRole('alert');
    expect(preflight).toHaveTextContent('csv.preflightOk');
    expect(preflight).toHaveTextContent('csv.rowsUnchanged:12');

    post.mockResolvedValueOnce({ data: report({ dryRun: false, processed: 14, unchanged: 12 }) });
    fireEvent.click(screen.getByRole('button', { name: 'csv.load' }));
    expect(await screen.findByText('csv.loadedCreated:1, csv.loadedUpdated:1, csv.loadedUnchanged:12')).toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('csv.rowsUnchanged');
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

  it('translates a row error that has a code, with the column it is about', async () => {
    post.mockResolvedValueOnce({
      data: report({
        ok: false,
        errors: [
          { row: 4, column: 'description', message: 'description is too long: 250 KB of text, the limit is 200 KB.', code: 'MARKDOWN_TOO_LARGE' },
          { row: 5, column: 'supplier', message: 'Unknown supplier' },
        ],
      }),
    });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByText('csv.rowColumnError:description:errors:MARKDOWN_TOO_LARGE')).toBeInTheDocument();
    // A row error without a code reads as before.
    expect(screen.getByText('csv.rowError')).toBeInTheDocument();
  });

  it('shows the warnings of a check that passed, translated with their values, and not after the load', async () => {
    const warnings = [{
      row: 2, column: 'account_number', code: 'CSV_ACCOUNT_NUMBER_LEADING_ZEROS',
      params: { value: '06156', stored: 6156 }, message: '06156 will be stored as 6156.',
    }];
    post.mockResolvedValueOnce({ data: report({ warnings }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByTestId('csv-import-warnings'))
      .toHaveTextContent('csv.rowColumnError:account_number:errors:CSV_ACCOUNT_NUMBER_LEADING_ZEROS:06156:6156');
    expect(screen.getByRole('button', { name: 'csv.load' })).toBeEnabled();

    post.mockResolvedValueOnce({ data: report({ dryRun: false, processed: 14, warnings }) });
    fireEvent.click(screen.getByRole('button', { name: 'csv.load' }));
    expect(await screen.findByText('csv.loadedCreated:1, csv.loadedUpdated:1')).toBeInTheDocument();
    expect(screen.queryByTestId('csv-import-warnings')).toBeNull();
  });

  it('heads a header mismatch with file not formatted, on row 1 (budget rows) as on row 0 (other importers)', async () => {
    for (const row of [1, 0]) {
      post.mockResolvedValueOnce({
        data: report({ ok: false, total: 0, errors: [{ row, message: 'Header mismatch. Missing: year' }] }),
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
          { row: 0, message: 'Header mismatch. Missing: currency' },
          { row: 2, message: 'product_name is required' },
          { row: 5, message: 'Unknown supplier' },
        ],
      }),
    });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^csv\.fileNotFormatted$/);
    // The header problem is labelled as such, the others by their row.
    expect(screen.getAllByText('csv.headerError')).toHaveLength(1);
    expect(screen.getAllByText('csv.rowError')).toHaveLength(2);
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
    expect(preflight).toHaveTextContent(/^csv\.preflightOk:14$/);
    expect(screen.queryByText(/csv\.rowsUnchanged/)).not.toBeInTheDocument();
  });

  it('shows the reading the dry run applied, with the switch that changes it', async () => {
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_COMMA } }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByText('ops:operations.budgetFile.datesDayFirst')).toBeInTheDocument();
    expect(screen.getByText('ops:operations.budgetFile.amountsComma')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ops:operations.budgetFile.readMonthFirst' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ops:operations.budgetFile.readDecimalDot' })).toBeInTheDocument();
    expect(lastParams()).toEqual({ language: 'en', dryRun: true });
  });

  it('shows the server sentence without a switch when it is not one the dialog knows', async () => {
    post.mockResolvedValueOnce({ data: report({ notices: { dates: 'Dates read the way the file says.', amounts: null } }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByText('Dates read the way the file says.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ops:operations.budgetFile.readMonthFirst' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ops:operations.budgetFile.readDayFirst' })).not.toBeInTheDocument();
  });

  it('checks again with the other date order when the switch is used', async () => {
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_COMMA } }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    await screen.findByText('ops:operations.budgetFile.datesDayFirst');
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_MONTH, amounts: AMOUNTS_COMMA } }) });
    fireEvent.click(screen.getByRole('button', { name: 'ops:operations.budgetFile.readMonthFirst' }));
    expect(await screen.findByText('ops:operations.budgetFile.datesMonthFirst')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ops:operations.budgetFile.readDayFirst' })).toBeInTheDocument();
    expect(lastCall()?.[0]).toBe('/suppliers/import');
    expect(lastParams()).toEqual({ language: 'en', dryRun: true, dateOrder: 'month-first', decimalMark: 'comma' });
  });

  it('switches the decimal mark while keeping the date order the dry run applied', async () => {
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_COMMA } }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    await screen.findByText('ops:operations.budgetFile.amountsComma');
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_DOT } }) });
    fireEvent.click(screen.getByRole('button', { name: 'ops:operations.budgetFile.readDecimalDot' }));
    expect(await screen.findByText('ops:operations.budgetFile.amountsDot')).toBeInTheDocument();
    expect(lastParams()).toEqual({ language: 'en', dryRun: true, dateOrder: 'day-first', decimalMark: 'dot' });
  });

  it('imports with the reading the dry run applied when no switch is used', async () => {
    post.mockResolvedValueOnce({ data: report({ notices: { dates: DATES_DAY, amounts: AMOUNTS_COMMA } }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    await screen.findByText('ops:operations.budgetFile.datesDayFirst');
    post.mockResolvedValueOnce({ data: report({ dryRun: false, processed: 14 }) });
    fireEvent.click(screen.getByRole('button', { name: 'csv.load' }));
    expect(await screen.findByText('csv.loadedCreated:1, csv.loadedUpdated:1')).toBeInTheDocument();
    expect(lastCall()?.[0]).toBe('/suppliers/import');
    expect(lastParams()).toEqual({ language: 'en', dryRun: false, dateOrder: 'day-first', decimalMark: 'comma' });
  });

  it('drops the report of the previous file when another file is picked', async () => {
    post.mockResolvedValueOnce({ data: report({ ok: false, errors: [{ row: 2, message: 'Old problem' }] }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    expect(await screen.findByText('csv.rowError')).toBeInTheDocument();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['c;d'], 'other.csv', { type: 'text/csv' })] } });
    expect(screen.queryByText('csv.rowError')).not.toBeInTheDocument();
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
    expect(await screen.findByRole('alert')).toHaveTextContent(/^csv\.preflightOk:14$/);
    expect(screen.queryByText(/csv\.ignoredColumns/)).not.toBeInTheDocument();
  });

  it('shows the accepted values the page gives, under the description', () => {
    render(<CsvImportDialog open onClose={() => undefined} endpoint="/suppliers" hint="status: enabled or disabled." />);
    expect(screen.getByText('status: enabled or disabled.')).toBeInTheDocument();
  });

  it('shows an introduction and one line per rule', () => {
    const hints = [en, fr, de, es].map((file) => file.pages.technologies.linkFiles.importHint);
    for (const hint of hints) {
      expect(hint.asset.items.length).toBeGreaterThan(1);
      expect(hint.application.items.length).toBeGreaterThan(0);
    }
    const { asset } = en.pages.technologies.linkFiles.importHint;
    render(<CsvImportDialog open onClose={() => undefined} endpoint="/technologies/asset-links" hintList={asset} />);
    expect(screen.getByText(asset.intro)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(asset.items);
  });
});
