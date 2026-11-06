import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => undefined } };
});
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }) }));
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: [] })), post: vi.fn() } }));

const grid = vi.fn();
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: unknown) => {
    grid(props);
    return null;
  },
}));

import CheckboxSetFilter from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import BusinessProcessesPage from './BusinessProcessesPage';

type Col = {
  field?: string;
  filter?: unknown;
  floatingFilterComponent?: unknown;
  filterParams?: { values?: unknown; searchable?: boolean };
  valueFormatter?: (params: { value: unknown }) => string;
};

const lastProps = () => grid.mock.calls[grid.mock.calls.length - 1][0] as { columns: Col[] };

describe('BusinessProcessesPage', () => {
  it('offers No type on the type filter, after the three codes', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter>
            <BusinessProcessesPage />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const type = lastProps().columns.find((column) => column.field === 'process_type')!;
    expect(type.filter).toBe(CheckboxSetFilter);
    expect(type.floatingFilterComponent).toBe(CheckboxSetFloatingFilter);
    expect(type.filterParams?.searchable).toBe(false);
    expect(type.filterParams?.values).toEqual([
      { value: 'management', label: 'businessProcesses.types.management' },
      { value: 'core', label: 'businessProcesses.types.core' },
      { value: 'support', label: 'businessProcesses.types.support' },
      { value: null, label: 'businessProcesses.filters.noType' },
    ]);
    expect(type.valueFormatter?.({ value: null })).toBe('');
    expect(type.valueFormatter?.({ value: 'core' })).toBe('businessProcesses.types.core');
  });
});
