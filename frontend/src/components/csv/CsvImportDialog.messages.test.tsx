import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import frCommon from '../../locales/fr/common.json';
import frErrors from '../../locales/fr/errors.json';

// The real French strings: the import report must read in the interface language.
const instance = i18next.createInstance();
void instance.init({
  lng: 'fr',
  resources: { fr: { common: frCommon, errors: frErrors } },
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  initImmediate: false,
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => instance.t(key, options),
    i18n: { language: 'fr', resolvedLanguage: 'fr' },
  }),
}));

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../../api';
import CsvImportDialog from './CsvImportDialog';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

function check(errors: unknown[], over: Record<string, unknown> = {}) {
  post.mockResolvedValueOnce({ data: { ok: false, dryRun: true, total: 0, inserted: 0, updated: 0, errors, ...over } });
  render(<CsvImportDialog open onClose={() => undefined} endpoint="/chart-of-accounts/fr/accounts" />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['a;b'], 'comptes.csv', { type: 'text/csv' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Vérification préalable' }));
}

describe('CsvImportDialog messages', () => {
  beforeEach(() => post.mockReset());

  it('labels a header problem as the header and translates it with its columns', async () => {
    check([{
      row: 0,
      message: 'Header mismatch. Missing: account_name',
      code: 'CSV_HEADER_MISSING_COLUMNS',
      params: { missing: 'account_name', extra: '' },
    }]);
    expect(await screen.findByText('En-tête : Colonnes manquantes : account_name.')).toBeInTheDocument();
    expect(screen.queryByText(/Ligne 0/)).not.toBeInTheDocument();
  });

  it('labels a header problem without a code as the header too', async () => {
    check([{ row: 0, message: "Column 'status' appears twice." }]);
    expect(await screen.findByText("En-tête : Column 'status' appears twice.")).toBeInTheDocument();
  });

  it('translates the account row errors, with the value they are about', async () => {
    check([
      { row: 3, message: 'account_number is required and must be an integer', code: 'CSV_ACCOUNT_NUMBER_REQUIRED' },
      { row: 4, message: "Invalid nature 'both'. Use 'opex', 'capex' or leave it empty.", code: 'CSV_ACCOUNT_NATURE_INVALID', params: { value: 'both' } },
    ]);
    expect(await screen.findByText('Ligne 3 : Le numéro de compte (account_number) est obligatoire et doit être un nombre entier.')).toBeInTheDocument();
    expect(screen.getByText('Ligne 4 : Nature « both » invalide. Utilisez opex, capex ou laissez la cellule vide.')).toBeInTheDocument();
  });

  it('names an unknown column once when the header is refused for it', async () => {
    check(
      [{ row: 0, message: 'Header mismatch. Extra: x', code: 'CSV_HEADER_UNKNOWN_COLUMNS', params: { missing: '', extra: 'x' } }],
      { ignoredColumns: ['x'] },
    );
    expect(await screen.findByText('En-tête : Colonnes inconnues : x.')).toBeInTheDocument();
    expect(screen.queryByText(/Colonnes ignorées/)).not.toBeInTheDocument();
  });

  it('counts one row in the singular, and zero too in French', async () => {
    check([], { ok: true, total: 1, inserted: 1, updated: 0, unchanged: 0 });
    expect(await screen.findByText(/Vérification OK : 1 ligne\./)).toBeInTheDocument();
    expect(screen.getByText('0 ligne inchangée.')).toBeInTheDocument();
  });
});
