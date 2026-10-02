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
import { forgetAllocationsYear } from './allocationsCache';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn> };
const YEAR = 2026;

/** The year's Budget total the server holds for the lines (a test changes it to model a Budget save). */
let plannedTotal = 1000;

/** Two lines, each with a manual split between two companies. */
function serve() {
  plannedTotal = 1000;
  mocked.get.mockImplementation(async (url: string) => {
    const line = /^\/spend-items\/(item-\d)\/versions$/.exec(url);
    if (line) return { data: [{ id: `v-${line[1]}`, budget_year: YEAR, allocation_method: 'manual_company', allocation_driver: 'headcount' }] };
    if (/^\/spend-versions\/v-item-\d\/allocations$/.test(url)) {
      return { data: { items: [
        { company_id: 'c-1', department_id: null, allocation_pct: 60 },
        { company_id: 'c-2', department_id: null, allocation_pct: 40 },
      ] } };
    }
    if (/^\/spend-versions\/v-item-\d\/amounts$/.test(url)) return { data: { totals: { planned: plannedTotal } } };
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

  it('after a Budget save, reads the year again and never shows the amounts from before', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const first = renderTab('item-1', client);
    // 60 % of 1 000.
    expect(await screen.findByText('600')).toBeInTheDocument();
    first.unmount();

    // The Budget tab saves 2 000 for the year (what its writes do to this tab's cache).
    plannedTotal = 2000;
    forgetAllocationsYear(client, OPEX_FINANCE_CONFIG.itemsApi, 'item-1', YEAR);
    renderTab('item-1', client);
    expect(screen.queryByText('600')).toBeNull();
    expect(await screen.findByText('1 200')).toBeInTheDocument();
    expect(screen.queryByText('600')).toBeNull();
  });

  it('a failed read of the companies shows an error instead of loading for ever', async () => {
    const served = mocked.get.getMockImplementation()!;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/companies') throw new Error('network');
      return served(url, config);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <AllocationsTab id="item-1" year={YEAR} availableYears={[YEAR - 1, YEAR]} onYearChange={() => undefined} config={OPEX_FINANCE_CONFIG} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // The years are not locked: the user can leave for another year.
    await waitFor(() => expect(screen.getByRole('tab', { name: String(YEAR - 1) })).not.toBeDisabled());
  });

  it('a failed read of the departments is not kept: the next visit reads them again', async () => {
    const served = mocked.get.getMockImplementation()!;
    let failDepartments = true;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/departments' && failDepartments) throw new Error('forbidden');
      return served(url, config);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const first = renderTab('item-1', client);
    expect(await screen.findByText('Alpha Industries')).toBeInTheDocument();
    await waitFor(() => expect(reads(/^\/departments$/)).toBe(1));
    first.unmount();

    failDepartments = false;
    renderTab('item-2', client);
    await waitFor(() => expect(reads(/^\/departments$/)).toBe(2));
  });
});
