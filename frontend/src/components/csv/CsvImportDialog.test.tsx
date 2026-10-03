import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  // Counted messages come back as `key:count` so the tests can read the count.
  const t = (key: string, options?: { count?: number }) => (typeof options?.count === 'number' ? `${key}:${options.count}` : key);
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
});
