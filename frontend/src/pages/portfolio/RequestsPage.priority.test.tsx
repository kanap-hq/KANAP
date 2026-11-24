import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { enabledCriterionIdsQueryKey } from './useEnabledCriterionIds';
import RequestsPage from './RequestsPage';

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const get = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }),
}));
vi.mock('../../api', () => ({ default: { get, post: vi.fn() } }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'fromage' }) }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: Record<string, unknown>) => {
    grid.props = props;
    return null;
  },
}));
vi.mock('../../components/csv', () => ({ CsvExportDialogV2: () => null, CsvImportDialogV2: () => null }));
vi.mock('../../components/PageHeader', () => ({ default: () => null }));

const CRITERIA = [
  { id: 'c-value', enabled: true },
  { id: 'c-cost', enabled: true },
  { id: 'c-old', enabled: false },
];

type Row = {
  id: string;
  priority_score: number;
  priority_override?: boolean;
  override_value?: number | null;
  criteria_values?: Record<string, string>;
};

function priorityColumn(): Record<string, any> {
  const columns = grid.props?.columns as Array<Record<string, any>> | undefined;
  const priority = columns?.find((column) => column.field === 'priority_score');
  if (!priority) throw new Error('priority column missing');
  return priority;
}

function priorityText(row: Row): string {
  return priorityColumn().valueFormatter({ value: row.priority_score, data: row });
}

async function renderPage() {
  grid.props = null;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await client.prefetchQuery({
    queryKey: enabledCriterionIdsQueryKey,
    queryFn: async () => ['c-value', 'c-cost'],
  });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RequestsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('RequestsPage priority column', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/criteria') return { data: CRITERIA };
      if (String(url).includes('team-members')) return { data: { id: 'tm-1', team_id: null } };
      return { data: {} };
    });
  });

  it('leaves the priority empty until an enabled criterion is answered, and shows an override', async () => {
    await renderPage();
    const answered = { id: 'answered', priority_score: 100, criteria_values: { 'c-value': 'v-high' } };
    const untouched = { id: 'untouched', priority_score: 50, criteria_values: {} };
    const disabledOnly = { id: 'disabled', priority_score: 40, criteria_values: { 'c-old': 'v-b' } };
    const override = {
      id: 'override',
      priority_score: 50,
      priority_override: true,
      override_value: 72,
      criteria_values: {},
    };

    await waitFor(() => expect(priorityText(answered)).toBe('100'));
    expect(priorityText(untouched)).toBe('');
    expect(priorityText(disabledOnly)).toBe('');
    expect(priorityText(override)).toBe('72');

    const priority = priorityColumn();
    expect(priority.field).toBe('priority_score');
    expect(priority.valueGetter).toBeUndefined();
  });
});
