import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

const grid = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
const auth = vi.hoisted(() => ({ level: 'admin' as 'admin' | 'reader' }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_area: string, level: string) => auth.level === 'admin' || level === 'reader',
    profile: { id: 'u-1' },
    dataAccess: null,
  }),
}));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, unknown>) => {
    grid.props = props;
    return null;
  },
}));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../components/PageHeader', () => ({ default: () => null }));

import SuppliersPage from './SuppliersPage';

function renderPage() {
  grid.props = null;
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <SuppliersPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

function showEmpty() {
  const emptyState = grid.props?.emptyState as React.ReactElement;
  render(<ThemeProvider theme={createAppTheme('light')}>{emptyState}</ThemeProvider>);
  return screen.getByTestId('suppliers-empty');
}

describe('Suppliers list empty state', () => {
  beforeEach(() => { auth.level = 'admin'; });

  it('says the list is empty in one line, with the creation for someone who may create', () => {
    renderPage();
    const empty = showEmpty();
    expect(empty.textContent).toContain('suppliers.empty');
    expect(empty.querySelector('button')?.textContent).toBe('suppliers.newSupplier');
  });

  it('leaves the creation out of the empty list for a reader', () => {
    auth.level = 'reader';
    renderPage();
    const empty = showEmpty();
    expect(empty.textContent).toBe('suppliers.empty');
    expect(empty.querySelector('button')).toBeNull();
  });
});
