import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));
const grid = vi.fn();
vi.mock('../components/ServerDataGrid', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/ServerDataGrid')>()),
  default: (props: unknown) => {
    grid(props);
    return null;
  },
}));

import api from '../api';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import OpexListPage from './OpexListPage';

type Col = {
  colId?: string;
  field?: string;
  defaultHidden?: boolean;
  filter?: unknown;
  floatingFilterComponent?: unknown;
  headerName?: string;
  valueGetter?: (p: unknown) => unknown;
};
type GridProps = { columns: Col[]; pinnedBottomRowData: Array<{ versions?: Record<string, { totals?: Record<string, number> }> }> };

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const lastProps = () => grid.mock.calls[grid.mock.calls.length - 1][0] as GridProps;
const column = (id: string) => lastProps().columns.find((c) => (c.colId ?? c.field) === id);

async function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OpexListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(lastProps().pinnedBottomRowData).toHaveLength(1));
}

describe('OpexListPage', () => {
  beforeEach(() => {
    grid.mockReset();
    get.mockReset();
    get.mockImplementation(async (url: string) => (
      url === '/users'
        ? { data: { items: [] } }
        : { data: { yPlus2Budget: 80, yPlus2Landing: 60, yForecast: 5, reportingCurrency: 'X' } }
    ));
  });

  it('shows project names, not an id', async () => {
    await renderPage();
    expect(column('project_id')).toBeUndefined();
    const project = column('project_name');
    expect(project?.headerName).toBe('opex.columns.project');
    expect(project?.defaultHidden).toBe(true);
    expect(project?.filter).toBeUndefined();
  });

  it('reads Y+2 amounts in the reporting currency like the other years', async () => {
    await renderPage();
    const getter = column('yPlus2Budget')!.valueGetter!;
    expect(getter({ data: { versions: { yPlus2: { totals: { budget: 100 }, reporting: { budget: 92 } } } } })).toBe(92);
  });

  it('offers every column of every list year and a supplier filter with the values the server lists', async () => {
    await renderPage();
    expect(lastProps().columns.filter((c) => c.filter === 'agNumberColumnFilter')).toHaveLength(20);
    expect(column('supplier_name')?.filter).toBe(CheckboxSetFilter);
  });

  it('filters every date column with date models, from the menu and from the box under the header', async () => {
    await renderPage();
    for (const id of ['effective_start', 'disabled_at', 'created_at', 'updated_at']) {
      expect(column(id)).toMatchObject({ filter: 'agDateColumnFilter', floatingFilterComponent: 'agDateColumnFloatingFilter' });
    }
  });

  it('fills the footer from the totals keys of the same name', async () => {
    await renderPage();
    const versions = lastProps().pinnedBottomRowData[0].versions!;
    expect(versions.yPlus2.totals?.budget).toBe(80);
    expect(versions.yPlus2.totals?.landing).toBe(60);
    expect(versions.y.totals?.forecast).toBe(5);
  });
});
