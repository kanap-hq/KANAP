import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import IncidentsPage from './IncidentsPage';

const dialogs = vi.hoisted(() => ({ export: null as null | Record<string, any>, import: null as null | Record<string, any> }));

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'fr', resolvedLanguage: 'fr' } }),
  };
});
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'me' } }) }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post: vi.fn() } }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({ default: () => ({ settings: null, byField: {}, labelFor: (_field: string, code: string) => code }) }));
vi.mock('../../components/ServerDataGrid', () => ({ default: () => null }));
vi.mock('../../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../../components/csv', () => ({
  CsvExportDialogV2: (props: Record<string, any>) => {
    dialogs.export = props;
    return null;
  },
  CsvImportDialogV2: (props: Record<string, any>) => {
    dialogs.import = props;
    return null;
  },
}));

describe('IncidentsPage CSV', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends the browser time zone with the export and the template, so the file shows local times', () => {
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...resolvedOptions.call(this), timeZone: 'Europe/Paris' };
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter><IncidentsPage /></MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(dialogs.export?.endpoint).toBe('/incidents');
    expect(dialogs.export?.params).toEqual({ timeZone: 'Europe/Paris' });
    expect(dialogs.import?.endpoint).toBe('/incidents');
    expect(dialogs.import?.params).toEqual({ timeZone: 'Europe/Paris' });
  });

  it('words the zone messages of the date-time headers in each language', async () => {
    for (const lang of ['en', 'fr', 'de', 'es']) {
      const errors = (await import(`../../locales/${lang}/errors.json`)).default as Record<string, string>;
      expect(errors.CSV_HEADER_UNKNOWN_TIME_ZONE, lang).toContain('{{column}}');
      expect(errors.CSV_HEADER_UNKNOWN_TIME_ZONE, lang).toContain('{{zone}}');
      expect(errors.CSV_HEADER_ZONELESS_DATE_TIMES, lang).toContain('{{columns}}');
      expect(errors.CSV_HEADER_ZONELESS_DATE_TIMES, lang).toContain('{{example}}');
    }
  });

  it('words the import lifecycle refusal in each language', async () => {
    for (const lang of ['en', 'fr', 'de', 'es']) {
      const errors = (await import(`../../locales/${lang}/errors.json`)).default as Record<string, string>;
      for (const placeholder of ['{{reference}}', '{{from}}', '{{to}}']) {
        expect(errors.CSV_INCIDENT_STATUS_RESERVED, `${lang} ${placeholder}`).toContain(placeholder);
      }
    }
  });
});
