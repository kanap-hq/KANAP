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

  it('says which date-times without a zone are read as UTC, and lets the import go on', async () => {
    post.mockResolvedValueOnce({
      data: report({
        inserted: 0,
        updated: 1,
        warnings: [{
          row: 0,
          message: 'Times without a time zone, read as UTC: started_at, detected_at',
          code: 'CSV_HEADER_ZONELESS_DATE_TIMES',
          params: { columns: 'started_at, detected_at', example: 'started_at' },
        }],
      }),
    });
    validate();
    expect(await screen.findByText(
      'Heures sans fuseau lues en UTC : started_at, detected_at. Nommez le fuseau après la colonne, par exemple started_at (Europe/Paris).',
    )).toBeInTheDocument();
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

  it('counts one unchanged and one skipped row in the singular', async () => {
    post.mockResolvedValueOnce({ data: report({ total: 2, inserted: 0, unchanged: 1, skipped: 1 }) });
    validate();
    expect(await screen.findByText('1 inchangée')).toBeInTheDocument();
    expect(screen.getByText('1 ignorée')).toBeInTheDocument();
  });

  it('names an asset column by its export label', async () => {
    post.mockResolvedValueOnce({
      data: report({
        ok: false,
        inserted: 0,
        errors: [
          { row: 2, column: 'hostname', message: 'not a host name', code: 'asset_hostname_invalid', params: { value: 'qa c4!' } },
          { row: 3, column: 'ip_1_address', message: 'not an ip', code: 'asset_ip_invalid', params: { value: '999.999.1.1' } },
          { row: 4, column: 'go_live_date', message: 'not a date', code: 'CSV_DATE_INVALID', params: { value: '31/02/2025' } },
        ],
      }),
    });
    render(<CsvImportDialogV2 open onClose={() => undefined} endpoint="/assets" />);
    pick('actifs.csv');
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await screen.findByText(/n'est pas un nom d'hôte valide/);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      "Ligne 2 : « qa c4! » n'est pas un nom d'hôte valide. (Nom d’hôte)",
      "Ligne 3 : « 999.999.1.1 » n'est pas une adresse IP valide. (Adresse IP 1)",
      "Ligne 4 : « 31/02/2025 » n'est pas une date. Utilisez 2026-09-02 ou 02/09/2026. (Date de mise en service)",
    ]);
  });

  it('names the column after a message only when the message does not', async () => {
    post.mockResolvedValueOnce({
      data: report({
        ok: false,
        inserted: 0,
        errors: [
          {
            row: 0,
            column: 'detected_at',
            message: 'Unknown time zone in the detected_at column: "Foo/Bar".',
            code: 'CSV_HEADER_UNKNOWN_TIME_ZONE',
            params: { column: 'detected_at', zone: 'Foo/Bar' },
          },
          { row: 2, column: 'name', message: 'name is required', code: 'CSV_VALUE_REQUIRED' },
        ],
      }),
    });
    validate();
    await screen.findByText(/Fuseau horaire inconnu/);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Fuseau horaire inconnu dans la colonne detected_at : Foo/Bar. Utilisez un fuseau comme Europe/Paris ou UTC.',
      'Ligne 2 : Une valeur est obligatoire. (Nom)',
    ]);
  });
});
