import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import frCommon from '../../locales/fr/common.json';
import frErrors from '../../locales/fr/errors.json';
import frOps from '../../locales/fr/ops.json';
import { DATE_DAY, AMOUNT_COMMA } from './readings';

// The real French strings: the import report must read in the interface language.
const instance = i18next.createInstance();
void instance.init({
  lng: 'fr',
  resources: { fr: { common: frCommon, errors: frErrors, ops: frOps } },
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

  // `useTranslation(['common', 'ops'])` binds `t` to `common`: a key of `ops` needs its prefix.
  it('words the date and amount readings, not their keys', async () => {
    check([], { ok: true, notices: { dates: DATE_DAY, amounts: AMOUNT_COMMA } });
    expect(await screen.findByText(frOps.operations.budgetFile.datesDayFirst)).toBeTruthy();
    expect(screen.getByText(frOps.operations.budgetFile.readMonthFirst)).toBeTruthy();
    expect(screen.getByText(frOps.operations.budgetFile.amountsComma)).toBeTruthy();
    expect(screen.queryByText(/operations\.budgetFile/)).toBeNull();
  });

  it('labels a header problem as the header and translates it with its columns', async () => {
    check([{
      row: 0,
      message: 'Header mismatch. Missing: account_number',
      code: 'CSV_HEADER_MISSING_COLUMNS',
      params: { missing: 'account_number', extra: '' },
    }]);
    expect(await screen.findByText('En-tête : Colonnes manquantes : account_number.')).toBeInTheDocument();
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

  it('translates the supplier row errors, with the column they are about', async () => {
    check([
      { row: 2, column: 'name', message: 'Name is required', code: 'CSV_VALUE_REQUIRED' },
      { row: 3, column: 'status', message: "Invalid status 'actif'.", code: 'CSV_ENUM_INVALID', params: { value: 'actif', allowed: 'enabled, disabled' } },
      { row: 4, column: 'name', message: "'qa-dup' is already on row 2.", code: 'CSV_SUPPLIER_NAME_DUPLICATE', params: { name: 'qa-dup', firstRow: 2 } },
      { row: 5, column: 'technical_contact', message: 'Contact not found', code: 'CSV_CONTACT_NOT_FOUND', params: { email: 'nobody@example.com' } },
      { row: 6, column: 'commercial_contact', message: 'Invalid commercial_contact email', code: 'CSV_EMAIL_INVALID', params: { value: 'not-an-email' } },
    ]);
    expect(await screen.findByText('Ligne 2, name : Une valeur est obligatoire.')).toBeInTheDocument();
    expect(screen.getByText('Ligne 3, status : « actif » n\'est pas valide. Valeurs possibles : enabled, disabled.')).toBeInTheDocument();
    expect(screen.getByText('Ligne 4, name : « qa-dup » figure déjà à la ligne 2. Gardez une seule ligne par fournisseur.')).toBeInTheDocument();
    expect(screen.getByText('Ligne 5, technical_contact : Contact introuvable : nobody@example.com. Créez-le d\'abord dans Contacts.')).toBeInTheDocument();
    expect(screen.getByText('Ligne 6, commercial_contact : « not-an-email » n\'est pas une adresse e-mail valide.')).toBeInTheDocument();
  });

  it('translates a company name that the file already used', async () => {
    check([{
      row: 3,
      column: 'name',
      message: "'qa-faute' is already on row 2. Keep one row per company.",
      code: 'CSV_COMPANY_NAME_DUPLICATE',
      params: { name: 'qa-faute', firstRow: 2 },
    }]);
    expect(await screen.findByText('Ligne 3, name : « qa-faute » figure déjà à la ligne 2. Gardez une seule ligne par société.')).toBeInTheDocument();
  });

  it('translates a company row whose metrics fall in a frozen year', async () => {
    check([{
      row: 2,
      message: 'Metrics for 2027 are frozen. A budget administrator can unfreeze them.',
      code: 'CSV_COMPANY_METRICS_FROZEN',
      params: { year: 2027 },
    }]);
    expect(await screen.findByText('Ligne 2 : Les indicateurs pour 2027 sont gelés. Un administrateur budgétaire peut les dégeler.')).toBeInTheDocument();
  });

  it('says which stored record a row matched when the case of its name differs', async () => {
    check([], {
      ok: true,
      updated: 1,
      warnings: [{ row: 2, column: 'name', message: "'sap' was matched to 'SAP'.", code: 'CSV_NAME_MATCHED_CASE', params: { name: 'sap', stored: 'SAP' } }],
    });
    expect(await screen.findByText('Ligne 2, name : « sap » a été rapproché de « SAP ».')).toBeInTheDocument();
  });

  // D12 of 26.11.9: a file from another workspace names unrelated records by the same references.
  it('says which record a reference renames or moves, agreed with its family, and still loads', async () => {
    check([], {
      ok: true,
      updated: 3,
      warnings: [
        { row: 2, message: 'COMP-3 "Acme SA" will be renamed "Beta".', code: 'CSV_REFERENCE_RENAMES', params: { reference: 'COMP-3', stored: 'Acme SA', name: 'Beta', context: 'company' } },
        { row: 3, message: 'DEPT-5 "Achat" will be renamed "Achats".', code: 'CSV_REFERENCE_RENAMES', params: { reference: 'DEPT-5', stored: 'Achat', name: 'Achats', context: 'department' } },
        { row: 4, message: 'DEPT-4 "Achats" will move from company "Acme SA" to "Beta".', code: 'CSV_REFERENCE_MOVES', params: { reference: 'DEPT-4', name: 'Achats', from: 'Acme SA', to: 'Beta', context: 'company' } },
      ],
    });
    expect(await screen.findByText('Ligne 2 : COMP-3 « Acme SA » sera renommée « Beta ».')).toBeInTheDocument();
    expect(screen.getByText('Ligne 3 : DEPT-5 « Achat » sera renommé « Achats ».')).toBeInTheDocument();
    expect(screen.getByText('Ligne 4 : DEPT-4 « Achats » passera de la société « Acme SA » à « Beta ».')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Charger' })).toBeEnabled();
  });

  // R3 of 26.11.9: the contact a reference names keeps its e-mail address unless the check says so.
  it('says which supplier or contact a reference renames, moves or gives another e-mail address, and still loads', async () => {
    check([], {
      ok: true,
      updated: 3,
      warnings: [
        { row: 2, message: 'SUP-3 "Acme" will be renamed "Beta".', code: 'CSV_REFERENCE_RENAMES', params: { reference: 'SUP-3', stored: 'Acme', name: 'Beta', context: 'supplier' } },
        { row: 3, message: 'CTCT-4 "Jean Dupont" will be renamed "Jean Martin".', code: 'CSV_REFERENCE_RENAMES', params: { reference: 'CTCT-4', stored: 'Jean Dupont', name: 'Jean Martin', context: 'contact' } },
        { row: 4, message: 'CTCT-4 "Jean Dupont" will change its e-mail address.', code: 'CSV_REFERENCE_EMAIL_CHANGES', params: { reference: 'CTCT-4', name: 'Jean Dupont', from: 'a@x.fr', to: 'b@x.fr' } },
      ],
    });
    expect(await screen.findByText('Ligne 2 : SUP-3 « Acme » sera renommé « Beta ».')).toBeInTheDocument();
    expect(screen.getByText('Ligne 3 : CTCT-4 « Jean Dupont » sera renommé « Jean Martin ».')).toBeInTheDocument();
    expect(screen.getByText("Ligne 4 : CTCT-4 « Jean Dupont » changera d'adresse e-mail : « a@x.fr » → « b@x.fr ».")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Charger' })).toBeEnabled();
  });

  it('translates the end of validity that contradicts the status', async () => {
    check([
      { row: 2, column: 'status', message: 'Status is enabled but the end of validity has passed.', code: 'CSV_STATUS_DATE_PASSED' },
      { row: 3, column: 'status', message: 'Status is disabled but the end of validity is still to come.', code: 'CSV_STATUS_DATE_FUTURE' },
    ]);
    expect(await screen.findByText(/^Ligne 2, status : Le statut est « Activé », mais la fin de validité est passée\. Écrivez « - » dans la fin de validité, ou « disabled » dans le statut\./)).toBeInTheDocument();
    expect(screen.getByText(/^Ligne 3, status : Le statut est « Désactivé », mais la fin de validité est encore à venir\. Écrivez « enabled » dans le statut/)).toBeInTheDocument();
  });

  it('names an unknown column once when the header is refused for it', async () => {
    check(
      [{ row: 0, message: 'Header mismatch. Extra: x', code: 'CSV_HEADER_UNKNOWN_COLUMNS', params: { missing: '', extra: 'x' } }],
      { ignoredColumns: ['x'] },
    );
    expect(await screen.findByText('En-tête : Colonnes inconnues : x.')).toBeInTheDocument();
    expect(screen.queryByText(/Colonnes ignorées/)).not.toBeInTheDocument();
  });

  it('counts created, updated and unchanged rows after the load', async () => {
    check([], { ok: true, dryRun: false, total: 3, processed: 3, inserted: 1, updated: 1, unchanged: 1 });
    expect(await screen.findByText('1 créée, 1 mise à jour, 1 inchangée')).toBeInTheDocument();
    expect(screen.queryByText(/Chargé avec succès/)).not.toBeInTheDocument();
  });

  it('counts one row in the singular, and zero too in French', async () => {
    check([], { ok: true, total: 1, inserted: 1, updated: 0, unchanged: 0 });
    expect(await screen.findByText(/Vérification OK : 1 ligne\./)).toBeInTheDocument();
    expect(screen.getByText('0 ligne inchangée.')).toBeInTheDocument();
  });

  it('says in French how many stored values the check will clear', async () => {
    check([], { ok: true, total: 4, inserted: 0, updated: 2, unchanged: 2, cleared: 3 });
    expect(await screen.findByText('3 valeurs seront effacées.')).toBeInTheDocument();
    expect(screen.getByText('2 lignes inchangées.')).toBeInTheDocument();
  });

  it('states the clearing rule in French beside the title', () => {
    render(<CsvImportDialog open onClose={() => undefined} endpoint="/chart-of-accounts/fr/accounts" />);
    expect(screen.getByRole('img', { name: "Une cellule vide garde la valeur enregistrée. Un tiret (-) l'efface." })).toBeInTheDocument();
  });
});
