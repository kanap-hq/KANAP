import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../lib/listContext', () => ({ getWithListContext: vi.fn(async () => ({ data: {} })) }));
vi.mock('../components/ServerDataGrid', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({
  default: (props: Record<string, any>) => {
    deleteButton.props = props;
    return null;
  },
}));

import CompaniesPage from './CompaniesPage';

describe('CompaniesPage delete', () => {
  it('names companies in the selection title and in the kept line', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <CompaniesPage />
        </MemoryRouter>
      </ThemeProvider>,
    );
    const labels = deleteButton.props?.itemLabels;
    expect(labels.title(2)).toBe('companies.delete.title');
    expect(labels.keptDone(1)).toBe('companies.delete.keptDone');
  });
});
