import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import ContactsPage from './ContactsPage';
import SuppliersPage from './SuppliersPage';

const state = vi.hoisted(() => ({
  limited: false,
  grid: null as null | Record<string, any>,
  deleteButtons: 0,
}));

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  };
});
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: () => true,
    profile: { id: 'u-1' },
    dataAccess: state.limited ? { available: true, mode: 'limited', nodes: [], modules: ['budget'] } : null,
  }),
}));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })) } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    state.grid = props;
    return null;
  },
}));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({
  default: () => {
    state.deleteButtons += 1;
    return <span data-testid="delete-selected" />;
  },
}));

function renderPage(Page: React.ComponentType) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter><Page /></MemoryRouter>
    </ThemeProvider>,
  );
}

describe.each([
  ['contacts', ContactsPage],
  ['suppliers', SuppliersPage],
] as const)('%s list and data access', (_name, Page) => {
  beforeEach(() => {
    state.limited = false;
    state.grid = null;
    state.deleteButtons = 0;
  });
  afterEach(() => cleanup());

  it('offers the CSV import, the selection and bulk delete to an administrator with access to all data', () => {
    renderPage(Page);
    expect(screen.getByRole('button', { name: 'shared.labels.importCsv' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'shared.labels.exportCsv' })).toBeInTheDocument();
    expect(screen.getByTestId('delete-selected')).toBeInTheDocument();
    expect(state.grid?.enableRowSelection).toBe(true);
  });

  it('hides the CSV import, the selection and bulk delete from a limited person, and keeps the export', () => {
    state.limited = true;
    renderPage(Page);
    expect(screen.queryByRole('button', { name: 'shared.labels.importCsv' })).toBeNull();
    expect(screen.getByRole('button', { name: 'shared.labels.exportCsv' })).toBeInTheDocument();
    expect(screen.queryByTestId('delete-selected')).toBeNull();
    expect(state.deleteButtons).toBe(0);
    expect(state.grid?.enableRowSelection).toBe(false);
  });
});
