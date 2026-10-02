import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { OPEX_FINANCE_CONFIG } from './config';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

import api from '../../api';
import AllocationsTab from './AllocationsTab';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn> };
const YEAR = 2026;

/** Two lines, each with a manual split between two companies. */
function serve() {
  mocked.get.mockImplementation(async (url: string) => {
    const line = /^\/spend-items\/(item-\d)\/versions$/.exec(url);
    if (line) return { data: [{ id: `v-${line[1]}`, budget_year: YEAR, allocation_method: 'manual_company', allocation_driver: 'headcount' }] };
    if (/^\/spend-versions\/v-item-\d\/allocations$/.test(url)) {
      return { data: { items: [
        { company_id: 'c-1', department_id: null, allocation_pct: 60 },
        { company_id: 'c-2', department_id: null, allocation_pct: 40 },
      ] } };
    }
    if (/^\/spend-versions\/v-item-\d\/amounts$/.test(url)) return { data: { totals: { planned: 1000 } } };
    if (url === '/companies') {
      return { data: { items: [
        { id: 'c-1', name: 'Alpha Industries', headcount_year: 60 },
        { id: 'c-2', name: 'Beta Services', headcount_year: 40 },
      ] } };
    }
    if (url === '/departments') return { data: { items: [] } };
    if (url === '/allocation-rules/active') return { data: { mode: 'auto', method: 'headcount' } };
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderTab(id: string, client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <AllocationsTab id={id} year={YEAR} onYearChange={() => undefined} config={OPEX_FINANCE_CONFIG} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const reads = (pattern: RegExp) => mocked.get.mock.calls.filter(([url]) => pattern.test(url)).length;

describe('AllocationsTab on the query cache', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    serve();
  });

  it("reads the year's companies and departments once for every line", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const first = renderTab('item-1', client);
    expect(await screen.findByText('Alpha Industries')).toBeInTheDocument();
    first.unmount();
    renderTab('item-2', client);
    await waitFor(() => expect(reads(/^\/spend-versions\/v-item-2\/allocations$/)).toBe(1));
    expect(await screen.findByText('Alpha Industries')).toBeInTheDocument();
    expect(reads(/^\/companies$/)).toBe(1);
    expect(reads(/^\/departments$/)).toBe(1);
  });

  it("shows a line's allocation at once when the tab comes back", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const first = renderTab('item-1', client);
    expect(await screen.findByText('Beta Services')).toBeInTheDocument();
    const before = mocked.get.mock.calls.length;
    first.unmount();

    renderTab('item-1', client);
    // First render: the stored split, not an empty table.
    expect(screen.getByText('Alpha Industries')).toBeInTheDocument();
    expect(screen.getByText('Beta Services')).toBeInTheDocument();
    expect(mocked.get.mock.calls.length).toBe(before);
  });
});
