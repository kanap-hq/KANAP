import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import type { CsvImportResult } from './csv.types';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { importXlsx: false } }, isLoading: false }) }));

import api from '../../api';
import CsvImportDialog from './CsvImportDialog';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

// Lot I3 of 26.11.9, fifth pass: the import dialog of the lists that read their own files (here the
// contracts) shows the matches of the check as the applications' does, and undoes them the same way.

const result = (over: Partial<CsvImportResult> = {}): CsvImportResult => ({
  ok: true, dryRun: true, total: 1, inserted: 1, updated: 0, skipped: 0, errors: [], warnings: [],
  matches: [{
    column: 'company_name', name: null, value: 'Fromage Co', target: 'Fromage & Co', ref: 'COMP-2',
    origin: 'server', reason: 'accents', lines: [2], count: 1, undoable: true,
  }],
  matchesTotal: 1,
  ...over,
});

const unmatchedOf = (call: unknown[]) => {
  const raw = (call[1] as FormData).get('unmatched');
  return raw === null ? null : JSON.parse(String(raw));
};

describe('CsvImportDialog, the matches of the check', () => {
  beforeEach(async () => {
    post.mockReset();
    await i18n.changeLanguage('fr');
  });
  afterEach(() => cleanup());

  it('names the column by its label, checks again without an undone match and loads with the same list', async () => {
    post
      .mockResolvedValueOnce({ data: result() })
      .mockResolvedValueOnce({ data: result({ matches: undefined, matchesTotal: undefined }) })
      .mockResolvedValueOnce({ data: result({ dryRun: false, matches: undefined, matchesTotal: undefined }) });
    render(
      <ThemeProvider theme={createAppTheme('dark')}>
        <CsvImportDialog open onClose={() => undefined} endpoint="/contracts" flexibleFormat />
      </ThemeProvider>,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['name'], 'contrats.csv', { type: 'text/csv' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Vérification préalable' }));
    fireEvent.click(await screen.findByRole('button', { name: /^1 valeur rapprochée/ }));
    // The French colon follows a non-breaking space, which the default text matcher folds away.
    const line = screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'Société\u00a0: Fromage Co → COMP-2 Fromage & Co');
    fireEvent.click(within(line.parentElement!).getByRole('button', { name: 'Défaire' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(unmatchedOf(post.mock.calls[0])).toBeNull();
    expect(unmatchedOf(post.mock.calls[1])).toEqual([{ column: 'company_name', value: 'Fromage Co' }]);
    await waitFor(() => expect(screen.queryByRole('button', { name: /valeur rapprochée/ })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Charger' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post.mock.calls[2][2]).toEqual({ params: expect.objectContaining({ dryRun: false }) });
    expect(unmatchedOf(post.mock.calls[2])).toEqual([{ column: 'company_name', value: 'Fromage Co' }]);
  });
});
