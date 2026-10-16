import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

// The contacts and business processes files follow the screen's language, as the other
// master-data files do: their export and import dialogs say so and send the language.
const dialogs = vi.hoisted(() => ({ export: null as null | Record<string, any>, import: null as null | Record<string, any> }));
const stableT = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'fr', resolvedLanguage: 'fr' } }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'fr' }));
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('../components/ServerDataGrid', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('./business-processes/BusinessProcessCategoryManagerDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({
  default: (props: Record<string, any>) => { dialogs.export = props; return null; },
}));
vi.mock('../components/csv/CsvImportDialog', () => ({
  default: (props: Record<string, any>) => { dialogs.import = props; return null; },
}));

import ContactsPage from './ContactsPage';
import BusinessProcessesPage from './BusinessProcessesPage';

function renderPage(page: React.ReactElement) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>{page}</MemoryRouter>
    </ThemeProvider>,
  );
}

describe('contacts and business processes CSV files', () => {
  beforeEach(() => {
    dialogs.export = null;
    dialogs.import = null;
  });

  it.each([
    ['contacts', <ContactsPage key="contacts" />, '/contacts'],
    ['business processes', <BusinessProcessesPage key="processes" />, '/business-processes'],
  ])('%s: the export and the import follow the screen language', (_label, page, endpoint) => {
    renderPage(page);
    expect(dialogs.export).toMatchObject({ endpoint, flexibleFormat: true });
    expect(dialogs.import).toMatchObject({ endpoint, flexibleFormat: true });
  });
});
