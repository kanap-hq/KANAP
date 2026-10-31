import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const auth = vi.hoisted(() => ({ level: 'admin' as 'admin' | 'reader' }));

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  };
});
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_resource: string, level: string) => auth.level === 'admin' || level === 'reader',
    profile: { id: 'me' },
  }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: {} })), post: vi.fn() } }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ settings: null, byField: {}, labelFor: (_field: string, code: string) => code }),
}));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => { grid.props = props; return null; },
}));
vi.mock('../../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../../components/csv', () => ({ CsvExportDialogV2: () => null, CsvImportDialogV2: () => null }));

import { incidentRefValueGetter } from './IncidentsPage';
import IncidentsPage from './IncidentsPage';

type Params = Parameters<typeof incidentRefValueGetter>[0];

function renderPage() {
  grid.props = null;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <IncidentsPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function showEmpty() {
  const emptyState = grid.props?.emptyState as React.ReactElement;
  render(<ThemeProvider theme={createAppTheme('light')}>{emptyState}</ThemeProvider>);
  return screen.getByTestId('incidents-empty');
}

describe('incidentRefValueGetter', () => {
  it('shows the incident reference on a normal row', () => {
    expect(incidentRefValueGetter({ node: { rowPinned: null }, data: { item_number: 7 } } as unknown as Params)).toBe('INC-7');
  });

  it('keeps the total label of the pinned row without the reference prefix', () => {
    expect(incidentRefValueGetter({ node: { rowPinned: 'bottom' }, data: { item_number: 'Total (10)' } } as unknown as Params)).toBe('Total (10)');
  });
});

describe('IncidentsPage empty list', () => {
  beforeEach(() => { auth.level = 'admin'; });

  it('says the list is empty in one line, with the creation for someone who may create', () => {
    renderPage();
    const empty = showEmpty();
    expect(empty.textContent).toContain('pages.incidents.empty');
    expect(empty.querySelector('button')?.textContent).toBe('pages.incidents.newIncident');
  });

  it('leaves the creation out of the empty list for a reader', () => {
    auth.level = 'reader';
    renderPage();
    const empty = showEmpty();
    expect(empty.textContent).toBe('pages.incidents.empty');
    expect(empty.querySelector('button')).toBeNull();
  });
});
