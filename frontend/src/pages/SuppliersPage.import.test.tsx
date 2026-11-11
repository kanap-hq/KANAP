import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import { frenchSpacing } from '../i18n/formatters';
import enMasterData from '../locales/en/master-data.json';
import frMasterData from '../locales/fr/master-data.json';
import deMasterData from '../locales/de/master-data.json';
import esMasterData from '../locales/es/master-data.json';

// Column titles written by the suppliers template (`backend/src/suppliers/supplier-csv-headers.ts`).
const TEMPLATE_TITLES = {
  en: { status: 'Status', disabledAt: 'Disabled on' },
  fr: { status: 'Statut', disabledAt: 'Désactivé le' },
  de: { status: 'Status', disabledAt: 'Deaktiviert am' },
  es: { status: 'Estado', disabledAt: 'Desactivado el' },
} as const;

const dialogs = vi.hoisted(() => ({ import: null as null | Record<string, unknown> }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr', resolvedLanguage: 'fr' } }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'fr' }));
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('../components/ServerDataGrid', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({
  default: (props: Record<string, unknown>) => { dialogs.import = props; return null; },
}));

import SuppliersPage from './SuppliersPage';

const hints = {
  en: enMasterData.suppliers.importHint,
  fr: frMasterData.suppliers.importHint,
  de: deMasterData.suppliers.importHint,
  es: esMasterData.suppliers.importHint,
};

describe('suppliers CSV import dialog', () => {
  beforeEach(() => {
    dialogs.import = null;
  });

  it('passes the suppliers hint to the import dialog', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <SuppliersPage />
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(dialogs.import).toMatchObject({
      endpoint: '/suppliers',
      example: 'suppliers',
      hint: 'suppliers.importHint',
    });
  });

  it('names the status and end-of-validity columns by the template titles', () => {
    for (const language of ['en', 'fr', 'de', 'es'] as const) {
      const hint = hints[language];
      const titles = TEMPLATE_TITLES[language];
      expect(hint.includes(titles.status)).toBe(true);
      expect(hint.includes(titles.disabledAt)).toBe(true);
      expect(hint.includes('enabled')).toBe(true);
      expect(hint.includes('disabled')).toBe(true);
      expect(hint.includes('disabled_at')).toBe(false);
      expect(/\bstatus\b/.test(hint)).toBe(false);
    }
  });

  it('keeps the accepted values and the contact sentence in each language', () => {
    expect(hints.en).toBe(
      'Accepted values for Status: enabled or disabled. Disabled on holds the end of validity, or stays empty. The contact columns take the e-mail of a contact that already exists in Contacts.',
    );
    expect(hints.fr).toBe(
      "Valeurs acceptées pour Statut : enabled ou disabled. Désactivé le contient la fin de validité, ou reste vide. Les colonnes de contact prennent l'e-mail d'un contact qui existe déjà dans Contacts.",
    );
    expect(hints.de).toBe(
      'Zulässige Werte für Status: enabled oder disabled. Deaktiviert am enthält das Gültigkeitsende oder bleibt leer. Die Kontaktspalten enthalten die E-Mail-Adresse eines Kontakts, der unter Kontakte bereits existiert.',
    );
    expect(hints.es).toBe(
      'Valores aceptados para Estado: enabled o disabled. Desactivado el contiene el fin de validez o queda vacío. Las columnas de contacto llevan el correo electrónico de un contacto que ya existe en Contactos.',
    );
  });

  it('puts a no-break space before the French colon', () => {
    const shown = frenchSpacing(hints.fr);
    expect(shown).toBe(hints.fr.replace('Statut :', 'Statut\u00a0:'));
    expect(shown.includes('Statut\u00a0:')).toBe(true);
  });
});
