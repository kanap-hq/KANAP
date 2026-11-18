import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import i18n from '../i18n';
import type { CsvImportResult } from '../components/csv/csv.types';

// Lot I4 of 26.11.9: the contacts import names a contact's supplier. The page's import dialog shows
// the supplier found accents aside, names its column, and undoes it as the other imports do.
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { importXlsx: false } }, isLoading: false }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, dataAccess: null, profile: { id: 'user-1' } }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'fr' }));
vi.mock('../components/PageHeader', () => ({ default: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div> }));
vi.mock('../components/ServerDataGrid', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));

import api from '../api';
import ContactsPage from './ContactsPage';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

const result = (over: Partial<CsvImportResult> = {}): CsvImportResult => ({
  ok: true, dryRun: true, total: 1, inserted: 0, updated: 1, skipped: 0, errors: [], warnings: [],
  matches: [{
    column: 'supplier_name', name: null, value: 'Equipe Cafe', target: 'Équipe Café', ref: 'SUP-3',
    origin: 'server', reason: 'accents', lines: [2], count: 1, undoable: true,
  }],
  matchesTotal: 1,
  ...over,
});

const unmatchedOf = (call: unknown[]) => {
  const raw = (call[1] as FormData).get('unmatched');
  return raw === null ? null : JSON.parse(String(raw));
};

describe('contacts import, the supplier found accents aside', () => {
  beforeEach(async () => {
    post.mockReset();
    await i18n.changeLanguage('fr');
  });
  afterEach(() => cleanup());

  it.each(['light', 'dark'] as const)('lists it under its column label and undoes it (%s)', async (mode) => {
    post
      .mockResolvedValueOnce({ data: result() })
      .mockResolvedValueOnce({ data: result({ matches: undefined, matchesTotal: undefined }) });
    render(
      <ThemeProvider theme={createAppTheme(mode)}>
        <MemoryRouter><ContactsPage /></MemoryRouter>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['email'], 'contacts.csv', { type: 'text/csv' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Vérification préalable' }));
    fireEvent.click(await screen.findByRole('button', { name: /^1 valeur rapprochée/ }));
    expect(post.mock.calls[0][0]).toBe('/contacts/import');
    // The French colon follows a non-breaking space, which the default text matcher folds away.
    const line = screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'Fournisseur : Equipe Cafe → SUP-3 Équipe Café');
    fireEvent.click(within(line.parentElement!).getByRole('button', { name: 'Défaire' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(unmatchedOf(post.mock.calls[0])).toBeNull();
    expect(unmatchedOf(post.mock.calls[1])).toEqual([{ column: 'supplier_name', value: 'Equipe Cafe' }]);
    expect(post.mock.calls[1][2]).toEqual({ params: expect.objectContaining({ dryRun: true }) });
  });
});
