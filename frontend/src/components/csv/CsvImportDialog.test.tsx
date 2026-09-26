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
  const view = render(<CsvImportDialog open onClose={() => undefined} endpoint="/budget-rows" />);
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

  it('renders as before when the report has no unchanged count', async () => {
    post.mockResolvedValueOnce({ data: report({}) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
    const preflight = await screen.findByRole('alert');
    expect(preflight).toHaveTextContent(/^csv\.preflightOk$/);
    expect(screen.queryByText(/csv\.rowsUnchanged/)).not.toBeInTheDocument();
  });
});
