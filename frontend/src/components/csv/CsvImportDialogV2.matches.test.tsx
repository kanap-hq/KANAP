import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import type { CsvImportMatch, CsvImportResult } from './csv.types';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { importXlsx: false } }, isLoading: false }) }));

import api from '../../api';
import CsvImportDialogV2 from './CsvImportDialogV2';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

// Lot I3 of 26.11.9, fifth pass: the import dialog of the applications shows the names the check
// found beyond case under its warnings; Undo checks the file again without that match, and the load
// sends the same list.

const match: CsvImportMatch = {
  column: 'supplier_name', name: null, value: 'Societe Generale', target: 'Société Générale', ref: 'SUP-3',
  origin: 'server', reason: 'accents', lines: [2], count: 1, undoable: true,
};

const result = (over: Partial<CsvImportResult> = {}): CsvImportResult => ({
  ok: true, dryRun: true, total: 1, inserted: 1, updated: 0, skipped: 0, errors: [],
  warnings: [{ row: 2, column: 'lifecycle', message: 'Unknown lifecycle', code: undefined }],
  matches: [match], matchesTotal: 1,
  ...over,
});

/** The `unmatched` field of the form a call sent, read back as a list. */
function unmatchedOf(call: unknown[]): unknown {
  const form = call[1] as FormData;
  const raw = form.get('unmatched');
  return raw === null ? null : JSON.parse(String(raw));
}

function renderDialog() {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <CsvImportDialogV2 open onClose={() => undefined} endpoint="/applications" />
    </ThemeProvider>,
  );
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['name'], 'applications.csv', { type: 'text/csv' })] } });
}

describe('CsvImportDialogV2, the matches of the check', () => {
  beforeEach(async () => {
    post.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => cleanup());

  it('shows the match under the warnings once the file is checked, the column by its label, the record with its reference', async () => {
    post.mockResolvedValueOnce({ data: result() });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    const toggle = await screen.findByRole('button', { name: /^1 value matched/ });
    expect(screen.getByText('Unknown lifecycle')).toBeInTheDocument();
    // Below the warnings.
    expect(screen.getByText('Unknown lifecycle').compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByText('Supplier: Societe Generale → SUP-3 Société Générale')).toBeInTheDocument();
    expect(unmatchedOf(post.mock.calls[0])).toBeNull();
  });

  it('checks the file again without an undone match, and loads with the same list', async () => {
    post
      .mockResolvedValueOnce({ data: result() })
      .mockResolvedValueOnce({ data: result({ matches: undefined, matchesTotal: undefined }) })
      .mockResolvedValueOnce({ data: result({ dryRun: false, matches: undefined, matchesTotal: undefined }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    fireEvent.click(await screen.findByRole('button', { name: /^1 value matched/ }));
    fireEvent.click(within(screen.getByText(/Societe Generale → SUP-3/).parentElement!).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][2]).toEqual({ params: expect.objectContaining({ dryRun: true }) });
    expect(unmatchedOf(post.mock.calls[1])).toEqual([{ column: 'supplier_name', value: 'Societe Generale' }]);
    await waitFor(() => expect(screen.queryByRole('button', { name: /value matched/ })).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post.mock.calls[2][2]).toEqual({ params: expect.objectContaining({ dryRun: false }) });
    expect(unmatchedOf(post.mock.calls[2])).toEqual([{ column: 'supplier_name', value: 'Societe Generale' }]);
  });

  it('keeps an undone match listed with Match again, even with no match left, and Match again checks with it again', async () => {
    const editor: CsvImportMatch = { ...match, value: 'Akeneo', target: 'Akeneo', ref: 'SUP-34', origin: 'editor', reason: 'editor' };
    post
      .mockResolvedValueOnce({ data: result({ matches: [editor] }) })
      .mockResolvedValueOnce({ data: result({ matches: undefined, matchesTotal: undefined }) })
      .mockResolvedValueOnce({ data: result({ matches: [editor] }) });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    fireEvent.click(await screen.findByRole('button', { name: /^1 value matched/ }));
    fireEvent.click(within(screen.getByText(/Akeneo → SUP-34/).parentElement!).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    // The undone match stays listed, said as the check made it, with its way back.
    const undone = await screen.findByText('Supplier (publisher): Akeneo');
    fireEvent.click(within(undone.parentElement!).getByRole('button', { name: 'Match again' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post.mock.calls[2][2]).toEqual({ params: expect.objectContaining({ dryRun: true }) });
    expect(unmatchedOf(post.mock.calls[2])).toBeNull();
    // The matches stay unfolded through the checks.
    expect(await screen.findByText('Supplier (publisher): Akeneo → SUP-34 Akeneo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Match again' })).toBeNull();
  });
});
