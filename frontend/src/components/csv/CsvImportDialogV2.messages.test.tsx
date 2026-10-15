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
import CsvImportDialogV2 from './CsvImportDialogV2';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

const report = (over: Record<string, unknown>) => ({
  ok: true, dryRun: true, total: 1, inserted: 1, updated: 0, skipped: 0, errors: [], warnings: [], ...over,
});

function pick(name = 'projets.csv') {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['name'], name, { type: 'text/csv' })] } });
}

function validate() {
  render(<CsvImportDialogV2 open onClose={() => undefined} endpoint="/portfolio/projects" />);
  pick();
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
}

describe('CsvImportDialogV2 messages', () => {
  beforeEach(() => {
    post.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('shows the unknown columns as a translated warning that lets the import go on', async () => {
    post.mockResolvedValueOnce({
      data: report({
        warnings: [{
          row: 0,
          message: 'Unknown columns (will be ignored): notes',
          code: 'CSV_HEADER_IGNORED_COLUMNS',
          params: { extra: 'notes' },
        }],
      }),
    });
    validate();
    expect(await screen.findByText('Ces colonnes ne sont pas importées : notes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importer' })).toBeEnabled();
  });

  it('translates the row errors with the values they name', async () => {
    post.mockResolvedValueOnce({
      data: report({
        ok: false,
        inserted: 0,
        errors: [
          { row: 2, column: 'name', message: 'name is required', code: 'CSV_VALUE_REQUIRED' },
          {
            row: 3,
            column: 'status',
            message: 'Invalid status: "x". Valid values: open, done',
            code: 'CSV_ENUM_INVALID',
            params: { value: 'x', allowed: 'open, done' },
          },
        ],
      }),
    });
    validate();
    expect(await screen.findByText(/Une valeur est obligatoire\./)).toBeInTheDocument();
    expect(screen.getByText(/« x » n'est pas valide\. Valeurs possibles : open, done\./)).toBeInTheDocument();
    expect(screen.queryByText(/name is required/)).not.toBeInTheDocument();
  });

  it('translates a refused file encoding', async () => {
    post.mockRejectedValueOnce({
      response: {
        status: 400,
        data: { statusCode: 400, message: 'This file is not UTF-8 or Windows-1252.', code: 'CSV_ENCODING_UNSUPPORTED' },
      },
    });
    validate();
    expect(await screen.findByRole('alert')).toHaveTextContent("Ce fichier n'est ni en UTF-8 ni en Windows-1252.");
  });

  it('refuses an Excel workbook with one sentence, no column list', async () => {
    post.mockRejectedValueOnce({
      response: {
        status: 400,
        data: { statusCode: 400, message: 'This file is an Excel workbook, not a CSV.', code: 'CSV_FILE_EXCEL' },
      },
    });
    validate();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ce fichier est un classeur Excel, pas un CSV. Dans Excel : Fichier › Enregistrer sous › CSV UTF-8 (délimité par des virgules).',
    );
    expect(screen.queryByText(/Colonnes manquantes|ne sont pas importées/)).not.toBeInTheDocument();
  });

  it('drops the refusal of the previous file when another file is picked', async () => {
    post.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Old refusal' } } });
    validate();
    expect(await screen.findByRole('alert')).toHaveTextContent('Old refusal');
    pick('autre.csv');
    expect(screen.queryByText('Old refusal')).not.toBeInTheDocument();
  });

  it('counts one row in the singular', async () => {
    post.mockResolvedValueOnce({ data: report({ total: 1, inserted: 1 }) });
    validate();
    expect(await screen.findByText('Validation réussie. Prêt à importer 1 ligne.')).toBeInTheDocument();
    expect(screen.getByText('1 ligne')).toBeInTheDocument();
  });

  it('shows the rows identical to what is stored as unchanged', async () => {
    post.mockResolvedValueOnce({ data: report({ total: 3, inserted: 0, updated: 1, unchanged: 2 }) });
    validate();
    expect(await screen.findByText('2 inchangées')).toBeInTheDocument();
    expect(screen.getByText('1 à mettre à jour')).toBeInTheDocument();
  });
});
