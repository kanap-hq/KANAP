import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

// The companies import dialog names the years it reads and the status values it accepts.
const dialogs = vi.hoisted(() => ({ import: null as null | Record<string, unknown> }));
const stableT = vi.hoisted(() => (key: string, options?: { years?: string }) => (
  options && typeof options.years === 'string' ? `${key}:${options.years}` : key
));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'fr', resolvedLanguage: 'fr' } }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'fr' }));
vi.mock('../lib/listContext', () => ({ getWithListContext: vi.fn().mockResolvedValue({ data: {} }) }));
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('../components/ServerDataGrid', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({
  default: (props: Record<string, unknown>) => { dialogs.import = props; return null; },
}));

import frMasterData from '../locales/fr/master-data.json';
import CompaniesPage from './CompaniesPage';

describe('companies CSV import dialog', () => {
  beforeEach(() => {
    dialogs.import = null;
  });

  it('names the years it reads and the status values', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <CompaniesPage />
        </MemoryRouter>
      </ThemeProvider>,
    );
    const year = new Date().getFullYear();
    expect(dialogs.import).toMatchObject({
      endpoint: '/companies',
      hint: `companies.importHint:${year - 1}, ${year}, ${year + 1}`,
    });
  });

  it('explains the years and the status values in French', () => {
    expect(frMasterData.companies.importHint).toBe(
      "Métriques lues : {{years}}, d'après l'année de la liste. Chaque année est facultative. Valeurs acceptées pour status : enabled ou disabled.",
    );
  });
});
